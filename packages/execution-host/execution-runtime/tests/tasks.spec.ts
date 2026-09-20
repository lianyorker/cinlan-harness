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

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-loader-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const target: TargetView = { id: 'runtime-target' as ExecutionTargetId, label: 'Fixture', sshAlias: 'fixture', revision: 1,
    createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', state: { phase: 'disconnected' } }
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
  ctx.set('executionHostTargets', { list: () => ({ targets: [target] }), activateExecution: activate })
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
  await writeFile(file, '- ' + JSON.stringify({ name: 'runtime', config: { artifactDirectory: root, manifestSHA256: 'a'.repeat(64) } }) + '\n')
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
    changeRevision: () => { revision++ } }
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
