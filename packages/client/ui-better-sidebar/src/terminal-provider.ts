/** Authenticated attachment operations over the sidebar's existing UI and agent PTY managers. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SidebarTerminals, SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalRenameUiRequest, SidebarUiTerminalSnapshot, SidebarTerminalUiTarget, SidebarTerminalCloseUiRequest, SidebarTerminalCloseAgentRequest, SidebarTerminalProcessId, SidebarTerminalAttachmentId, SidebarTerminalOpenRequest, SidebarTerminalFrame, SidebarTerminalInputRequest, SidebarTerminalResizeRequest, SidebarTerminalAckRequest, SidebarTerminalReleaseRequest, SidebarTerminalCapability, SidebarTerminalSessionId, SidebarAgentTerminalId, SidebarAgentTerminalSnapshot } from '@deepseek-ai/dsh-sidebar-terminals/types'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import { LeasedTerminal } from './leased-terminal.ts'
import { executionDirectory, executionShells } from './terminal-execution.ts'
import type { SidebarTerminalProcess } from './pty-manager.ts'
import type { AgentPtyRegistry, AgentTerminalHandle } from './agent-pty.ts'
import { shellDisplayName, type PtyManager, type SidebarPty } from './pty-manager.ts'
import type { ResolvedSidebarConfig } from './config.ts'
import { floatingTerminalDirectory } from './terminal-directory.ts'
import { TerminalOutput, encodedFrameBytes } from './terminal-output.ts'
import { discoverTerminalShells } from './terminal-shells.ts'

type Handle = SidebarPty | AgentTerminalHandle
interface Attached {
  readonly id: SidebarTerminalAttachmentId
  readonly handle: Handle
  readonly target: SidebarTerminalOpenRequest['target']
  readonly lifetime: AbortController
  readonly output: TerminalOutput
  mode: SidebarTerminalReleaseRequest['mode']
  readonly created: boolean
  accepted: boolean
}

/** Private inputs from the Host plugin that owns both native registries. */
export interface SidebarTerminalProviderOptions {
  readonly execution: (sessionId: SidebarTerminalSessionId, signal: AbortSignal) => Promise<ExecutionLease>
  readonly ui: PtyManager | null
  readonly agents: AgentPtyRegistry | null
  readonly config: ResolvedSidebarConfig
  readonly shell: () => { shell: string; shellArgs: string[] }
  /** Explicit deployment or Settings override for remote execution worlds. */
  readonly shellOverrides?: () => { shell?: string; shellArgs?: string[] }
}

/** One provider for HTTP/WS and authenticated Remote consumers of the same native PTYs. */
export class SidebarTerminalProvider extends SidebarTerminals {
  private readonly lifetime = new AbortController()
  private readonly attachments = new Map<SidebarTerminalAttachmentId, Attached>()
  private readonly processIds = new WeakMap<Handle, SidebarTerminalProcessId>()
  private readonly uiTargets = new WeakMap<SidebarPty, Extract<SidebarTerminalOpenRequest['target'], { kind: 'ui' }>>()
  private readonly pauses = new Map<SidebarTerminalProcess, Set<SidebarTerminalAttachmentId>>()
  private readonly openings = new Map<string, Promise<unknown>>()
  private readonly leases = new WeakMap<SidebarPty, ExecutionLease>()
  private readonly settlements = new Set<Promise<void>>()
  private readonly remoteProcesses = new Set<LeasedTerminal>()
  private readonly failures: unknown[] = []
  private closing: Promise<void> | undefined

  /** @param ctx - service registration lifetime. @param options - existing native owners and accepted settings. */
  constructor(ctx: Context, private readonly options: SidebarTerminalProviderOptions) {
    if (options.config.terminalBufferBytes < options.config.terminalFrameBytes) {
      throw new Error('terminalBufferBytes must be at least terminalFrameBytes')
    }
    super(ctx)
  }

  capability(): SidebarTerminalCapability {
    return this.options.ui === null
      ? { status: 'unavailable', reason: 'missing-dependencies' }
      : { status: 'available', shellName: shellDisplayName(this.options.shell().shell) }
  }

