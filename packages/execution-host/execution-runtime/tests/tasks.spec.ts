/** Loader-admitted Host tasks retain ownership across observation detachment and target CAS races. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { expect, it, onTestFinished, vi } from 'vitest'
import Runtime from '../src/index.ts'
import { RuntimeConnectionError } from '../src/transport.ts'
import type { RuntimeGeneration, RuntimeInspection, RuntimeStartRequest } from '../src/types.ts'
import type { ExecutionTargetId, TargetView } from '@deepseek-ai/dsh-execution-host-targets/types'

const fixture = vi.hoisted(() => ({ run: vi.fn(), artifact: vi.fn() }))
vi.mock('../src/transport.ts', () => ({
  RuntimeConnectionError: class RuntimeConnectionError extends Error {},
  runRemoteOperation: fixture.run,
}))
vi.mock('../src/artifact.ts', () => ({ readRuntimeArtifact: fixture.artifact }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})

async function harness(options: { config?: Record<string, unknown>; secondTarget?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-loader-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const target: TargetView = { id: 'runtime-target' as ExecutionTargetId, label: 'Fixture', sshAlias: 'fixture', revision: 1,
    createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', state: { phase: 'disconnected' } }
  const target2: TargetView = { ...target, id: 'runtime-target-2' as ExecutionTargetId }
  const targets = options.secondTarget ? [target, target2] : [target]
  const request: RuntimeStartRequest = { operation: 'install', target: { id: target.id, revision: 1 },
    endpoint: { host: '127.0.0.1', port: 22, username: 'fixture', privateKeyFile: join(root, 'key'), hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', installRoot: '/opt/fixture/runtime', workspace: '/opt/fixture/workspace' }
  let revision = 1
  const activate = vi.fn(async () => {
    if (revision !== request.target.revision) throw new Error('Saved target changed')
    revision++
    return { target: { ...target, revision, execution: { ...request, endpoint: request.endpoint } } }
  })
  ctx.provide('executionHostTargets')
  ctx.set('executionHostTargets', { list: () => ({ targets }), activateExecution: activate })
  const runtime: RuntimeInspection = { state: 'installed', platform: 'linux', arch: 'x64', node: '/usr/bin/node', nodeVersion: 'v24.9.0',
    installRoot: request.installRoot, generation: 'a'.repeat(64) as RuntimeGeneration, helper: '/opt/fixture/runtime/generations/a/helper.js',
    helperHash: 'b'.repeat(64), bootstrapPath: '/opt/fixture/runtime/generations/a/process.js', bootstrapHash: 'c'.repeat(64), protocol: 1 }
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  fixture.artifact.mockResolvedValue({ generation: runtime.generation })
  fixture.run.mockImplementation(async (_location, _generation, _limits, _artifact, signal: AbortSignal) => {
    entered.resolve(undefined)
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { reject(new Error('task cancelled')) }
      signal.addEventListener('abort', abort, { once: true })
      void release.promise.then(() => { signal.removeEventListener('abort', abort); resolve() })
      if (signal.aborted) abort()
    })
    return runtime
  })
  const file = join(root, 'cordis.yml')
  const config = { artifactDirectory: root, manifestSHA256: 'a'.repeat(64), ...options.config }
  await writeFile(file, '- ' + JSON.stringify({ name: 'runtime', config }) + '\n')
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', import: async (name: string) => {
    if (name === 'runtime') return Runtime
    throw new Error('Unexpected fixture plugin')
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
  return { ctx, request, entered: entered.promise, release: () => { release.resolve(undefined) }, activate,
    changeRevision: () => { revision++ }, target2 }
}

it('keeps installation alive after observer detach and lists its receipt after Client reload', async () => {
  const h = await harness()
  const receipt = h.ctx.executionRuntimes.start(h.request)
  await h.entered
  const observer = new AbortController()
  const follow = h.ctx.executionRuntimes.follow({ id: receipt.task.id }, observer.signal)
  const initial = await follow.next()
  if (initial.done) throw new Error('Task stream ended before initial receipt')
  expect(initial.value.task.state).toBe('running')
  const waiting = expect(follow.next()).rejects.toThrow('detach')
  observer.abort(new Error('detach')); await waiting
  expect(h.ctx.executionRuntimes.listTasks().tasks).toHaveLength(1)
  expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('running')
  h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('succeeded') })
  expect(JSON.stringify(h.ctx.executionRuntimes.listTasks())).not.toContain('privateKeyFile')
  expect(h.activate).toHaveBeenCalledOnce()
})

it('classifies SSH transport failures without exposing their raw diagnostics', async () => {
  const h = await harness()
  fixture.run.mockRejectedValueOnce(new RuntimeConnectionError(new Error('secret SSH peer detail')))
  await expect(h.ctx.executionRuntimes.detect({ endpoint: h.request.endpoint, node: h.request.node,
    installRoot: h.request.installRoot, workspace: h.request.workspace })).rejects.toMatchObject({
    code: 'connection-failed', message: 'The pinned SSH connection could not complete the runtime operation.',
  })
  const receipt = h.ctx.executionRuntimes.start(h.request)
  fixture.run.mockRejectedValueOnce(new RuntimeConnectionError(new Error('second secret SSH peer detail')))
  await vi.waitFor(() => {
    expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task).toMatchObject({
      state: 'failed', error: 'The pinned SSH connection could not complete the runtime operation.',
    })
  })
  expect(JSON.stringify(h.ctx.executionRuntimes.get({ id: receipt.task.id }))).not.toContain('secret')
})

it('publishes a terminal receipt when a task settles between follow pulls', async () => {
  const h = await harness(); const receipt = h.ctx.executionRuntimes.start(h.request); await h.entered
  const follow = h.ctx.executionRuntimes.follow({ id: receipt.task.id })
  const initial = await follow.next()
  if (initial.done) throw new Error('Task stream ended before initial receipt')
  expect(initial.value.task.state).toBe('running')
  h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('succeeded') })
  const terminal = await follow.next()
  if (terminal.done) throw new Error('Task stream ended without terminal receipt')
  expect(terminal.value.task.state).toBe('succeeded')
  expect((await follow.next()).done).toBe(true)
})

it('cancels exactly one task before target activation and settles cleanup', async () => {
  const h = await harness(); const receipt = h.ctx.executionRuntimes.start(h.request); await h.entered
  await expect(h.ctx.executionRuntimes.cancel({ id: receipt.task.id })).resolves.toMatchObject({ task: { state: 'cancelled' } })
  expect(h.activate).not.toHaveBeenCalled()
  expect(() => h.ctx.executionRuntimes.start(h.request)).not.toThrow()
  h.release()
})

it('keeps the saved configuration unchanged when the target revision changes during transfer', async () => {
  const h = await harness(); const receipt = h.ctx.executionRuntimes.start(h.request); await h.entered
  h.changeRevision(); h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task).toMatchObject({ state: 'failed', error: 'The saved target changed before runtime activation. Refresh the target and try again.' }) })
})

it('retains success if explicit cancellation arrives after activation commits', async () => {
  const h = await harness(); const receipt = h.ctx.executionRuntimes.start(h.request); await h.entered
  h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('succeeded') })
  await expect(h.ctx.executionRuntimes.cancel({ id: receipt.task.id })).resolves.toMatchObject({ task: { state: 'succeeded' } })
  expect(h.activate).toHaveBeenCalledOnce()
})

it('rejects malformed start requests before opening any remote operation', async () => {
  const h = await harness()
  expect(() => h.ctx.executionRuntimes.start({ ...h.request, operation: 'redeploy' as never }))
    .toThrow(/configuration is invalid/)
  expect(() => h.ctx.executionRuntimes.start({ ...h.request, target: { id: 'other' as never, revision: 1 } }))
    .toThrow(/changed/)
  expect(() => h.ctx.executionRuntimes.start({ ...h.request, target: { ...h.request.target, revision: 99 } }))
    .toThrow(/changed/)
  expect(() => h.ctx.executionRuntimes.start({ ...h.request, node: 'relative/node' }))
    .toThrow(/configuration is invalid/)
  expect(() => h.ctx.executionRuntimes.start({ ...h.request, operation: 'update' }))
    .toThrow(/Choose install for an empty target/)
})

it('rejects a second running installation on the same target', async () => {
  const h = await harness()
  h.ctx.executionRuntimes.start(h.request)
  await h.entered
  expect(() => h.ctx.executionRuntimes.start(h.request)).toThrow(/already has a running/)
  h.release()
})

it('evicts the oldest settled receipt once the retention cap fills', async () => {
  const h = await harness({ config: { maxRetainedTasks: 1 }, secondTarget: true })
  const first = h.ctx.executionRuntimes.start(h.request)
  await h.entered
  const second: RuntimeStartRequest = { ...h.request, target: { id: h.target2.id, revision: 1 } }
  expect(() => h.ctx.executionRuntimes.start(second)).toThrow(/task limit|limit reached/i)
  h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: first.task.id }).task.state).toBe('succeeded') })
  h.activate.mockImplementationOnce(async () => ({
    target: { ...h.target2, revision: 2, execution: { ...h.request, endpoint: h.request.endpoint } as never },
  }))
  const again = h.ctx.executionRuntimes.start(second)
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: again.task.id }).task.state).toBe('succeeded') })
  expect(h.ctx.executionRuntimes.listTasks().tasks.map(task => task.id)).toEqual([again.task.id])
})

it('reports verification failure when the remote runtime omits required entries', async () => {
  const h = await harness()
  fixture.run.mockResolvedValueOnce({ state: 'installed', platform: 'linux', arch: 'x64' } as RuntimeInspection)
  const receipt = h.ctx.executionRuntimes.start(h.request)
  await vi.waitFor(() => {
    expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('failed')
  })
})

it('reports the saved-target CAS failure when activation rejects', async () => {
  const h = await harness()
  h.activate.mockRejectedValueOnce(new Error('storage exploded'))
  const receipt = h.ctx.executionRuntimes.start(h.request)
  h.release()
  await vi.waitFor(() => {
    expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task)
      .toMatchObject({ state: 'failed', error: 'The saved target changed before runtime activation. Refresh the target and try again.' })
  })
})

it('throws for unknown retained task ids and follows settled tasks once', async () => {
  const h = await harness()
  const receipt = h.ctx.executionRuntimes.start(h.request)
  h.release()
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('succeeded') })
  expect(() => h.ctx.executionRuntimes.get({ id: 'runtime-task-missing' as never })).toThrow(/not retained/)
  const follow = h.ctx.executionRuntimes.follow({ id: receipt.task.id })
  const initial = await follow.next()
  if (initial.done) throw new Error('Settled task stream ended before the receipt')
  expect(initial.value.task.state).toBe('succeeded')
  expect((await follow.next()).done).toBe(true)
})

it('delegates ephemeral VM lifecycle calls to the manager', async () => {
  const h = await harness()
  const runtimes = h.ctx.executionRuntimes
  expect(runtimes.listVmRecipes().length).toBeGreaterThan(0)
  const vm = runtimes.launchVm({ recipeId: runtimes.listVmRecipes()[0]!.id, label: 'delegated' })
  expect(runtimes.getVmOverview().usage.activeVms).toBe(1)
  runtimes.reapOrphanedVms({ now: Date.now() + 365 * 24 * 60 * 60_000 })
  expect(runtimes.getVmOverview().usage.activeVms).toBe(0)
  expect(runtimes.destroyVm({ id: vm.id }).state).toBe('terminated')
})

it('classifies detect validation, cancellation, and generic remote failures', async () => {
  const h = await harness()
  const location = { endpoint: h.request.endpoint, node: h.request.node,
    installRoot: h.request.installRoot, workspace: h.request.workspace }
  expect(() => h.ctx.executionRuntimes.detect({ ...location, node: 'relative' }))
    .toThrow(/configuration is invalid/)
  const controller = new AbortController()
  controller.abort(new Error('stop'))
  await expect(h.ctx.executionRuntimes.detect(location, controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  fixture.run.mockRejectedValueOnce(new Error('raw remote bug'))
  await expect(h.ctx.executionRuntimes.detect(location)).rejects.toMatchObject({ code: 'verification-failed' })
  fixture.run.mockResolvedValueOnce({ state: 'missing', platform: 'linux', arch: 'x64', node: '/usr/bin/node', nodeVersion: 'v24',
    installRoot: h.request.installRoot, generation: 'd'.repeat(64) } as RuntimeInspection)
  await expect(h.ctx.executionRuntimes.detect(location)).resolves.toMatchObject({ state: 'missing' })
})

it('selects the shipped release index for unpinned installs and reports release-unavailable', async () => {
  const h = await harness({ config: { artifactDirectory: undefined, manifestSHA256: undefined } })
  h.release()
  const { readFile } = await import('node:fs/promises')
  const missing = async () => { throw new Error('ENOENT: no such file') }
  vi.mocked(readFile).mockImplementationOnce(missing as never)
  await expect(h.ctx.executionRuntimes.detect({ endpoint: h.request.endpoint, node: h.request.node,
    installRoot: h.request.installRoot, workspace: h.request.workspace }))
    .rejects.toMatchObject({ code: 'release-unavailable' })

  const index = JSON.stringify({ schemaVersion: 1, releases: {
    'linux-arm64': { directory: 'rel-arm64', manifestSHA256: 'b'.repeat(64) },
  } })
  vi.mocked(readFile).mockResolvedValueOnce(index as never)
  await expect(h.ctx.executionRuntimes.detect({ endpoint: h.request.endpoint, node: h.request.node,
    installRoot: h.request.installRoot, workspace: h.request.workspace }))
    .rejects.toMatchObject({ code: 'release-unavailable' })

  vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ schemaVersion: 1, releases: {
    'linux-x64': { directory: 'rel-x64', manifestSHA256: 'b'.repeat(64) },
  } }) as never)
  const receipt = h.ctx.executionRuntimes.start(h.request)
  await vi.waitFor(() => { expect(h.ctx.executionRuntimes.get({ id: receipt.task.id }).task.state).toBe('succeeded') })
  expect(fixture.artifact).toHaveBeenCalledWith(expect.stringContaining('rel-x64'), 'b'.repeat(64), expect.anything())
})

it('validates constructor pairing, absolutes, digests, limits, and timer bounds', () => {
  const contexts: Context[] = []
  onTestFinished(async () => { for (const item of contexts) await item.fiber.dispose() })
  const base = { operationTimeoutMs: 60_000, shutdownTimeoutMs: 5_000, maxManifestBytes: 1024,
    maxFileBytes: 1024, maxTotalBytes: 1024, maxFiles: 8, maxResponseBytes: 1024, maxRetainedTasks: 8 }
  const spawn = (config: Record<string, unknown>) => {
    const ctx = new Context()
    contexts.push(ctx)
    return new Runtime(ctx, config as never)
  }
  expect(() => spawn({ ...base, artifactDirectory: 'x' })).toThrow(/paired/)
  expect(() => spawn({ ...base, manifestSHA256: 'a'.repeat(64) })).toThrow(/paired/)
  expect(() => spawn({ ...base, artifactDirectory: 'relative', manifestSHA256: 'a'.repeat(64) })).toThrow(/absolute/)
  expect(() => spawn({ ...base, artifactDirectory: 'C:\\root', manifestSHA256: 'x' })).toThrow(/SHA-256/)
  expect(() => spawn({ ...base, maxFiles: 0 })).toThrow(/limit/)
  expect(() => spawn({ ...base, operationTimeoutMs: 3_000_000_000 })).toThrow(/timer/)
})
