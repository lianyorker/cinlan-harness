/** Scripted Subprocess fakes drive SshTargetConnection arms real OpenSSH cannot reach deterministically. */
import { PassThrough } from 'node:stream'
import { beforeEach, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@deepseek-ai/dsh-execution-host-worker/protocol'
import type { DirectoryInspection, WorkerInfo } from '@deepseek-ai/dsh-execution-host-worker/protocol'
import type { ExecutionHostId } from '@deepseek-ai/dsh-execution-host/types'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { SshTargetConnection } from '../src/connection.ts'
import type { Config } from '../src/config.ts'

const HOST_ID = 'worker-host-1' as ExecutionHostId
const INFO: WorkerInfo = {
  protocolVersion: PROTOCOL_VERSION,
  executionHost: { hostId: HOST_ID, hostname: 'fixture', pid: 7, platform: 'linux', createdAt: '2026-10-29T00:00:00Z' },
  roots: [{ id: 'project', label: 'Project', path: '/project' }],
  capabilities: ['directory-inspection'],
}
const INSPECTION: DirectoryInspection = {
  executionHostId: HOST_ID, rootId: 'project', path: '',
  entries: [{ name: 'a.txt', type: 'file' }], truncated: false,
}

const DEFAULT_CONFIG: Config = {
  sshExecutable: 'ssh', sshConfigFile: undefined as unknown as string,
  connectTimeoutMs: 500, operationTimeoutMs: 500, shutdownTimeoutMs: 100,
  maxFrameBytes: 64 * 1024, maxDiagnosticBytes: 8192, maxTargets: 4, maxConcurrentInspections: 16,
}

interface Frame { jsonrpc: '2.0'; id: string | number; method?: string; params?: Record<string, unknown>; result?: unknown }

class FakeHandle {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly control = undefined
  collected: { stderr?: { readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean } } } = {}
  readonly outcome = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
  get done() { return this.outcome.promise }
  terminated = false
  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
  }
  waitForExit(): Promise<boolean> { return Promise.resolve(true) }
}

const script = vi.hoisted(() => ({
  resolve: undefined as undefined | ((signal: AbortSignal) => Promise<string>),
  spawn: undefined as undefined | (() => FakeHandle),
  respond: undefined as undefined | ((frame: Frame, handle: FakeHandle, reply: (id: string | number, result: unknown) => void) => void),
}))

function subprocess(): SubprocessRuntime {
  const runtime = Object.create(SubprocessRuntime.prototype) as SubprocessRuntime
  Object.assign(runtime, {
    resolveExecutable: (_name: string, _cwd: string | undefined, signal: AbortSignal) =>
      (script.resolve ?? (async () => 'ssh'))(signal),
    spawn: () => script.spawn?.() as never,
    spawnTerminal: () => Promise.reject(new Error('terminal spawning is not exercised')),
  })
  return runtime
}

/** Capture JSON-RPC request frames and let the test script each response. */
function wire(handle: FakeHandle): { requests: Frame[] } {
  const requests: Frame[] = []
  let partial = ''
  handle.stdin.on('data', (chunk: Buffer) => {
    partial += chunk.toString('utf8')
    for (;;) {
      const newline = partial.indexOf('\n')
      if (newline < 0) return
      const line = partial.slice(0, newline)
      partial = partial.slice(newline + 1)
      if (line.length === 0) continue
      const frame = JSON.parse(line) as Frame
      requests.push(frame)
      script.respond?.(frame, handle, (id, result) => {
        handle.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
      })
    }
  })
  return { requests }
}

function connection(
  options: { config?: Partial<Config>; onLost?: (cleanup: Promise<boolean>) => void } = {},
): { conn: SshTargetConnection; handle: FakeHandle; lost: Promise<boolean>[] } {
  const handle = new FakeHandle()
  script.spawn = () => handle
  const lost: Promise<boolean>[] = []
  const conn = new SshTargetConnection(
    subprocess(), { ...DEFAULT_CONFIG, ...options.config }, 'fixture-alias', undefined,
    options.onLost ?? ((cleanup) => { lost.push(cleanup) }),
  )
  return { conn, handle, lost }
}

/** Default responder: initialize succeeds; anything else errors. */
function defaultInit(): void {
  script.respond = (frame, _handle, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
  }
}

beforeEach(() => {
  script.resolve = undefined
  script.spawn = undefined
  script.respond = undefined
})

it('maps worker failure codes at initialize to typed errors', async () => {
  for (const [code, expected] of [
    ['UNSUPPORTED_VERSION', 'incompatible'],
    ['CANCELLED', 'cancelled'],
    ['OPERATION_TIMEOUT', 'timeout'],
  ] as const) {
    const { conn, handle } = connection()
    wire(handle)
    script.respond = (frame, _handle, reply) => {
      if (frame.method === 'initialize') reply(frame.id, { ok: false, error: { code, message: 'refused' } })
    }
    await expect(conn.open(new AbortController().signal)).rejects.toMatchObject({ code: expected })
    await conn.close()
  }
})