  async shells(sessionId: SidebarTerminalSessionId) {
    if (this.options.ui === null) throw new SidebarTerminalError('unavailable', 'The terminal registry is unavailable.')
    const lease = await this.options.execution(sessionId, this.lifetime.signal)
    try {
      lease.assertCurrent()
      const choices = lease.binding.kind === 'local'
        ? discoverTerminalShells(this.options.shell(), this.options.config.shellCandidates)
        : await executionShells(lease, this.options.config.shellCandidates,
          AbortSignal.any([this.lifetime.signal, lease.signal]), this.remoteShellOverride())
      return choices.map(({ path, name }) => ({ path, name }))
    } finally { await lease.release() }
  }

  private remoteShellOverride(): { shell?: string; shellArgs: readonly string[] } | undefined {
    const override = this.options.shellOverrides?.()
    const shell = override?.shell ?? this.options.config.shell
    const shellArgs = override?.shellArgs ?? this.options.config.shellArgs
    return shell !== '' || shellArgs.length > 0 ? { shell, shellArgs } : undefined
  }

  private trackSettlement(pending: Promise<void>): void {
    this.settlements.add(pending)
    void pending.then(() => { this.settlements.delete(pending) }, (error: unknown) => {
      this.settlements.delete(pending)
      this.failures.push(error)
    })
  }

  private async openUi(target: Extract<SidebarTerminalOpenRequest['target'], { kind: 'ui' }>,
    cols: number, rows: number, signal: AbortSignal): Promise<{ handle: SidebarPty; created: boolean }> {
    const key = target.sessionId + ':' + target.tabId
    const previous = this.openings.get(key)
    const pending = (async () => {
      if (previous !== undefined) await previous.catch(() => { /* The next admission owns its own failure. */ })
      signal.throwIfAborted()
      const manager = this.options.ui
      if (manager === null) throw new SidebarTerminalError('unavailable', 'The terminal registry is unavailable.')
      const lease = await this.options.execution(target.sessionId, signal)
      let transferred = false
      try {
        const joined = AbortSignal.any([signal, lease.signal])
        lease.assertCurrent()
        const cwd = target.floating === undefined
          ? lease.cwd
          : lease.binding.kind === 'local'
            ? await floatingTerminalDirectory(lease.cwd, target.floating.directory)
            : await executionDirectory(lease, target.floating.directory, joined)
        const existing = manager.get(key)
        if (existing !== undefined && !existing.exited) {
          this.leases.get(existing)?.assertCurrent()
          if (existing.closing === true) throw new SidebarTerminalError('stale-attachment', 'The terminal is closing.')
          if (existing.failure !== undefined) throw new Error('The captured terminal execution world failed.', { cause: existing.failure })
          if (existing.cwd === cwd && existing.incarnation === lease.incarnation) {
            // Keep the reconnect timer armed until resize succeeds. A failed
            // admission must still release this disconnected process.
            await existing.pty.resize(cols, rows)
            manager.cancelClose(key)
            return { handle: existing, created: false }
          }
          manager.close(key)
          await existing.done
          joined.throwIfAborted()
        }
        let handle: SidebarPty
        if (lease.binding.kind === 'local') {
          joined.throwIfAborted()
          const preferred = this.options.shell()
          const selected = target.shellPath === undefined ? undefined
            : discoverTerminalShells(preferred, this.options.config.shellCandidates).find(shell => shell.path === target.shellPath)
          if (target.shellPath !== undefined && selected === undefined) throw new SidebarTerminalError('invalid-shell', 'The selected shell is unavailable.')
          handle = manager.open(target.sessionId, target.tabId, cwd, cols, rows, selected?.path ?? preferred.shell,
            selected?.args ?? preferred.shellArgs)
          const lost = (): void => {
            if (manager.get(key) !== handle) return
            handle.failure = lease.signal.reason
            manager.close(key)
          }
          lease.signal.addEventListener('abort', lost, { once: true })
          const settled = handle.done.then(async () => {
            lease.signal.removeEventListener('abort', lost)
            await lease.release()
          })
          this.trackSettlement(settled)
          if (lease.signal.aborted) lost()
        } else {
          const choices = await executionShells(lease, this.options.config.shellCandidates, joined, this.remoteShellOverride())
          const shell = target.shellPath === undefined ? choices[0] : choices.find(value => value.path === target.shellPath)
          if (shell === undefined) throw new SidebarTerminalError('invalid-shell', 'The selected remote shell is unavailable.')
          const subprocess = lease.ctx.get('subprocess')
          if (subprocess === undefined) throw new SidebarTerminalError('unavailable', 'The execution world has no subprocess provider.')
          const allocation = new AbortController()
          const cancelAllocation = (): void => { allocation.abort(joined.reason) }
          joined.addEventListener('abort', cancelAllocation, { once: true })
          if (joined.aborted) cancelAllocation()
          let native
          try {
            native = await subprocess.spawnTerminal({ argv: [shell.path, ...shell.args], cwd, cols, rows,
              terminalType: 'xterm-256color', graceMs: this.options.config.reconnectGraceMs, signal: allocation.signal })
          } finally { joined.removeEventListener('abort', cancelAllocation) }
          const adapter = new LeasedTerminal(native, lease, shell.path, (error) => {
            const current = manager.get(key)
            if (current?.pty === adapter) current.failure = error
            for (const attachment of this.attachments.values()) {
              if (attachment.handle.pty === adapter) attachment.output.fail(error)
            }
          })
          this.remoteProcesses.add(adapter)
          this.trackSettlement(adapter.settled.finally(() => { this.remoteProcesses.delete(adapter) }))
          transferred = true
          try { handle = manager.open(target.sessionId, target.tabId, cwd, cols, rows, shell.path, shell.args, () => adapter) }
          catch (error) { adapter.kill(); throw error }
          adapter.resume()
          if (joined.aborted) { manager.close(key); joined.throwIfAborted() }
        }
        transferred = true
        handle.incarnation = lease.incarnation
        this.leases.set(handle, lease)
        this.uiTargets.set(handle, target)
        return { handle, created: true }
      } finally { if (!transferred) await lease.release() }
    })()
    this.openings.set(key, pending)
    try { return await pending }
    finally { if (this.openings.get(key) === pending) this.openings.delete(key) }
  }

