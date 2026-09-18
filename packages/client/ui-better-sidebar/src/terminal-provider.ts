/** Authenticated attachment operations over the sidebar's existing UI and agent PTY managers. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SidebarTerminals, SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalUiTarget, SidebarTerminalCloseUiRequest, SidebarTerminalProcessId, SidebarTerminalAttachmentId, SidebarTerminalOpenRequest, SidebarTerminalFrame, SidebarTerminalInputRequest, SidebarTerminalResizeRequest, SidebarTerminalAckRequest, SidebarTerminalReleaseRequest, SidebarTerminalCapability, SidebarTerminalSessionId, SidebarAgentTerminalId, SidebarAgentTerminalSnapshot } from '@deepseek-ai/dsh-sidebar-terminals/types'
import type { IPty } from 'node-pty'
import type { AgentPtyRegistry, AgentTerminalHandle } from './agent-pty.ts'
import { shellDisplayName, type PtyManager, type SidebarPty } from './pty-manager.ts'
import type { ResolvedSidebarConfig } from './config.ts'
import { floatingTerminalDirectory } from './terminal-directory.ts'
import { TerminalOutput, encodedFrameBytes } from './terminal-output.ts'

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
  readonly ui: PtyManager | null
  readonly agents: AgentPtyRegistry | null
  readonly config: ResolvedSidebarConfig
  readonly sessionCwd: (id: string) => string
  readonly sessionWorkspace: (id: string) => string | undefined
  readonly shell: () => { shell: string; shellArgs: string[] }
}

/** One provider for HTTP/WS and authenticated Remote consumers of the same native PTYs. */
export class SidebarTerminalProvider extends SidebarTerminals {
  private readonly lifetime = new AbortController()
  private readonly attachments = new Map<SidebarTerminalAttachmentId, Attached>()
  private readonly processIds = new WeakMap<Handle, SidebarTerminalProcessId>()
  private readonly pauses = new Map<IPty, Set<SidebarTerminalAttachmentId>>()
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

  async *open(request: SidebarTerminalOpenRequest, signal: AbortSignal): AsyncIterable<SidebarTerminalFrame> {
    const lifetime = new AbortController()
    const joined = AbortSignal.any([signal, this.lifetime.signal, lifetime.signal])
    joined.throwIfAborted()
    const { target } = request
    let handle: Handle
    let created = false
    if (target.kind === 'agent') {
      const found = this.options.agents?.get(target.uuid)
      if (found === undefined) throw new SidebarTerminalError('not-found', 'The agent terminal is no longer available.')
      handle = found
      if (!handle.exited) handle.pty.resize(request.cols, request.rows)
    } else {
      const manager = this.options.ui
      if (manager === null) throw new SidebarTerminalError('unavailable', 'The native terminal dependency is unavailable.')
      const existing = manager.get(target.sessionId + ':' + target.tabId)
      const cwd = target.floating === undefined
        ? this.options.sessionCwd(target.sessionId)
        : existing !== undefined && !existing.exited
          ? existing.cwd
          : await floatingTerminalDirectory(this.options.sessionWorkspace(target.sessionId), target.floating.directory)
      joined.throwIfAborted()
      const shell = this.options.shell()
      const current = manager.get(target.sessionId + ':' + target.tabId)
      const spawnCwd = target.floating !== undefined && current !== undefined && !current.exited ? current.cwd : cwd
      created = current === undefined || current.exited || current.cwd !== spawnCwd
      handle = manager.open(target.sessionId, target.tabId, spawnCwd, request.cols, request.rows, shell.shell, shell.shellArgs)
    }
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
    const ready: SidebarTerminalFrame = { type: 'ready', attachmentId: id, processId: this.processIdOf(handle), pid: handle.pty.pid, cwd: handle.cwd, shellName: shellDisplayName(handle.pty.process) }
    if (encodedFrameBytes(ready) > this.options.config.terminalFrameBytes) {
      if (created && target.kind === 'ui') this.options.ui?.close(target.sessionId + ':' + target.tabId)
      throw new SidebarTerminalError('output-overflow', 'The terminal opening frame exceeds its configured byte limit.')
    }
    this.attachments.set(id, entry)
    const unpin = target.kind === 'ui' ? this.options.ui?.retain(handle as SidebarPty) : undefined
    const data = handle.pty.onData((value) => { output.push(value) })
    const exit = handle.pty.onExit(({ exitCode }) => { output.finish(exitCode) })
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

  input(request: SidebarTerminalInputRequest): void {
    this.current(request.attachmentId).handle.pty.write(request.data)
  }

  resize(request: SidebarTerminalResizeRequest): void {
    this.current(request.attachmentId).handle.pty.resize(request.cols, request.rows)
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
    return handle === undefined || handle.exited ? null : this.processIdOf(handle)
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

  closeAgent(uuid: SidebarAgentTerminalId): void { this.options.agents?.close(uuid) }

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

  /** @returns after every owned native process exits, or rejects if native shutdown cannot be confirmed. */
  shutdown(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.lifetime.abort()
    for (const entry of this.attachments.values()) entry.output.dispose()
    const waits = [this.options.ui, this.options.agents].flatMap(manager => manager === null ? [] : [manager.disposeAllAndWait()])
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