it('classifies resolver cancellation, timeout, and unavailable SSH', async () => {
  const caller = new AbortController()
  script.resolve = (signal) => {
    signal.addEventListener('abort', () => {}, { once: true })
    caller.abort(new Error('stop'))
    return Promise.reject(new Error('aborted lookup'))
  }
  const first = connection()
  await expect(first.conn.open(caller.signal)).rejects.toMatchObject({ code: 'cancelled' })

  script.resolve = signal => new Promise<string>((resolve, reject) => {
    signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    setTimeout(() => { resolve('ssh') }, 200)
  })
  const second = connection({ config: { connectTimeoutMs: 20 } })
  await expect(second.conn.open()).rejects.toMatchObject({ code: 'timeout' })

  script.resolve = () => Promise.reject(new Error('lookup boom'))
  const third = connection()
  await expect(third.conn.open()).rejects.toMatchObject({ code: 'ssh-unavailable' })
})

it('classifies caller cancellation that lands while the executable resolves', async () => {
  const caller = new AbortController()
  script.resolve = () => new Promise((resolve) => { setTimeout(() => { resolve('ssh') }, 40) })
  const { conn, handle } = connection({ config: { connectTimeoutMs: 2000 } })
  const opening = conn.open(caller.signal)
  setTimeout(() => { caller.abort(new Error('caller stopped')) }, 5)
  await expect(opening).rejects.toMatchObject({ code: 'cancelled' })
  await conn.close()
  handle.stdin.destroy()
})

it('times out while the executable resolves and while the worker negotiates', async () => {
  script.resolve = () => new Promise((resolve) => { setTimeout(() => { resolve('ssh') }, 50) })
  const slow = connection({ config: { connectTimeoutMs: 10 } })
  await expect(slow.conn.open()).rejects.toMatchObject({ code: 'timeout' })

  script.resolve = undefined
  const hang = connection({ config: { connectTimeoutMs: 20 } })
  script.respond = () => { /* never answers */ }
  await expect(hang.conn.open()).rejects.toMatchObject({ code: 'timeout' })
})

it('aborts caller cancellation during open and classifies it', async () => {
  const caller = new AbortController()
  const { conn, handle } = connection()
  wire(handle)
  script.respond = (frame) => {
    if (frame.method === 'initialize') caller.abort(new Error('abort during init'))
  }
  await expect(conn.open(caller.signal)).rejects.toMatchObject({ code: 'cancelled' })
})

it('swallows a rejected process outcome while a failed open cleans up', async () => {
  const { conn, handle } = connection()
  wire(handle)
  script.respond = (frame, sink) => {
    if (frame.method === 'initialize') {
      handle.outcome.reject(new Error('provider lost the process'))
      sink.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'boom' } }) + '\n')
    }
  }
  await expect(conn.open()).rejects.toMatchObject({ code: 'unreachable' })
})

it('rejects a handle that does not expose protocol pipes', async () => {
  const bare = new FakeHandle()
  Object.defineProperty(bare, 'stdin', { value: undefined })
  const { conn } = connection()
  script.spawn = () => bare
  await expect(conn.open()).rejects.toThrow(/must expose protocol pipes/)
})

it('classifies malformed responses, JSON-RPC errors, and stderr diagnostics', async () => {
  const bad = connection()
  wire(bad.handle)
  script.respond = (frame, handle) => {
    if (frame.method === 'initialize') handle.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: 'junk' }) + '\n')
  }
  await expect(bad.conn.open()).rejects.toMatchObject({ code: 'incompatible' })

  for (const [diagnostic, expected] of [
    ['REMOTE HOST IDENTIFICATION HAS CHANGED', 'host-key-mismatch'],
    ['Permission denied (publickey)', 'authentication-required'],
    ['dsh: command not found', 'incompatible'],
    ['connection reset by peer', 'unreachable'],
  ] as const) {
    const { conn, handle } = connection()
    wire(handle)
    handle.collected.stderr = { readFrom: () => ({ text: diagnostic, nextOffset: diagnostic.length, lossy: false }) }
    script.respond = (frame, sink) => {
      if (frame.method === 'initialize') {
        sink.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'boom' } }) + '\n')
      }
    }
    await expect(conn.open()).rejects.toMatchObject({ code: expected })
    await conn.close()
  }

  const silent = connection()
  wire(silent.handle)
  script.respond = (frame, sink) => {
    if (frame.method === 'initialize') {
      sink.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32000, message: 'boom' } }) + '\n')
    }
  }
  await expect(silent.conn.open()).rejects.toMatchObject({ code: 'unreachable' })
})

it('ignores stdin errors and marks the connection lost when the process settles', async () => {
  const { conn, handle, lost } = connection()
  wire(handle)
  defaultInit()
  await conn.open()
  expect(conn.isUsable()).toBe(true)
  handle.stdin.emit('error', new Error('broken pipe'))
  handle.outcome.reject(new Error('provider failed'))
  await vi.waitFor(() => { expect(lost.length).toBe(1) })
  expect(conn.isUsable()).toBe(false)
  await expect(conn.inspect('project', '')).rejects.toMatchObject({ code: 'connection-lost' })
  await lost[0]
})