  async *open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame> {
    const lifetime = new AbortController()
    const joined = AbortSignal.any([signal, this.lifetime.signal, lifetime.signal])
    joined.throwIfAborted()
    const { target } = request
    let handle: Handle
    let created = false
    if (target.kind === 'agent') {
      const agents = this.options.agents
      if (agents === null) throw new SidebarTerminalError('not-found', 'The agent terminal is no longer available.')
      let found: AgentTerminalHandle
      try {
        found = agents.assertOwned(target.uuid, target.sessionId)
      } catch {
        throw new SidebarTerminalError('not-found', 'The agent terminal is no longer available.')
      }
      handle = found
      if (!handle.exited) handle.pty.resize(request.cols, request.rows)
    } else {
      const opened = await this.openUi(target, request.cols, request.rows, joined)
      handle = opened.handle
      created = opened.created
    }
    if (joined.aborted && created && target.kind === 'ui') this.options.ui?.close(target.sessionId + ':' + target.tabId)
    joined.throwIfAborted()
    const id = randomUUID() as SidebarTerminalAttachmentId
    const output = new TerminalOutput({
      attachmentId: id,
      limits: {
        frameBytes: this.options.config.terminalFrameBytes,
        bufferBytes: this.options.config.terminalBufferBytes,
        ackTimeoutMs: this.options.config.terminalAckTimeoutMs,
      },
      onPressure: (blocked) => { this.pressure(handle, id, blocked) },
    })
    const entry: Attached = { id, handle, target, lifetime, output, mode: 'disconnect', created, accepted: false }
    const ready: SidebarTerminalFrame = { type: 'ready', attachmentId: id, processId: this.processIdOf(handle), pid: handle.pty.pid, cwd: handle.cwd, shellName: shellDisplayName('shellPath' in handle ? handle.shellPath : handle.pty.process), ...('shellPath' in handle ? { shellPath: handle.shellPath, ...handle.title === undefined ? {} : { title: handle.title } } : {}) }
    if (encodedFrameBytes(ready) > this.options.config.terminalFrameBytes) {
      if (created && target.kind === 'ui') this.options.ui?.close(target.sessionId + ':' + target.tabId)
      throw new SidebarTerminalError('output-overflow', 'The terminal opening frame exceeds its configured byte limit.')
    }
    this.attachments.set(id, entry)
    const unpin = target.kind === 'ui' ? this.options.ui?.retain(handle as SidebarPty) : undefined
    const data = handle.pty.onData((value) => { output.push(value) })
    const exit = handle.pty.onExit(({ exitCode }) => {
      if ('failure' in handle && handle.failure !== undefined) output.fail(handle.failure)
      else output.finish(exitCode)
    })
    const cleanup = (): void => {
      if (!this.attachments.delete(id)) return
      joined.removeEventListener('abort', cleanup)
      data.dispose()
      exit.dispose()
      output.dispose()
      unpin?.()
      this.releaseProcess(entry)
    }
    joined.addEventListener('abort', cleanup, { once: true })
    output.push(handle.transcript)
    if (handle.exited) output.finish(handle.exitCode ?? 0)
    try {
      joined.throwIfAborted()
      yield ready
      yield* output.frames(joined)
    } finally { cleanup() }
  }

