/** Scripted Subprocess provider injected at Loader level; drives registry arms real OpenSSH cannot reach. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PassThrough } from 'node:stream'
import { afterAll, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import ExecutionHostLocal from '@deepseek-ai/dsh-execution-host-local'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec, SubprocessTerminalEnvironment, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { PROTOCOL_VERSION } from '@deepseek-ai/dsh-execution-host-worker/protocol'
import type { DirectoryInspection, WorkerInfo } from '@deepseek-ai/dsh-execution-host-worker/protocol'
import type { ExecutionHostId } from '@deepseek-ai/dsh-execution-host/types'
import Targets from '../src/index.ts'
import { executionTargetsDomain } from '../src/spec.ts'
import { readImportableHosts } from '../src/import.ts'
import type { Config } from '../src/config.ts'
import type { ExecutionTargetId, SshExecutionSnapshot, StoredTarget } from '../src/types.ts'

const HOST_ID = 'edge-worker-1' as ExecutionHostId
const INFO: WorkerInfo = {
  protocolVersion: PROTOCOL_VERSION,
  executionHost: { hostId: HOST_ID, hostname: 'edge', pid: 3, platform: 'linux', createdAt: '2026-10-29T00:00:00Z' },
  roots: [{ id: 'project', label: 'Project', path: '/project' }],
  capabilities: ['directory-inspection'],
}
const INSPECTION: DirectoryInspection = {
  executionHostId: HOST_ID, rootId: 'project', path: '', entries: [{ name: 'a.txt', type: 'file' }], truncated: false,
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
  exitFailure: Error | undefined
  terminate(): void {
    if (this.terminated) return
    this.terminated = true
    this.outcome.resolve({ exitCode: null, signal: 'SIGTERM' })
  }
  waitForExit(): Promise<boolean> {
    return this.exitFailure === undefined ? Promise.resolve(true) : Promise.reject(this.exitFailure)
  }
}

const fake = vi.hoisted(() => ({
  handles: [] as FakeHandle[],
  onSpawn: undefined as undefined | ((handle: FakeHandle) => void),
  respond: undefined as undefined | ((frame: Frame, handle: FakeHandle, reply: (id: string | number, result: unknown) => void) => void),
}))

class FakeSubprocess extends SubprocessRuntime {
  resolveExecutable(): Promise<string> { return Promise.resolve('ssh') }
  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
    const handle = new FakeHandle()
    fake.handles.push(handle)
    fake.onSpawn?.(handle)
    return handle as unknown as SubprocessHandle
  }
  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('terminal spawning is not exercised'))
  }
  terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return Promise.reject(new Error('terminal environment is not exercised'))
  }
}

/** Capture JSON-RPC request frames written to the fake process and respond per the script hook. */
function wire(handle: FakeHandle): void {
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
      fake.respond?.(frame, handle, (id, result) => {
        handle.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
      })
    }
  })
}

beforeEach(() => {
  fake.handles = []
  fake.onSpawn = (handle) => {
    wire(handle)
    fake.respond = (frame, _handle, reply) => {
      if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
      if (frame.method === 'inspectDirectory') reply(frame.id, { ok: true, value: INSPECTION })
      if (frame.method === 'cancel') reply(frame.id, { ok: true, value: { settled: true } })
      if (frame.method === 'shutdown') reply(frame.id, { ok: true, value: {} })
    }
  }
  fake.respond = undefined
})