it('marks the connection lost when the transport closes', async () => {
  const { conn, handle, lost } = connection()
  wire(handle)
  defaultInit()
  await conn.open()
  handle.stdout.emit('close')
  await vi.waitFor(() => { expect(lost.length).toBe(1) })
  expect(conn.isUsable()).toBe(false)
})

it('rejects inspection before open, after close, beyond the concurrency cap, and pre-aborted', async () => {
  const { conn, handle } = connection({ config: { maxConcurrentInspections: 1 } })
  await expect(conn.inspect('project', '')).rejects.toMatchObject({ code: 'connection-lost' })

  wire(handle)
  let inspectId: string | number | undefined
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'inspectDirectory') inspectId = frame.id
    if (frame.method === 'cancel') {
      reply(frame.id, { ok: true, value: { settled: true } })
      reply(inspectId!, { ok: false, error: { code: 'CANCELLED', message: 'settled' } })
    }
  }
  await conn.open()

  const preAborted = new AbortController()
  preAborted.abort(new Error('pre-aborted'))
  await expect(conn.inspect('project', 'x', preAborted.signal)).rejects.toMatchObject({ code: 'cancelled' })

  const held = conn.inspect('project', 'dir')
  await vi.waitFor(() => { expect(inspectId).toBeDefined() })
  await expect(conn.inspect('project', 'other')).rejects.toMatchObject({ code: 'limit-reached' })

  await conn.close()
  await expect(conn.inspect('project', '')).rejects.toMatchObject({ code: 'connection-lost' })
  await expect(held).rejects.toMatchObject({ code: 'cancelled' })
})

it('confirms remote cancellation before surfacing the caller abort', async () => {
  const { conn, handle } = connection()
  wire(handle)
  let inspectId: string | number | undefined
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'inspectDirectory') inspectId = frame.id
    if (frame.method === 'cancel') {
      reply(frame.id, { ok: true, value: { settled: true } })
      reply(inspectId!, { ok: false, error: { code: 'CANCELLED', message: 'settled' } })
    }
  }
  await conn.open()
  const caller = new AbortController()
  const inspecting = conn.inspect('project', 'dir', caller.signal)
  await vi.waitFor(() => { expect(inspectId).toBeDefined() })
  caller.abort(new Error('caller stopped'))
  await expect(inspecting).rejects.toMatchObject({ code: 'cancelled' })
  await conn.close()
})

it('fails with outcome-unconfirmed when cancellation is not acknowledged or the outcome never settles', async () => {
  const { conn, handle } = connection()
  wire(handle)
  let inspectId: string | number | undefined
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'inspectDirectory') inspectId = frame.id
    if (frame.method === 'cancel') reply(frame.id, { ok: false, error: { code: 'X', message: 'denied' } })
  }
  await conn.open()
  const caller = new AbortController()
  const inspecting = conn.inspect('project', 'dir', caller.signal)
  await vi.waitFor(() => { expect(inspectId).toBeDefined() })
  caller.abort(new Error('stop'))
  await expect(inspecting).rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  expect(conn.isUsable()).toBe(false)
  await conn.close()
})

it('marks the connection lost when the acknowledged inspection then never resolves', async () => {
  const { conn, handle } = connection()
  wire(handle)
  let inspectId: string | number | undefined
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'inspectDirectory') inspectId = frame.id
    if (frame.method === 'cancel') reply(frame.id, { ok: true, value: { settled: true } })
  }
  await conn.open()
  const caller = new AbortController()
  const inspecting = conn.inspect('project', 'dir', caller.signal)
  await vi.waitFor(() => { expect(inspectId).toBeDefined() })
  caller.abort(new Error('stop'))
  await expect(inspecting).rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  expect(conn.isUsable()).toBe(false)
  await conn.close()
})

it('rejects unconfirmed worker results when the transport dies mid-inspection', async () => {
  const { conn, handle, lost } = connection()
  wire(handle)
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
  }
  await conn.open()
  const inspecting = conn.inspect('project', 'dir')
  await new Promise((resolve) => { setTimeout(resolve, 10) })
  handle.stdout.emit('close')
  await expect(inspecting).rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  await vi.waitFor(() => { expect(lost.length).toBe(1) })
})

it('returns a directory inspection for an open usable connection', async () => {
  const { conn, handle } = connection()
  wire(handle)
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'inspectDirectory') reply(frame.id, { ok: true, value: INSPECTION })
  }
  await conn.open()
  await expect(conn.inspect('project', 'sub/dir')).resolves.toMatchObject({ executionHostId: HOST_ID })
  await conn.close()
})

it('shutdown request failures still terminate the local process during close', async () => {
  const { conn, handle } = connection()
  wire(handle)
  script.respond = (frame, _h, reply) => {
    if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
    if (frame.method === 'shutdown') { /* no acknowledgement */ }
  }
  await conn.open()
  handle.stdout.emit('close')
  await expect(conn.close()).resolves.toBe(true)
  expect(handle.terminated).toBe(true)
})