  input(request: SidebarTerminalInputRequest): void | Promise<void> {
    return this.current(request.attachmentId).handle.pty.write(request.data)
  }

  resize(request: SidebarTerminalResizeRequest): void | Promise<void> {
    return this.current(request.attachmentId).handle.pty.resize(request.cols, request.rows)
  }

  ack(request: SidebarTerminalAckRequest): void {
    const entry = this.current(request.attachmentId, true)
    entry.output.ack(request.sequence)
    entry.accepted = true
  }

  release(request: SidebarTerminalReleaseRequest): void {
    const entry = this.attachments.get(request.attachmentId)
    if (entry === undefined) return
    entry.mode = request.mode
    entry.lifetime.abort()
  }

  inspectUi(request: SidebarTerminalUiTarget): SidebarTerminalProcessId | null {
    const handle = this.options.ui?.get(request.sessionId + ':' + request.tabId)
    return handle === undefined || handle.exited || handle.closing === true || handle.failure !== undefined
      ? null : this.processIdOf(handle)
  }

  closeUi(request: SidebarTerminalCloseUiRequest): void {
    const key = request.sessionId + ':' + request.tabId
    const handle = this.options.ui?.get(key)
    if (handle === undefined || handle.exited) return
    if (this.processIds.get(handle) !== request.processId) {
      throw new SidebarTerminalError('stale-attachment', 'The terminal process was replaced. Its earlier close request was discarded.')
    }
    this.options.ui?.close(key)
  }

  listUi(sessionId: SidebarTerminalSessionId): readonly SidebarUiTerminalSnapshot[] {
    const manager = this.options.ui
    if (manager === null) throw new SidebarTerminalError('unavailable', 'The native terminal dependency is unavailable.')
    const result = manager.keysOf(sessionId).flatMap((key) => {
      const handle = manager.get(key)
      return handle === undefined || handle.exited || handle.closing === true || handle.failure !== undefined
        ? [] : [this.uiSnapshot(handle)]
    })
    if (Buffer.byteLength(JSON.stringify(result)) > this.options.config.terminalBufferBytes) {
      throw new SidebarTerminalError('output-overflow', 'The terminal list exceeds its configured byte limit.')
    }
    return result
  }

  renameUi(request: SidebarTerminalRenameUiRequest): SidebarUiTerminalSnapshot {
    const handle = this.options.ui?.get(request.sessionId + ':' + request.tabId)
    if (handle === undefined || handle.exited || handle.closing === true || handle.failure !== undefined) {
      throw new SidebarTerminalError('not-found', 'The terminal is no longer available.')
    }
    this.leases.get(handle)?.assertCurrent()
    if (this.processIds.get(handle) !== request.processId) {
      throw new SidebarTerminalError('stale-attachment', 'The terminal process was replaced. Its earlier rename request was discarded.')
    }
    handle.title = request.title.trim()
    return this.uiSnapshot(handle)
  }

  private uiSnapshot(handle: SidebarPty): SidebarUiTerminalSnapshot {
    const floating = this.uiTargets.get(handle)?.floating
    return { sessionId: handle.sessionId as SidebarTerminalSessionId, tabId: handle.tabId as SidebarUiTerminalSnapshot['tabId'],
      processId: this.processIdOf(handle), title: handle.title ?? shellDisplayName(handle.shellPath),
      shellPath: handle.shellPath, cwd: handle.cwd, pid: handle.pty.pid, ...floating === undefined ? {} : { floating } }
  }

  closeAgent(request: SidebarTerminalCloseAgentRequest): void {
    const agents = this.options.agents
    if (agents === null) throw new SidebarTerminalError('not-found', 'The agent terminal is no longer available.')
    try {
      agents.assertOwned(request.uuid, request.sessionId)
    } catch {
      throw new SidebarTerminalError('not-found', 'The agent terminal is no longer available.')
    }
    agents.close(request.uuid)
  }