let sequence = 0
const cleanups: (() => Promise<void>)[] = []
afterAll(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function boot(root: string, options: { config?: Record<string, unknown>; store?: string; storageOnly?: boolean } = {}) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const loggedErrors: unknown[] = []
  const loggedWarns: unknown[] = []
  const error = ctx.logger.error.bind(ctx.logger)
  const capture = (seen: unknown[], sink: (...args: unknown[]) => void) => (...args: unknown[]) => {
    seen.push(args.length === 1 ? args[0] : args)
    sink(...args)
  }
  ctx.logger.error = capture(loggedErrors, error) as typeof ctx.logger.error
  ctx.logger.warn = capture(loggedWarns, ctx.logger.warn.bind(ctx.logger)) as typeof ctx.logger.warn
  const dir = join(root, 'edges-' + String(++sequence))
  await mkdir(dir, { recursive: true })
  ctx.baseUrl = pathToFileURL(dir).href + '/'
  const file = join(dir, 'cordis.yml')
  const rows = [
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: options.store ?? join(root, 'storage') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    ...options.storageOnly === true ? [] : [
      { name: '@deepseek-ai/dsh-execution-host-local' },
      { name: '@deepseek-ai/dsh-subprocess-local' },
      { name: '@deepseek-ai/dsh-execution-host-targets', config: { sshConfigFile: join(root, 'ssh_config'), ...options.config } },
    ],
  ]
  await writeFile(file, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected edges fixture import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return { ctx, targets: ctx.executionHostTargets, loggedErrors, loggedWarns }
}

const modules = new Map<string, unknown>([
  ['@deepseek-ai/dsh-storage', Storage],
  ['@deepseek-ai/dsh-storage-json', StorageJson],
  ['@deepseek-ai/dsh-storage-domain', StorageDomain],
  ['@deepseek-ai/dsh-execution-host-local', ExecutionHostLocal],
  ['@deepseek-ai/dsh-subprocess-local', { default: FakeSubprocess }],
  ['@deepseek-ai/dsh-execution-host-targets', Targets],
])

async function fixture(): Promise<{ root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-targets-edges-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'ssh_config'), 'Host base\n  HostName example.invalid\n')
  return { root }
}

const KEY = 'c'.repeat(64)
function execution(root: string, full = false) {
  return {
    endpoint: {
      host: 'target.local', port: 2222, username: 'dev', privateKeyFile: join(root, 'key'), hostKeySHA256: KEY,
      ...(full ? { proxyCommand: 'nc %h %p', jumpHost: 'bastion', multiplex: true,
        keepAliveIntervalSeconds: 30, connectTimeoutSeconds: 10 } : {}),
    },
    node: '/usr/bin/node', helper: '/opt/helper.js', helperHash: 'd'.repeat(64),
    workspace: '/opt/workspace', bootstrapPath: '/opt/boot.js', bootstrapHash: 'e'.repeat(64),
  }
}

function snapshotFor(targetId: ExecutionTargetId, revision: number, root: string, full = false): SshExecutionSnapshot {
  const { privateKeyFile: _drop, ...endpoint } = execution(root, full).endpoint
  return { kind: 'ssh', targetId, revision, endpoint: Object.freeze(endpoint) as SshExecutionSnapshot['endpoint'],
    node: '/usr/bin/node', helper: '/opt/helper.js', helperHash: 'd'.repeat(64), workspace: '/opt/workspace',
    bootstrapPath: '/opt/boot.js', bootstrapHash: 'e'.repeat(64) }
}

it('rejects a stored record whose key does not match its record id', async () => {
  const { root } = await fixture()
  const first = await boot(root)
  const created = await first.targets.create({ label: 'one', sshAlias: 'base' })
  await first.ctx.fiber.dispose()

  const writer = await boot(root, { storageOnly: true })
  const domain = await writer.ctx.storageDomain.open(executionTargetsDomain)
  const record: StoredTarget = {
    label: created.target.label, sshAlias: created.target.sshAlias, id: created.target.id,
    revision: created.target.revision, createdAt: created.target.createdAt, updatedAt: created.target.updatedAt,
    retainedExecutions: {},
  }
  await domain.table('targets').put('foreign-key' as ExecutionTargetId, record)
  await domain.close()
  await writer.ctx.fiber.dispose()

  const second = await boot(root, { store: join(root, 'storage') })
  expect(second.loggedErrors.join(' ')).toContain('record identity does not match')
})

it('enforces the saved-target cap', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root, { config: { maxTargets: 1 } })
  await targets.create({ label: 'one', sshAlias: 'base' })
  await expect(targets.create({ label: 'two', sshAlias: 'base' })).rejects.toMatchObject({ code: 'limit-reached' })
})

