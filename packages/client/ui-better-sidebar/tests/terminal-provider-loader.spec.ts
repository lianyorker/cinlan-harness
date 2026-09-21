/** Desktop terminal composition through real Loader, managers, tools, and optional Gateway. */
import { createTrustedConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import SidebarTerminalController from '@deepseek-ai/dsh-api-sidebar-terminal-controller'
import type {
  FloatingWorkspaceWindowId, SidebarAgentTerminalId, SidebarTerminalFrame, SidebarTerminalOpenRequest,
  SidebarTerminalSessionId, SidebarTerminalTabId,
} from '@deepseek-ai/dsh-sidebar-terminals/types'
import * as sidebar from '../src/index.ts'
import { resolveSidebarConfig, type SidebarConfig } from '../src/config.ts'

interface SpawnOptions { cwd: string; cols: number; rows: number; env: Record<string, string> }
interface NativeExit { exitCode: number; signal?: number }

const native = vi.hoisted(() => ({ spawn: vi.fn(), available: true }))
// Native processes and Session metadata are external; the terminal implementation stays real.
vi.mock('../src/pty-deps.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pty-deps.ts')>(),
  loadNodePty: () => native.available ? { spawn: native.spawn } : null,
  loadRequiredNodePty: () => ({ spawn: native.spawn }),
}))

class NativeProcess {
  readonly dataListeners = new Set<(data: string) => void>()
  readonly exitListeners = new Set<(event: NativeExit) => void>()
  readonly killRequested = Promise.withResolvers<undefined>()
  readonly write = vi.fn<(data: string) => void>()
  readonly pause = vi.fn<() => void>()
  readonly resume = vi.fn<() => void>()
  readonly resize = vi.fn<(cols: number, rows: number) => void>()
  readonly process: string
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  holdExit = false
  exited = false
  readonly kill = vi.fn(() => {
    this.killRequested.resolve(undefined)
    if (!this.holdExit) this.emitExit(0)
  })

  constructor(readonly pid: number, readonly file: string, readonly args: string[] | string, options: SpawnOptions) {
    this.process = file
    this.cwd = options.cwd
    this.cols = options.cols
    this.rows = options.rows
  }

  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return { dispose: () => { this.dataListeners.delete(listener) } }
  }

  onExit(listener: (event: NativeExit) => void) {
    this.exitListeners.add(listener)
    return { dispose: () => { this.exitListeners.delete(listener) } }
  }

  emitData(data: string): void {
    for (const listener of [...this.dataListeners]) listener(data)
  }

  emitExit(exitCode: number): void {
    if (this.exited) return
    this.exited = true
    for (const listener of [...this.exitListeners]) listener({ exitCode })
  }

  releaseExit(): void {
    this.holdExit = false
    if (this.kill.mock.calls.length > 0) this.emitExit(0)
  }
}

const sessionId = 'desktop-session' as SidebarTerminalSessionId
const windowId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as FloatingWorkspaceWindowId
const processes: NativeProcess[] = []
const lifetimes = new Set<AbortController>()
const closeStreams: Array<() => Promise<void>> = []
let root: string | undefined
let context: Context | undefined

beforeEach(() => {
  native.available = true
  native.spawn.mockReset()
  processes.length = 0
  native.spawn.mockImplementation((file: string, args: string[] | string, options: SpawnOptions) => {
    const process = new NativeProcess(processes.length + 1001, file, args, options)
    processes.push(process)
    return process
  })
})

afterEach(async () => {
  try {
    for (const process of processes) process.releaseExit()
    for (const lifetime of lifetimes) lifetime.abort()
    const streams = await Promise.allSettled(closeStreams.splice(0).map(close => close()))
    await context?.fiber.dispose()
    for (const stream of streams) if (stream.status === 'rejected') throw stream.reason
  } finally {
    context = undefined
    lifetimes.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    root = undefined
  }
})

function ownStream<T>(source: AsyncIterable<T>, lifetime: AbortController): AsyncIterator<T> {
  lifetimes.add(lifetime)
  const iterator = source[Symbol.asyncIterator]()
  closeStreams.push(async () => { await iterator.return?.() })
  return iterator
}

function uiRequest(tab = 'terminal:0'): SidebarTerminalOpenRequest {
  return { target: { kind: 'ui', sessionId, tabId: tab as SidebarTerminalTabId }, cols: 80, rows: 24 }
}