  async *watch(sessionId: SidebarTerminalSessionId, signal: AbortSignal): AsyncIterable<readonly SidebarAgentTerminalSnapshot[]> {
    const joined = AbortSignal.any([signal, this.lifetime.signal])
    joined.throwIfAborted()
    let changed = true
    let wake: (() => void) | undefined
    const unsubscribe = this.options.agents?.subscribe(() => { changed = true; wake?.() })
    try {
      while (!joined.aborted) {
        if (changed) {
          changed = false
          const snapshot = this.options.agents?.list(sessionId) ?? []
          if (Buffer.byteLength(JSON.stringify(snapshot)) > this.options.config.terminalBufferBytes) {
            throw new SidebarTerminalError('output-overflow', 'The terminal list exceeds its configured byte limit.')
          }
          yield snapshot.map(value => ({ ...value, uuid: value.uuid as SidebarAgentTerminalId }))
          continue
        }
        await new Promise<void>((resolve) => {
          const done = (): void => { joined.removeEventListener('abort', done); wake = undefined; resolve() }
          wake = done
          joined.addEventListener('abort', done, { once: true })
          if (joined.aborted) done()
        })
      }
    } finally {
      unsubscribe?.()
      wake?.()
    }
  }

  /**
   * Stop admission and terminate every process owned by this provider.
   * @returns after every owned native process exits, or rejects if native shutdown cannot be confirmed.
   */
  shutdown(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.lifetime.abort()
    for (const entry of this.attachments.values()) entry.output.dispose()
    const settled = Promise.allSettled([...this.openings.values()]).then(async () => {
      for (const process of this.remoteProcesses) process.kill()
      await Promise.all([this.options.ui, this.options.agents].flatMap(manager => manager === null ? [] : [manager.disposeAllAndWait()]))
      await Promise.allSettled([...this.settlements])
      if (this.failures.length > 0) throw new AggregateError(this.failures, 'Terminal execution cleanup failed.')
    })
    const waits = [settled]
    let timeout: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new Error('Sidebar terminal native shutdown did not settle in time.'))
      }, this.options.config.terminalShutdownTimeoutMs)
    })
    this.closing = Promise.race([Promise.all(waits), deadline]).then(() => {}).finally(() => { clearTimeout(timeout) })
    return this.closing
  }

  private processIdOf(handle: Handle): SidebarTerminalProcessId {
    let id = this.processIds.get(handle)
    if (id === undefined) { id = randomUUID() as SidebarTerminalProcessId; this.processIds.set(handle, id) }
    return id
  }

  private current(id: SidebarTerminalAttachmentId, allowExited = false): Attached {
    const entry = this.attachments.get(id)
    if (entry === undefined || entry.lifetime.signal.aborted || (!allowExited && entry.handle.exited) || !this.isCurrent(entry)) {
      throw new SidebarTerminalError('stale-attachment', 'The terminal connection ended. Reconnect before sending input.')
    }
    return entry
  }

  private isCurrent(entry: Attached): boolean {
    return entry.target.kind === 'ui'
      ? this.options.ui?.get(entry.target.sessionId + ':' + entry.target.tabId) === entry.handle
      : this.options.agents?.get(entry.target.uuid) === entry.handle
  }

  private releaseProcess(entry: Attached): void {
    if (!this.isCurrent(entry)) return
    if (entry.target.kind === 'agent') {
      if (entry.mode === 'close') this.options.agents?.close(entry.target.uuid)
      return
    }
    const key = entry.target.sessionId + ':' + entry.target.tabId
    const otherView = [...this.attachments.values()].some(other => other.handle === entry.handle)
    if (entry.mode === 'close' || (entry.created && !entry.accepted && !otherView)) this.options.ui?.close(key)
    else if (![...this.attachments.values()].some(other => other.handle === entry.handle)) {
      if (entry.mode === 'park') this.options.ui?.park(key)
      else this.options.ui?.scheduleClose(key, this.options.config.reconnectGraceMs)
    }
  }

  private pressure(handle: Handle, id: SidebarTerminalAttachmentId, blocked: boolean): void {
    let owners = this.pauses.get(handle.pty)
    if (blocked) {
      if (owners === undefined) { owners = new Set(); this.pauses.set(handle.pty, owners) }
      if (owners.has(id)) return
      owners.add(id)
      if (owners.size === 1 && !handle.exited) handle.pty.pause()
    } else if (owners?.delete(id) === true && owners.size === 0) {
      this.pauses.delete(handle.pty)
      if (!handle.exited) handle.pty.resume()
    }
  }

}
