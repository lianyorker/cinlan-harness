/** Loader-mounted terminal owner consumes a controlled execution-world PTY with real output and teardown. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { ExecutionLease, SshExecutionSnapshot } from '@deepseek-ai/dsh-execution-binding/types'
import { SubprocessExecutableNotFoundError, type SubprocessOutcome, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type { SidebarTerminalFrame, SidebarTerminalOpenRequest, SidebarTerminalSessionId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { PtyManager } from '../src/pty-manager.ts'
import { SidebarTerminalProvider } from '../src/terminal-provider.ts'
import { resolveSidebarConfig } from '../src/config.ts'

const sessionId = 'remote-session' as SidebarTerminalSessionId
const binding: SshExecutionSnapshot = { kind: 'ssh', targetId: 'controlled' as SshExecutionSnapshot['targetId'], revision: 4,
  endpoint: { host: 'remote.invalid', port: 22, username: 'fixture', hostKeySHA256: 'fixture-host-key' },
  node: '/usr/bin/node', helper: '/opt/dsh/helper.mjs', helperHash: 'fixture-helper-hash', workspace: '/srv/remote',
  bootstrapPath: '/opt/dsh/bootstrap.json', bootstrapHash: 'fixture-bootstrap-hash' }
const request = { target: { kind: 'ui', sessionId, tabId: 'terminal:0' }, cols: 80, rows: 24 } as SidebarTerminalOpenRequest

class WorldTerminal implements SubprocessTerminalHandle {
  readonly pid = 7401
  readonly output = new PassThrough()
  readonly completed = Promise.withResolvers<SubprocessOutcome>()
  readonly done = this.completed.promise
  readonly gate = Promise.withResolvers<undefined>()
  hold = false
  constructor(signal?: AbortSignal) {
    const cancel = (): void => { void this.terminate() }
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted === true) queueMicrotask(cancel)
    void this.done.finally(() => { signal?.removeEventListener('abort', cancel) }).catch(() => {})
  }
  readonly write = vi.fn(async (data: string) => { this.output.write('remote:' + data) })
  readonly resize = vi.fn(async (_cols: number, _rows: number) => {})
  readonly inspectForeground = async () => undefined
  readonly inspectActivity = async () => ({ state: 'unknown' as const, revision: 0 })
  readonly signalForeground = async () => this.pid
  private ending: Promise<void> | undefined
  readonly terminate = vi.fn(() => this.ending ??= (async () => {
    if (this.hold) await this.gate.promise
    this.output.destroy()
    this.completed.resolve({ exitCode: 0, signal: null })
  })())
}

async function load(shell?: { shell?: string; shellArgs?: string[] }) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-execution-'))
  const ctx = new Context()
  const lost = new AbortController()
  const processes: WorldTerminal[] = []
  const releases = vi.fn(async () => {})
  const spawn = vi.fn(async (_spec: SubprocessTerminalSpawnSpec) => {
    const process = new WorldTerminal(_spec.signal)
    processes.push(process)
    return process
  })
  const executable = vi.fn(async (path: string) => path === 'bash' ? '/bin/bash' : path)
  const fsResolve = vi.fn(async (path: string) => ({ path }))
  const runtime = { apply(scope: Context) {
    scope.provide('subprocess', { terminalEnvironment: async () => ({ platform: 'posix', defaultShell: '/bin/sh' }),
      resolveExecutable: executable, spawnTerminal: spawn } as never)
    scope.provide('fs', { resolve: fsResolve, processPath: (target: { path: string }) => target.path,
      stat: async () => ({ type: 'directory' }) } as never)
  } }
  let lease!: ExecutionLease
  const acquire = vi.fn(async (id: SidebarTerminalSessionId, signal: AbortSignal) => {
    signal.throwIfAborted()
    if (id !== sessionId) throw new Error('Session has no execution binding')
    let released = false
    return { ...lease, assertCurrent() {
      if (released) throw new Error('Released execution lease')
      lost.signal.throwIfAborted()
    }, async release() {
      if (released) return
      released = true
      await releases()
    } }
  })
  const provider = { inject: ['subprocess', 'fs'], apply(scope: Context) {
    lease = { binding, ctx: scope, cwd: '/srv/remote', platform: 'linux',
      incarnation: 'remote-incarnation' as ExecutionLease['incarnation'],
      signal: lost.signal, assertCurrent() { lost.signal.throwIfAborted() }, release: releases }
    const owner = new SidebarTerminalProvider(scope, { ui: new PtyManager('DO-NOT-SPAWN-LOCALLY', 3, [], null),
      agents: null, config: resolveSidebarConfig({ ...shell, shellCandidates: ['bash'], terminalFrameBytes: 512, terminalBufferBytes: 4096 }), execution: acquire,
      shell: () => { throw new Error('Local shell resolution accessed') } })
    scope.effect(() => () => owner.shutdown())
  } }
  onTestFinished(async () => {
    for (const process of processes) process.gate.resolve(undefined)
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  const config = join(root, 'cordis.yml')
  await writeFile(config, `- name: controlled-world
- name: sidebar-terminal-owner
`)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(name: string) {
    if (name === 'controlled-world') return runtime
    if (name === 'sidebar-terminal-owner') return provider
    throw new Error('Unexpected module: ' + name)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  const owner = ctx.sidebarTerminals as SidebarTerminalProvider
  const attach = async (open = request) => {
    const lifetime = new AbortController()
    const iterator = owner.open(open, lifetime.signal)[Symbol.asyncIterator]()
    const frame = (await iterator.next()).value as SidebarTerminalFrame
    if (frame.type !== 'ready') throw new Error('Expected real terminal ready frame')
    owner.ack({ attachmentId: frame.attachmentId, sequence: 0 })
    return { iterator, frame, lifetime }
  }
  return { ctx, owner, attach, lost, acquire, releases, processes, spawn, executable, fsResolve }
}

it('uses remote executable lookup and PTY I/O, then parks and restores the same canonical generation', async () => {
  const h = await load()
  expect(await h.owner.shells(sessionId)).toEqual([{ path: '/bin/sh', name: 'sh' }, { path: '/bin/bash', name: 'bash' }])
  expect(h.spawn).not.toHaveBeenCalled()
  h.releases.mockClear()
  const first = await h.attach()
  expect(first.frame).toMatchObject({ cwd: '/srv/remote', pid: 7401, shellPath: '/bin/sh' })
  expect(h.spawn).toHaveBeenCalledWith(expect.objectContaining({ argv: ['/bin/sh', '-l'], cwd: '/srv/remote' }))
  const output = first.iterator.next()
  await h.owner.input({ attachmentId: first.frame.attachmentId, data: '命令' })
  const emitted = (await output).value as SidebarTerminalFrame
  expect(emitted).toMatchObject({ type: 'data', data: 'remote:命令' })
  if (emitted.type !== 'data') throw new Error('Expected streamed output')
  h.owner.ack({ attachmentId: first.frame.attachmentId, sequence: emitted.sequence })
  h.owner.renameUi({ sessionId, tabId: 'terminal:0' as never, processId: first.frame.processId, title: 'Remote build' })
  h.owner.release({ attachmentId: first.frame.attachmentId, mode: 'park' })
  await first.iterator.return?.()
  expect(h.releases).not.toHaveBeenCalled()
  expect(h.processes[0]!.terminate).not.toHaveBeenCalled()
  const second = await h.attach()
  expect(second.frame).toMatchObject({ processId: first.frame.processId, pid: first.frame.pid, title: 'Remote build' })
  expect(h.spawn).toHaveBeenCalledOnce()
  await expect(JSON.stringify({ cwd: second.frame.cwd, pid: second.frame.pid,
    shellPath: second.frame.shellPath, title: second.frame.title, output: emitted.data }, null, 2) + '\n')
    .toMatchFileSnapshot('./expected/terminal-execution/retained.expected.json')
  h.owner.release({ attachmentId: second.frame.attachmentId, mode: 'close' })
  await second.iterator.return?.()
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
})

it('uses configured shell arguments in the remote execution world', async () => {
  const h = await load({ shell: '/bin/bash', shellArgs: ['--noprofile', '--norc'] })
  const attached = await h.attach()
  expect(h.spawn).toHaveBeenCalledWith(expect.objectContaining({
    argv: ['/bin/bash', '--noprofile', '--norc'], cwd: '/srv/remote',
  }))
  h.owner.release({ attachmentId: attached.frame.attachmentId, mode: 'close' })
  await attached.iterator.return?.()
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
})

it('aborts a lost remote world, rejects live I/O, and retains its lease until termination settles', async () => {
  const h = await load()
  const attached = await h.attach()
  const process = h.processes[0]!
  process.hold = true
  const next = attached.iterator.next()
  const rejected = expect(next).rejects.toThrow('SSH disconnected')
  h.lost.abort(new Error('SSH disconnected'))
  await rejected
  expect(h.owner.listUi(sessionId)).toEqual([])
  expect(() => h.owner.input({ attachmentId: attached.frame.attachmentId, data: 'must-not-run' })).toThrow()
  expect(h.releases).not.toHaveBeenCalled()
  let finished = false
  const disposal = h.ctx.fiber.dispose().then(() => { finished = true })
  await Promise.resolve()
  expect(finished).toBe(false)
  process.gate.resolve(undefined)
  await disposal
  expect(h.releases).toHaveBeenCalledOnce()
  expect(h.spawn).toHaveBeenCalledOnce()
})

it('rejects missing bindings and escaped remote directories without any local allocation', async () => {
  const h = await load()
  await expect(h.owner.shells('missing' as SidebarTerminalSessionId)).rejects.toThrow('no execution binding')
  const escaped = { ...request, target: { kind: 'ui', sessionId,
    tabId: 'terminal:11111111-1111-4111-8111-111111111111:0',
    floating: { windowId: '11111111-1111-4111-8111-111111111111', directory: '../outside' } } } as SidebarTerminalOpenRequest
  await expect(h.attach(escaped)).rejects.toMatchObject({ code: 'invalid-directory' })
  expect(h.fsResolve).not.toHaveBeenCalled()
  expect(h.spawn).not.toHaveBeenCalled()
  expect(h.releases).toHaveBeenCalledOnce()
})

it('serializes concurrent attachments and drains output paused by ACK pressure during close', async () => {
  const h = await load()
  const [first, second] = await Promise.all([h.attach(), h.attach()])
  expect(h.spawn).toHaveBeenCalledOnce()
  expect(second.frame.processId).toBe(first.frame.processId)
  expect(h.acquire).toHaveBeenCalledTimes(2)
  expect(h.releases).toHaveBeenCalledOnce()
  first.lifetime.abort()
  await first.iterator.return?.()
  expect(h.processes[0]!.terminate).not.toHaveBeenCalled()
  const native = h.processes[0]!
  native.output.write('x'.repeat(2200))
  expect(native.output.isPaused()).toBe(true)
  const disposal = h.ctx.fiber.dispose()
  await disposal
  await first.iterator.return?.()
  await second.iterator.return?.()
  expect(native.terminate).toHaveBeenCalledOnce()
  expect(h.releases).toHaveBeenCalledTimes(2)
})

it('cancels an in-flight allocation and waits for its returned process before releasing the lease', async () => {
  const h = await load()
  const allocated = Promise.withResolvers<WorldTerminal>()
  const entered = Promise.withResolvers<undefined>()
  const native = new WorldTerminal()
  native.hold = true
  h.processes.push(native)
  h.spawn.mockImplementationOnce(async () => { entered.resolve(undefined); return allocated.promise })
  const lifetime = new AbortController()
  const iterator = h.owner.open(request, lifetime.signal)[Symbol.asyncIterator]()
  const next = iterator.next()
  const aborted = expect(next).rejects.toThrow()
  await entered.promise
  lifetime.abort()
  allocated.resolve(native)
  await aborted
  expect(native.terminate).toHaveBeenCalledOnce()
  expect(h.releases).not.toHaveBeenCalled()
  native.gate.resolve(undefined)
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
  expect(h.owner.listUi(sessionId)).toEqual([])
})

it('drains a natural exit before release synchronously aborts the lease signal', async () => {
  const h = await load()
  h.releases.mockImplementationOnce(async () => { h.lost.abort(new Error('Lease released')) })
  const attached = await h.attach()
  const native = h.processes[0]!
  const text = '终端-output'.repeat(130)
  native.output.write(Buffer.from(text))
  expect(native.output.isPaused()).toBe(true)
  native.output.end(Buffer.from('尾部'))
  native.completed.resolve({ exitCode: 7, signal: null })
  let output = ''
  while (true) {
    const frame = (await attached.iterator.next()).value as SidebarTerminalFrame
    if (frame.type === 'exit') { expect(frame.exitCode).toBe(7); break }
    if (frame.type !== 'data') throw new Error('Expected output before terminal exit')
    output += frame.data
    h.owner.ack({ attachmentId: attached.frame.attachmentId, sequence: frame.sequence })
  }
  expect(output).toBe(text + '尾部')
  expect(h.releases).toHaveBeenCalledOnce()
  expect(native.terminate).toHaveBeenCalledOnce()
  await attached.iterator.return?.()
})

it('retries a failed termination during shutdown when quota rejects an allocated process before registry admission', async () => {
  const h = await load()
  for (let index = 0; index < 3; index++) {
    await h.attach({ ...request, target: { kind: 'ui', sessionId, tabId: ('terminal:' + String(index)) as never } })
  }
  const unadmitted = new WorldTerminal()
  h.processes.push(unadmitted)
  unadmitted.terminate.mockRejectedValueOnce(new Error('Temporary close failure before registry admission'))
  h.spawn.mockResolvedValueOnce(unadmitted)
  await expect(h.attach({ ...request, target: { kind: 'ui', sessionId, tabId: 'terminal:3' as never } }))
    .rejects.toThrow('terminal limit reached')
  expect(unadmitted.terminate).toHaveBeenCalledOnce()
  expect(h.releases).not.toHaveBeenCalled()
  await h.owner.shutdown()
  expect(unadmitted.terminate).toHaveBeenCalledTimes(2)
  expect(h.releases).toHaveBeenCalledTimes(4)
})

it('skips only official executable misses and propagates transport failures without spawning', async () => {
  const h = await load()
  h.executable.mockImplementation(async (path) => {
    if (path === 'bash') throw new SubprocessExecutableNotFoundError('No bash in selected execution world')
    return path
  })
  expect(await h.owner.shells(sessionId)).toEqual([{ path: '/bin/sh', name: 'sh' }])
  h.executable.mockRejectedValueOnce(new Error('SSH lookup failed'))
  await expect(h.owner.shells(sessionId)).rejects.toThrow('SSH lookup failed')
  expect(h.spawn).not.toHaveBeenCalled()
  expect(h.releases).toHaveBeenCalledTimes(2)
})

it('resolves floating paths remotely and refuses canonical symlink escape', async () => {
  const h = await load()
  const target = { ...request.target, kind: 'ui', sessionId, tabId: 'terminal:remote-window:0',
    floating: { windowId: 'remote-window', directory: 'project' } } as SidebarTerminalOpenRequest['target']
  const attached = await h.attach({ ...request, target })
  expect(attached.frame.cwd).toBe('/srv/remote/project')
  expect(h.fsResolve).toHaveBeenCalledWith('/srv/remote/project', expect.objectContaining({ cwd: '/srv/remote' }))
  h.owner.release({ attachmentId: attached.frame.attachmentId, mode: 'close' })
  await attached.iterator.return?.()
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
  h.fsResolve.mockResolvedValueOnce({ path: '/outside' })
  await expect(h.attach({ ...request, target })).rejects.toMatchObject({ code: 'invalid-directory' })
  expect(h.spawn).toHaveBeenCalledOnce()
})

it('retries a transient termination failure after the real process exits and releases its lease', async () => {
  const h = await load()
  const attached = await h.attach()
  const native = h.processes[0]!
  native.terminate.mockRejectedValueOnce(new Error('Remote termination was not confirmed'))
  h.owner.release({ attachmentId: attached.frame.attachmentId, mode: 'close' })
  await attached.iterator.return?.()
  expect(h.releases).not.toHaveBeenCalled()
  native.output.end()
  native.completed.resolve({ exitCode: 0, signal: null })
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
  expect(native.terminate).toHaveBeenCalledTimes(2)
})

it('retains a failed close owner so a later explicit close can retry the still-live process', async () => {
  const h = await load()
  const attached = await h.attach()
  const native = h.processes[0]!
  native.terminate.mockRejectedValueOnce(new Error('Temporary SSH termination failure'))
  h.owner.release({ attachmentId: attached.frame.attachmentId, mode: 'close' })
  await attached.iterator.return?.()
  expect(h.releases).not.toHaveBeenCalled()
  expect(h.owner.listUi(sessionId)).toEqual([])
  h.owner.closeUi({ sessionId, tabId: request.target.kind === 'ui' ? request.target.tabId : '' as never,
    processId: attached.frame.processId })
  await vi.waitFor(() => { expect(h.releases).toHaveBeenCalledOnce() })
  expect(native.terminate).toHaveBeenCalledTimes(2)
})