it('copies every defined endpoint refinement into durable snapshots and stacks reservations', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'full', sshAlias: 'base', execution: execution(root, true) })
  const snapshot = snapshotFor(created.target.id, created.target.revision, root, true)
  const resolved = targets.resolveExecution(snapshot)
  expect(resolved.endpoint).toMatchObject({ proxyCommand: 'nc %h %p', jumpHost: 'bastion', multiplex: true,
    keepAliveIntervalSeconds: 30, connectTimeoutSeconds: 10 })
  const first = targets.reserveExecution(snapshot)
  const second = targets.reserveExecution(snapshot)
  first.release()
  second.release()
  await expect(targets.disconnect({ id: '00000000-0000-4000-8000-000000000000' as ExecutionTargetId }))
    .rejects.toMatchObject({ code: 'not-found' })
})

it('skips diagnostics-only lines while parsing the OpenSSH configuration', async () => {
  const { root } = await fixture()
  const configFile = join(root, 'ssh_config')
  await writeFile(configFile, 'Host one\n  HostName example.local\n=\n  =   \nHost two\n  HostName two.local\n')
  const { targets } = await boot(root)
  const result = await targets.listImportableHosts()
  expect(result.entries.map(entry => entry.alias)).toEqual(['one', 'two'])
  const fallback = await readImportableHosts(JSON.parse(JSON.stringify({
    sshExecutable: 'ssh', connectTimeoutMs: 1000, operationTimeoutMs: 1000, shutdownTimeoutMs: 1000,
    maxFrameBytes: 1024, maxDiagnosticBytes: 1024, maxTargets: 1, maxConcurrentInspections: 1, sshConfigFile: undefined,
  })) as Config)
  expect(fallback.source).toContain('.ssh')
})

it('connects a scripted worker and reports loss cleanup failures', async () => {
  const { root } = await fixture()
  const { targets, ctx, loggedErrors } = await boot(root)
  const created = await targets.create({ label: 'live', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  const handle = fake.handles.at(-1)!
  handle.exitFailure = new Error('provider could not observe exit')
  handle.stdout.emit('close')
  await vi.waitFor(() => { expect(loggedErrors.join(' ')).toContain('Execution target SSH cleanup failed') })
  expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('error')
  await ctx.fiber.dispose()
})

it('connects a scripted worker and marks the state error when the worker then dies', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'dying', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  fake.handles.at(-1)!.stdout.emit('close')
  await vi.waitFor(() => {
    expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('error')
  })
})

it('classifies superseded, caller-cancelled, and untyped connect failures', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'raced', sshAlias: 'base' })

  fake.onSpawn = (handle) => {
    wire(handle)
    fake.respond = (frame, source, reply) => {
      if (frame.method === 'cancel') { reply(frame.id, { ok: true, value: { settled: true } }); return }
      if (frame.method === 'shutdown') { reply(frame.id, { ok: true, value: {} }); return }
      if (source === fake.handles[0]) return
      if (frame.method === 'initialize') reply(frame.id, { ok: true, value: INFO })
      if (frame.method === 'inspectDirectory') reply(frame.id, { ok: true, value: INSPECTION })
    }
  }
  const first = targets.connect({ id: created.target.id, revision: created.target.revision })
  await vi.waitFor(() => { expect(fake.handles.length).toBe(1) })
  const second = targets.connect({ id: created.target.id, revision: created.target.revision })
  await expect(first).rejects.toMatchObject({ code: 'unreachable' })
  await second
  expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('ready')

  const caller = new AbortController()
  fake.onSpawn = (handle) => {
    wire(handle)
    fake.respond = (frame, _source, reply) => {
      if (frame.method === 'cancel') reply(frame.id, { ok: true, value: { settled: true } })
      if (frame.method === 'shutdown') reply(frame.id, { ok: true, value: {} })
      if (frame.method === 'initialize') caller.abort(new Error('stop'))
    }
  }
  const thirdRecord = await targets.create({ label: 'cancelled', sshAlias: 'base' })
  await expect(targets.connect({ id: thirdRecord.target.id, revision: thirdRecord.target.revision }, caller.signal))
    .rejects.toMatchObject({ code: 'cancelled' })

  fake.onSpawn = (handle) => {
    Object.defineProperty(handle, 'stdin', { value: undefined })
  }
  const fourth = await targets.create({ label: 'untyped', sshAlias: 'base' })
  await expect(targets.connect({ id: fourth.target.id, revision: fourth.target.revision }))
    .rejects.toMatchObject({ code: 'unreachable' })

  fake.onSpawn = (handle) => { wire(handle) }
  fake.respond = (frame, _source, reply) => {
    if (frame.method === 'cancel') reply(frame.id, { ok: true, value: { settled: true } })
    if (frame.method === 'shutdown') reply(frame.id, { ok: true, value: {} })
    if (frame.method === 'initialize') reply(frame.id, { ok: false, error: { code: 'OPERATION_TIMEOUT', message: 'timed out' } })
  }
  const fifth = await targets.create({ label: 'typed', sshAlias: 'base' })
  await expect(targets.connect({ id: fifth.target.id, revision: fifth.target.revision }))
    .rejects.toMatchObject({ code: 'timeout' })
})