function floatingRequest(directory: string): SidebarTerminalOpenRequest {
  return {
    target: { kind: 'ui', sessionId, tabId: ('terminal:' + windowId + ':0') as SidebarTerminalTabId, floating: { windowId, directory } },
    cols: 80, rows: 24,
  }
}

async function readFrame<T extends SidebarTerminalFrame['type']>(
  iterator: AsyncIterator<SidebarTerminalFrame>, type: T,
): Promise<Extract<SidebarTerminalFrame, { type: T }>> {
  const result = await iterator.next()
  expect(result.done).toBe(false)
  if (result.done || result.value.type !== type) throw new Error('Expected terminal frame: ' + type)
  return result.value as Extract<SidebarTerminalFrame, { type: T }>
}

async function load(overrides: SidebarConfig = {}, gateway = false) {
  root = await mkdtemp(join(tmpdir(), 'dsh-desktop-terminal-provider-'))
  const cwd = join(root, 'workspace')
  const child = join(cwd, 'child')
  await mkdir(child, { recursive: true })
  const settingsPath = join(root, 'settings.yaml')
  await writeFile(settingsPath, 'dsh-better-sidebar:\n  agentTerminalTools: true\n')
  const config = resolveSidebarConfig({ shell: 'desktop-test-shell', shellArgs: ['--configured'], ...overrides })
  const rows = [
    { name: 'test-desktop-session' },
    { name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath } },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-client-ui-better-sidebar', config },
    ...gateway ? [
      { name: '@deepseek-ai/dsh-credentials-local', config: { path: join(root, 'credentials.yaml'), watch: false } },
      { name: '@deepseek-ai/dsh-client-connection' },
      { name: '@deepseek-ai/dsh-typert-registry' },
      { name: '@deepseek-ai/dsh-api-gateway' },
      { name: '@deepseek-ai/dsh-api-sidebar-terminal-controller' },
    ] : [],
  ]
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const sessions = { apply(scope: Context) {
    scope.provide('sessions', { get: (id: string) => id === sessionId ? { header: { cwd } } : undefined } as never)
    scope.provide('executionBindings', { async bindingForSession(id: string, signal?: AbortSignal) {
      signal?.throwIfAborted()
      if (id !== sessionId) throw new Error('Unknown Session')
      return { kind: 'local' }
    }, async forSession(id: string, signal?: AbortSignal) {
      if (id !== sessionId) throw new Error('Unknown Session')
      signal?.throwIfAborted()
      return { binding: { kind: 'local' }, ctx: scope, cwd: cwd, platform: process.platform, incarnation: 'local-fixture',
        signal: new AbortController().signal, assertCurrent() {}, async release() {} }
    } } as never)
  } }
  const modules = new Map<string, unknown>([
    ['test-desktop-session', sessions], ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-client-ui-better-sidebar', sidebar],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials], ['@deepseek-ai/dsh-client-connection', Connection],
    ['@deepseek-ai/dsh-typert-registry', TypertRegistry], ['@deepseek-ai/dsh-api-gateway', Gateway],
    ['@deepseek-ai/dsh-api-sidebar-terminal-controller', SidebarTerminalController],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected Loader module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  await vi.waitFor(() => {
    expect(ctx.get('sidebarTerminals')).toBeDefined()
    if (native.available) expect(ctx.get('tools')?.get('terminal_create')).toBeDefined()
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const terminals = ctx.sidebarTerminals
  return { ctx, terminals, cwd, child, config }
}

type Harness = Awaited<ReturnType<typeof load>>

async function attach(h: Harness, request = uiRequest(), acceptReady = true) {
  const lifetime = new AbortController()
  const iterator = ownStream(h.terminals.open(request, lifetime.signal), lifetime)
  const ready = await readFrame(iterator, 'ready')
  expect(new TextEncoder().encode(JSON.stringify(ready)).byteLength).toBeLessThanOrEqual(h.config.terminalFrameBytes)
  if (acceptReady) h.terminals.ack({ attachmentId: ready.attachmentId, sequence: 0 })
  return { iterator, ready, lifetime }
}

function execution(): ToolRunContext {
  return { signal: new AbortController().signal, agent: { session: { id: sessionId } } } as ToolRunContext
}

async function createAgent(h: Harness) {
  const create = h.ctx.tools.get('terminal_create')!
  const result = await create.execute({ title: 'agent shell', command: 'echo agent' }, execution()) as { uuid: SidebarAgentTerminalId; title: string }
  return result.uuid
}

describe('Desktop sidebar terminals through source Loader', () => {
  it('reports unavailable without local native dependencies and exposes no shells or spawn path', async () => {
    native.available = false
    const h = await load()
    expect(h.terminals.capability()).toEqual({ status: 'unavailable', reason: 'missing-dependencies' })
    await expect(h.terminals.shells(sessionId)).rejects.toMatchObject({ code: 'unavailable' })
    await expect(h.terminals.open(uiRequest(), new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'unavailable' })
    expect(h.ctx.get('tools')?.get('terminal_create')).toBeUndefined()
    const uuid = '00000000-0000-4000-8000-000000000001' as SidebarAgentTerminalId
    expect(() => { h.terminals.closeAgent({ sessionId, uuid }) }).toThrow(expect.objectContaining({ code: 'not-found' }))
    expect(native.spawn).not.toHaveBeenCalled()
    await h.ctx.fiber.dispose()
  })

  it('scrubs ambient Harness and credential values from UI and agent PTY environments', async () => {
    vi.stubEnv('SIDEBAR_VISIBLE_MARKER', 'visible')
    vi.stubEnv('DEEPSEEK_SIDEBAR_SECRET', 'hidden')
    vi.stubEnv('DSH_SIDEBAR_FACT', 'hidden')
    vi.stubEnv('SIDEBAR_API_SECRET', 'hidden')
    try {
      const h = await load()
      const ui = await attach(h)
      const uuid = await createAgent(h)
      expect(native.spawn).toHaveBeenCalledTimes(2)
      for (const call of native.spawn.mock.calls) {
        const env = (call[2] as SpawnOptions).env
        expect(env.SIDEBAR_VISIBLE_MARKER).toBe('visible')
        expect(env.DEEPSEEK_SIDEBAR_SECRET).toBeUndefined()
        expect(env.DSH_SIDEBAR_FACT).toBeUndefined()
        expect(env.SIDEBAR_API_SECRET).toBeUndefined()
      }
      h.terminals.release({ attachmentId: ui.ready.attachmentId, mode: 'close' })
      await expect(ui.iterator.next()).resolves.toMatchObject({ done: true })
      h.terminals.closeAgent({ sessionId, uuid })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('mounts without Web services and forwards ready, data, input, resize, and the final ACK after exit', async () => {
    const h = await load()
    expect(h.ctx.get('webServer')).toBeUndefined()
    expect(h.ctx.get('webRuntime')).toBeUndefined()
    expect(h.terminals.capability()).toEqual({ status: 'available', shellName: 'desktop-test-shell' })
    const a = await attach(h, uiRequest(), false)
    const process = processes[0]!
    expect(processes).toHaveLength(1)
    expect(a.ready).toMatchObject({ pid: process.pid, cwd: h.cwd, shellName: 'desktop-test-shell' })
    h.terminals.ack({ attachmentId: a.ready.attachmentId, sequence: 0 })
    await h.terminals.input({ attachmentId: a.ready.attachmentId, data: 'echo desktop\r' })
    await h.terminals.resize({ attachmentId: a.ready.attachmentId, cols: 120, rows: 40 })
    expect(process.write).toHaveBeenCalledWith('echo desktop\r')
    expect(process.resize).toHaveBeenCalledWith(120, 40)
    process.emitData('desktop 😀\r\n')
    const data = await readFrame(a.iterator, 'data')
    expect(data).toMatchObject({ attachmentId: a.ready.attachmentId, sequence: 1, data: 'desktop 😀\r\n' })
    process.emitExit(17)
    const delivered = vi.fn()
    const exit = a.iterator.next().then((value) => { delivered(value); return value })
    await vi.advanceTimersByTimeAsync(0)
    expect(delivered).not.toHaveBeenCalled()
    expect(() => { h.terminals.ack({ attachmentId: a.ready.attachmentId, sequence: data.sequence }) }).not.toThrow()
    expect(await exit).toEqual({ done: false, value: { type: 'exit', attachmentId: a.ready.attachmentId, exitCode: 17 } })
    await expect(a.iterator.next()).resolves.toMatchObject({ done: true })
    expect(process.dataListeners.size).toBe(1)
    expect(process.exitListeners.size).toBe(1)
  })

  it('discovers shells without spawning, keeps choices per tab, and restores the same native process', async () => {
    const h = await load({ shellCandidates: [process.execPath, process.execPath] })
    const choices = await h.terminals.shells(sessionId)
    expect(choices).toEqual([{ path: await realpath(process.execPath), name: 'node' }])
    expect(native.spawn).not.toHaveBeenCalled()
    const selected = choices[0]!.path
    const request: SidebarTerminalOpenRequest = { ...uiRequest(), target: { kind: 'ui', sessionId,
      tabId: 'terminal:0' as SidebarTerminalTabId, shellPath: selected } }
    const first = await attach(h, request)
    const nativeProcess = processes[0]!
    expect(nativeProcess.file).toBe(selected)
    expect(first.ready).toMatchObject({ shellName: 'node', shellPath: selected })
    const defaultTab = await attach(h, uiRequest('terminal:1'))
    expect(processes[1]!.file).toBe('desktop-test-shell')
    expect(processes[1]!.args).toEqual(['--configured'])
    nativeProcess.emitData('same shell output')
    const output = await readFrame(first.iterator, 'data')
    h.terminals.ack({ attachmentId: first.ready.attachmentId, sequence: output.sequence })
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'disconnect' })
    await first.iterator.next()
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs - 1)
    const restored = await attach(h, { ...request, target: { ...request.target, shellPath: '/no-longer-installed' } } as SidebarTerminalOpenRequest)
    expect(restored.ready.processId).toBe(first.ready.processId)
    expect(restored.ready.pid).toBe(first.ready.pid)
    expect(restored.ready.shellPath).toBe(selected)
    expect((await readFrame(restored.iterator, 'data')).data).toBe('same shell output')
    expect(native.spawn).toHaveBeenCalledTimes(2)
    expect(nativeProcess.kill).not.toHaveBeenCalled()
    h.terminals.release({ attachmentId: restored.ready.attachmentId, mode: 'close' })
    h.terminals.release({ attachmentId: defaultTab.ready.attachmentId, mode: 'close' })
    expect(nativeProcess.kill).toHaveBeenCalledOnce()
    const rejected = { ...uiRequest('terminal:2'), target: { kind: 'ui' as const, sessionId,
      tabId: 'terminal:2' as SidebarTerminalTabId, shellPath: '/not-a-discovered-shell' } }
    const failed = h.terminals.open(rejected, new AbortController().signal)[Symbol.asyncIterator]()
    await expect(failed.next()).rejects.toMatchObject({ code: 'invalid-shell' })
    expect(native.spawn).toHaveBeenCalledTimes(2)
  })

  it('rejects every legacy terminal tool for a remote initiating Session before touching local PTYs', async () => {
    const h = await load()
    const uuid = await createAgent(h)
    const local = processes[0]!
    local.emitData('private local transcript')
    local.write.mockClear()
    local.resize.mockClear()
    local.kill.mockClear()
    native.spawn.mockClear()
    const bindings = h.ctx.get('executionBindings')!
    const binding = vi.spyOn(bindings, 'bindingForSession').mockResolvedValue({ kind: 'ssh' } as never)
    const calls = [
      ['terminal_create', { title: 'remote', command: 'dangerous-on-local' }], ['terminal_list', {}],
      ['terminal_send', { uuid, text: 'must-not-write', submit: true }], ['terminal_read', { uuid }],
      ['terminal_wait_for', { uuid, needle: 'private' }], ['terminal_resize', { uuid, cols: 90, rows: 30 }],
      ['terminal_signal', { uuid, signal: 'SIGINT' }], ['terminal_close', { uuid }],
    ] as const
    for (const [name, args] of calls) {
      const result = await h.ctx.tools.execute({ name, arguments: args, callId: name as never,
        agent: execution().agent, signal: new AbortController().signal })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('support local Sessions only')
      expect(JSON.stringify(result.content)).not.toContain('private local transcript')
    }
    expect(binding).toHaveBeenCalledTimes(8)
    expect(native.spawn).not.toHaveBeenCalled()
    expect(local.write).not.toHaveBeenCalled()
    expect(local.resize).not.toHaveBeenCalled()
    expect(local.kill).not.toHaveBeenCalled()
    binding.mockRestore()
    expect(await h.ctx.tools.get('terminal_list')!.execute({}, execution())).toHaveLength(1)
  })

  it('uses the agent tool registry for watch, attach, input, output, reconnect, and close', async () => {
    const h = await load()
    const watchLifetime = new AbortController()
    const watch = ownStream(h.terminals.watch(sessionId, watchLifetime.signal), watchLifetime)
    expect((await watch.next()).value).toEqual([])
    const uuid = await createAgent(h)
    const process = processes[0]!
    expect(process.write).toHaveBeenCalledWith('echo agent\r')
    expect((await watch.next()).value).toEqual([{ uuid, title: 'agent shell', command: 'echo agent', exited: false }])
    const otherSession = 'other-session' as SidebarTerminalSessionId
    const denied: SidebarTerminalOpenRequest = { target: { kind: 'agent', sessionId: otherSession, uuid }, cols: 100, rows: 30 }
    await expect(h.terminals.open(denied, new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'not-found' })
    expect(() => { h.terminals.closeAgent({ sessionId: otherSession, uuid }) })
      .toThrow(expect.objectContaining({ code: 'not-found' }))
    expect(process.kill).not.toHaveBeenCalled()
    const request: SidebarTerminalOpenRequest = { target: { kind: 'agent', sessionId, uuid }, cols: 100, rows: 30 }
    const first = await attach(h, request)
    expect(first.ready.pid).toBe(process.pid)
    expect(process.resize).toHaveBeenCalledWith(100, 30)
    expect(processes).toHaveLength(1)
    await h.terminals.input({ attachmentId: first.ready.attachmentId, data: 'from-sidebar\r' })
    expect(process.write).toHaveBeenCalledWith('from-sidebar\r')
    process.emitData('shared transcript')
    const data = await readFrame(first.iterator, 'data')
    h.terminals.ack({ attachmentId: first.ready.attachmentId, sequence: data.sequence })
    const read = h.ctx.tools.get('terminal_read')!
    expect(await read.execute({ uuid }, execution())).toMatchObject({ text: 'shared transcript' })
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'park' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    expect(process.kill).not.toHaveBeenCalled()
    const second = await attach(h, request)
    expect(second.ready.pid).toBe(process.pid)
    expect(processes).toHaveLength(1)
    const replay = await readFrame(second.iterator, 'data')
    expect(replay.data).toBe('shared transcript')
    process.emitExit(7)
    h.terminals.ack({ attachmentId: second.ready.attachmentId, sequence: replay.sequence })
    expect(await readFrame(second.iterator, 'exit')).toMatchObject({ exitCode: 7 })
    await expect(second.iterator.next()).resolves.toMatchObject({ done: true })
    expect((await watch.next()).value).toEqual([{ uuid, title: 'agent shell', command: 'echo agent', exited: true, exitCode: 7, exitSignal: null }])
    h.terminals.closeAgent({ sessionId, uuid })
    expect(process.kill).toHaveBeenCalledOnce()
    expect((await watch.next()).value).toEqual([])
    expect(await h.ctx.tools.get('terminal_list')!.execute({}, execution())).toEqual([])
  })

  it('replays the complete native transcript limit even when JSON must escape every character', async () => {
    const h = await load()
    const uuid = await createAgent(h)
    const process = processes[0]!
    process.emitData('\u0000'.repeat(1 << 20))
    const view = await attach(h, { target: { kind: 'agent', sessionId, uuid }, cols: 80, rows: 24 })
    const frame = await readFrame(view.iterator, 'data')
    expect(frame.data.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(h.config.terminalFrameBytes)
    expect(process.pause).toHaveBeenCalledOnce()
    view.lifetime.abort()
    await expect(view.iterator.next()).resolves.toMatchObject({ done: true })
  })

  it('reconnects the same live UI process, parks past the grace period, and replaces a closed tab', async () => {
    const h = await load()
    const first = await attach(h)
    const process = processes[0]!
    process.emitData('retained output')
    const data = await readFrame(first.iterator, 'data')
    h.terminals.ack({ attachmentId: first.ready.attachmentId, sequence: data.sequence })
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'disconnect' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs - 1)
    const second = await attach(h)
    expect(second.ready.pid).toBe(first.ready.pid)
    expect(second.ready.processId).toBe(first.ready.processId)
    const replay = await readFrame(second.iterator, 'data')
    expect(replay.data).toBe('retained output')
    h.terminals.ack({ attachmentId: second.ready.attachmentId, sequence: replay.sequence })
    h.terminals.release({ attachmentId: second.ready.attachmentId, mode: 'park' })
    await expect(second.iterator.next()).resolves.toMatchObject({ done: true })
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs * 2)
    expect(process.kill).not.toHaveBeenCalled()
    const third = await attach(h)
    expect(third.ready.pid).toBe(first.ready.pid)
    h.terminals.release({ attachmentId: third.ready.attachmentId, mode: 'close' })
    await expect(third.iterator.next()).resolves.toMatchObject({ done: true })
    expect(process.kill).toHaveBeenCalledOnce()
    const replacement = await attach(h)
    expect(replacement.ready.pid).not.toBe(first.ready.pid)
    expect(processes).toHaveLength(2)
  })

  it('inspects and closes a parked process without a view or another spawn, while refusing an older process token', async () => {
    const h = await load()
    const request = uiRequest()
    if (request.target.kind !== 'ui') throw new Error('Expected UI fixture')
    const target = { sessionId: request.target.sessionId, tabId: request.target.tabId }
    expect(h.terminals.inspectUi(target)).toBeNull()
    expect(processes).toHaveLength(0)
    const first = await attach(h, request)
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'park' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    const observed = h.terminals.inspectUi(target)
    expect(observed).toBe(first.ready.processId)
    expect(processes).toHaveLength(1)
    expect(processes[0]!.resize).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs * 2)
    expect(processes[0]!.kill).not.toHaveBeenCalled()
    h.terminals.closeUi({ ...target, processId: first.ready.processId })
    expect(processes[0]!.kill).toHaveBeenCalledOnce()
    expect(h.terminals.inspectUi(target)).toBeNull()
    h.terminals.closeUi({ ...target, processId: first.ready.processId })
    const replacement = await attach(h, request)
    expect(replacement.ready.processId).not.toBe(first.ready.processId)
    expect(() => { h.terminals.closeUi({ ...target, processId: first.ready.processId }) })
      .toThrow(expect.objectContaining({ code: 'stale-attachment' }))
    expect(processes[1]!.kill).not.toHaveBeenCalled()
    h.terminals.closeUi({ ...target, processId: replacement.ready.processId })
    expect(processes[1]!.kill).toHaveBeenCalledOnce()
  })

  it('does not renew disconnect grace or revive a naturally exited process during readonly lookup', async () => {
    const h = await load()
    const request = uiRequest()
    if (request.target.kind !== 'ui') throw new Error('Expected UI fixture')
    const target = { sessionId: request.target.sessionId, tabId: request.target.tabId }
    const first = await attach(h, request)
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'disconnect' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs - 1)
    expect(h.terminals.inspectUi(target)).toBe(first.ready.processId)
    await vi.advanceTimersByTimeAsync(1)
    expect(processes[0]!.kill).toHaveBeenCalledOnce()
    const second = await attach(h, request)
    processes[1]!.emitExit(0)
    expect(h.terminals.inspectUi(target)).toBeNull()
    h.terminals.closeUi({ ...target, processId: second.ready.processId })
    expect(processes[1]!.kill).not.toHaveBeenCalled()
    expect(processes).toHaveLength(2)
  })

  it('closes an unaccepted newly created process when a late attachment is cancelled before ACK0', async () => {
    const h = await load()
    const late = await attach(h, uiRequest(), false)
    const process = processes[0]!
    late.lifetime.abort()
    expect(process.kill).toHaveBeenCalledOnce()
    await expect(late.iterator.next()).resolves.toMatchObject({ done: true })
    const replacement = await attach(h)
    expect(replacement.ready.pid).not.toBe(late.ready.pid)
    expect(processes).toHaveLength(2)
  })

  it('does not spawn for pre-aborted opens or cancellation during real floating directory resolution', async () => {
    const h = await load()
    const preAborted = new AbortController()
    const firstReason = new Error('cancelled before opening')
    preAborted.abort(firstReason)
    const first = ownStream(h.terminals.open(uiRequest(), preAborted.signal), preAborted)
    await expect(first.next()).rejects.toBe(firstReason)
    const resolving = new AbortController()
    const second = ownStream(h.terminals.open(floatingRequest('child'), resolving.signal), resolving)
    const pending = second.next()
    const secondReason = new Error('cancelled while resolving directory')
    resolving.abort(secondReason)
    await expect(pending).rejects.toBe(secondReason)
    expect(processes).toHaveLength(0)
  })

  it('captures canonical floating directories and replaces a live process when the authoritative directory changes', async () => {
    const h = await load()
    const first = await attach(h, floatingRequest('child'))
    expect(first.ready.cwd).toBe(await realpath(h.child))
    const process = processes[0]!
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'park' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    const second = await attach(h, floatingRequest('.'))
    expect(second.ready.pid).not.toBe(process.pid)
    expect(second.ready.cwd).toBe(await realpath(h.cwd))
    expect(process.kill).toHaveBeenCalledOnce()
    expect(h.terminals.listUi(sessionId)).toEqual([expect.objectContaining({
      processId: second.ready.processId, floating: { windowId, directory: '.' },
    })])
    h.terminals.release({ attachmentId: second.ready.attachmentId, mode: 'close' })
    await expect(second.iterator.next()).resolves.toMatchObject({ done: true })
    const lifetime = new AbortController()
    const missing = ownStream(h.terminals.open(floatingRequest('missing-now'), lifetime.signal), lifetime)
    await expect(missing.next()).rejects.toMatchObject({ code: 'invalid-directory' })
    expect(processes).toHaveLength(2)
  })

  it('prevents stale input, resize, or close from changing a replacement process', async () => {
    const h = await load()
    const stale = await attach(h)
    processes[0]!.emitExit(0)
    const replacement = await attach(h)
    const current = processes[1]!
    expect(() => { void h.terminals.input({ attachmentId: stale.ready.attachmentId, data: 'wrong process' }) }).toThrow(expect.objectContaining({ code: 'stale-attachment' }))
    expect(() => { void h.terminals.resize({ attachmentId: stale.ready.attachmentId, cols: 10, rows: 10 }) }).toThrow(expect.objectContaining({ code: 'stale-attachment' }))
    h.terminals.release({ attachmentId: stale.ready.attachmentId, mode: 'close' })
    await expect(stale.iterator.next()).resolves.toMatchObject({ done: true })
    expect(current.kill).not.toHaveBeenCalled()
    expect(current.write).not.toHaveBeenCalled()
    expect(current.resize).not.toHaveBeenCalled()
    await h.terminals.input({ attachmentId: replacement.ready.attachmentId, data: 'current process' })
    expect(current.write).toHaveBeenCalledWith('current process')
  })

  it('releases only its own native pause when two attachments share one PTY', async () => {
    const h = await load({ terminalFrameBytes: 512, terminalBufferBytes: 2048 })
    const first = await attach(h)
    const second = await attach(h)
    const process = processes[0]!
    expect(processes).toHaveLength(1)
    process.emitData('x'.repeat(1000))
    const a = await readFrame(first.iterator, 'data')
    const b = await readFrame(second.iterator, 'data')
    expect(a.data).toBe(b.data)
    expect(new TextEncoder().encode(JSON.stringify(a)).byteLength).toBeLessThanOrEqual(h.config.terminalFrameBytes)
    expect(process.pause).toHaveBeenCalledOnce()
    h.terminals.release({ attachmentId: first.ready.attachmentId, mode: 'park' })
    await expect(first.iterator.next()).resolves.toMatchObject({ done: true })
    expect(process.resume).not.toHaveBeenCalled()
    h.terminals.release({ attachmentId: second.ready.attachmentId, mode: 'park' })
    await expect(second.iterator.next()).resolves.toMatchObject({ done: true })
    expect(process.resume).toHaveBeenCalledOnce()
    expect(process.kill).not.toHaveBeenCalled()
    expect(process.dataListeners.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails and cleans the attachment when native output exceeds the hard budget after pause', async () => {
    const h = await load({ terminalFrameBytes: 512, terminalBufferBytes: 2048 })
    const a = await attach(h)
    const process = processes[0]!
    process.emitData('x'.repeat(1000))
    await readFrame(a.iterator, 'data')
    expect(process.pause).toHaveBeenCalledOnce()
    const failed = expect(a.iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
    expect(() => { process.emitData('y'.repeat(h.config.terminalBufferBytes + 1)) }).not.toThrow()
    await failed
    expect(process.resume).toHaveBeenCalledOnce()
    expect(process.dataListeners.size).toBe(1)
    expect(process.exitListeners.size).toBe(1)
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs)
    expect(process.kill).toHaveBeenCalledOnce()
    expect(process.exitListeners.size).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out an unacknowledged renderer and removes its native streaming listeners', async () => {
    const h = await load({ terminalAckTimeoutMs: 20 })
    const a = await attach(h)
    const process = processes[0]!
    process.emitData('waiting for xterm')
    await readFrame(a.iterator, 'data')
    const failed = expect(a.iterator.next()).rejects.toMatchObject({ code: 'ack-timeout' })
    await vi.advanceTimersByTimeAsync(h.config.terminalAckTimeoutMs)
    await failed
    expect(process.dataListeners.size).toBe(1)
    expect(() => { h.terminals.ack({ attachmentId: a.ready.attachmentId, sequence: 1 }) }).toThrow(expect.objectContaining({ code: 'stale-attachment' }))
    await vi.advanceTimersByTimeAsync(h.config.reconnectGraceMs)
    expect(process.kill).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('disposes streaming listeners and ACK timers before awaiting both native exits', async () => {
    const h = await load()
    const ui = await attach(h)
    const uuid = await createAgent(h)
    const agent = await attach(h, { target: { kind: 'agent', sessionId, uuid }, cols: 80, rows: 24 })
    for (const process of processes) { process.holdExit = true; process.emitData('pending output') }
    await readFrame(ui.iterator, 'data')
    await readFrame(agent.iterator, 'data')
    const uiPending = ui.iterator.next()
    const agentPending = agent.iterator.next()
    let disposed = false
    const disposal = h.ctx.fiber.dispose().then(() => { disposed = true })
    await Promise.all(processes.map(process => process.killRequested.promise))
    await expect(uiPending).resolves.toMatchObject({ done: true })
    await expect(agentPending).resolves.toMatchObject({ done: true })
    expect(disposed).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    for (const process of processes) {
      expect(process.dataListeners.size).toBe(1)
      expect(process.exitListeners.size).toBe(1)
    }
    processes[0]!.releaseExit()
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toBe(false)
    processes[1]!.releaseExit()
    await disposal
    expect(processes.map(process => process.kill.mock.calls.length)).toEqual([1, 1])
    expect(vi.getTimerCount()).toBe(0)
    for (const process of processes) {
      expect(process.exitListeners.size).toBe(1)
      process.emitData('late native callback')
    }
    await expect(ui.iterator.next()).resolves.toMatchObject({ done: true })
    await expect(agent.iterator.next()).resolves.toMatchObject({ done: true })
  })

  it('awaits native exit for an agent terminal that has never had a sidebar attachment', async () => {
    const h = await load()
    await createAgent(h)
    const process = processes[0]!
    process.holdExit = true
    let disposed = false
    const disposal = h.ctx.fiber.dispose().then(() => { disposed = true })
    await process.killRequested.promise
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toBe(false)
    process.releaseExit()
    await disposal
    expect(process.exited).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('awaits an unaccepted UI process already closed before provider shutdown', async () => {
    const h = await load()
    const late = await attach(h, uiRequest(), false)
    const process = processes[0]!
    process.holdExit = true
    late.lifetime.abort()
    await process.killRequested.promise
    await expect(late.iterator.next()).resolves.toMatchObject({ done: true })
    let disposed = false
    const disposal = h.ctx.fiber.dispose().then(() => { disposed = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(disposed).toBe(false)
    process.releaseExit()
    await disposal
    expect(process.kill).toHaveBeenCalledOnce()
    expect(process.exited).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('carries real terminal frames and controls through Gateway without a Web listener', async () => {
    const h = await load({}, true)
    expect(h.ctx.get('webServer')).toBeUndefined()
    expect(h.ctx.get('webRuntime')).toBeUndefined()
    const access = createTrustedConnectionAccess()
    const shared = h.ctx.connection.createSharedFetchHandler('/api', access)
    const response = await shared.fetch(new Request('dsh-app://app/api/sidebarTerminals/capability', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'terminal-capability', method: 'sidebarTerminals/capability', payload: { args: {} } }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ type: 'server-response', result: { ok: true, value: { status: 'available' } } })
    const lifetime = new AbortController()
    const source = await h.ctx.typertGateway.wireStream.open(
      'sidebarTerminals/open', { args: { request: uiRequest() } }, lifetime.signal, access,
    )
    const iterator = ownStream(source as AsyncIterable<SidebarTerminalFrame>, lifetime)
    const ready = await readFrame(iterator, 'ready')
    const call = (method: string, request: unknown) => h.ctx.typertGateway.invoke({
      access, namespace: 'sidebarTerminals', method, args: { request },
    })
    await call('ack', { attachmentId: ready.attachmentId, sequence: 0 })
    await call('input', { attachmentId: ready.attachmentId, data: 'from-gateway\r' })
    await call('resize', { attachmentId: ready.attachmentId, cols: 101, rows: 31 })
    const process = processes[0]!
    expect(process.write).toHaveBeenCalledWith('from-gateway\r')
    expect(process.resize).toHaveBeenCalledWith(101, 31)
    process.emitData('gateway output')
    const data = await readFrame(iterator, 'data')
    expect(data.data).toBe('gateway output')
    process.emitExit(4)
    await call('ack', { attachmentId: ready.attachmentId, sequence: data.sequence })
    expect(await readFrame(iterator, 'exit')).toMatchObject({ exitCode: 4 })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    expect(processes).toHaveLength(1)
  })
})