it('drops a lost probe connection without touching live state', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'probe', sshAlias: 'base' })
  fake.onSpawn = (handle) => {
    wire(handle)
    fake.respond = (frame, _source, reply) => {
      if (frame.method === 'initialize') {
        reply(frame.id, { ok: true, value: INFO })
        handle.stdout.emit('close')
      }
    }
  }
  await expect(targets.test({ id: created.target.id, revision: created.target.revision }))
    .resolves.toMatchObject({ rootCount: 1 })
})

it('rejects an inspection whose worker dropped the transport mid-flight', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'expire', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  const generation = (targets.list().targets.find(target => target.id === created.target.id)!.state as { generation: number }).generation
  fake.respond = (frame, handle, reply) => {
    if (frame.method === 'inspectDirectory') {
      reply(frame.id, { ok: true, value: INSPECTION })
      handle.stdout.emit('close')
    }
  }
  await expect(targets.inspectDirectory({ id: created.target.id, generation, rootId: 'project', path: 'x' }))
    .rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('error')
})

it('propagates the caller abort reason when it lands while the prior connection closes', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'slowclose', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  const slow = fake.handles.at(-1)!
  slow.terminate = () => {
    slow.terminated = true
    setTimeout(() => { slow.outcome.resolve({ exitCode: null, signal: 'SIGTERM' }) }, 60)
  }
  const caller = new AbortController()
  const second = targets.connect({ id: created.target.id, revision: created.target.revision }, caller.signal)
  await vi.waitFor(() => { expect(slow.terminated).toBe(true) })
  caller.abort(new Error('stopped'))
  await expect(second).rejects.toThrowError('stopped')
})

it('reports local cleanup failure during disconnect', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'dirty', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  fake.handles.at(-1)!.exitFailure = new Error('provider could not observe exit')
  await expect(targets.disconnect({ id: created.target.id })).rejects.toMatchObject({ code: 'connection-lost' })
  expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('error')
})

it('surfaces unconfirmed inspection outcomes during disconnect', async () => {
  const { root } = await fixture()
  const { targets } = await boot(root)
  const created = await targets.create({ label: 'unconfirmed', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  const generation = (targets.list().targets.find(target => target.id === created.target.id)!.state as { generation: number }).generation
  fake.respond = (frame, handle, reply) => {
    if (frame.method === 'cancel') {
      reply(frame.id, { ok: true, value: { settled: true } })
      handle.stdout.emit('close')
    }
  }
  const inspecting = targets.inspectDirectory({ id: created.target.id, generation, rootId: 'project', path: 'x' })
  await expect(targets.disconnect({ id: created.target.id })).rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  await expect(inspecting).rejects.toMatchObject({ code: 'outcome-unconfirmed' })
  expect(targets.list().targets.find(target => target.id === created.target.id)!.state.phase).toBe('error')
})

it('reports connection cleanup failures during service dispose', async () => {
  const { root } = await fixture()
  const { targets, ctx, loggedErrors } = await boot(root)
  const created = await targets.create({ label: 'disposal', sshAlias: 'base' })
  await targets.connect({ id: created.target.id, revision: created.target.revision })
  fake.handles.at(-1)!.exitFailure = new Error('provider could not observe exit')
  await ctx.fiber.dispose()
  expect(loggedErrors.some(error => error instanceof AggregateError)).toBe(true)
})
