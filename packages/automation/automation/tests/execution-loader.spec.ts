/** Automation admission with Web execution services, real Loader and JSONL persistence. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import Bindings from '@deepseek-ai/dsh-execution-binding'
import type { ExecutionBinding } from '@deepseek-ai/dsh-execution-binding/types'
import Query from '@deepseek-ai/dsh-session-query-sqlite'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import type { AutomationRequestId } from '../src/types.ts'
import { answer, bootRuntimeFixture, waitForRun } from './fixtures/runtime.ts'

let home: string
let fixture: Awaited<ReturnType<typeof bootRuntimeFixture>> | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-automation-execution-'))
  vi.stubEnv('DSH_HOME', home)
})
afterEach(async () => {
  try {
    await fixture?.dispose()
    expect(fixture?.model.unexpected ?? []).toEqual([])
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true, maxRetries: 5 })
  }
})

async function boot() {
  fixture = await bootRuntimeFixture({ home, modules: new Map<string, unknown>([
    ['@deepseek-ai/dsh-execution-binding', Bindings], ['@deepseek-ai/dsh-session-query-sqlite', Query],
  ]), entries: [
    { name: '@deepseek-ai/dsh-session-query-sqlite', config: { path: join(home, 'query.sqlite3') } },
    { name: '@deepseek-ai/dsh-execution-binding', config: { sandboxMode: 'workspace-write' } },
  ] })
  return fixture
}
const requestId = (value: string) => brandString<AutomationRequestId>(value)
const remote: ExecutionBinding = {
  kind: 'ssh', targetId: brandString('00000000-0000-4000-8000-000000000001'), revision: 1,
  endpoint: { host: 'remote.invalid', port: 22, username: 'runner', hostKeySHA256: 'a'.repeat(64) },
  node: '/runtime/node', helper: '/runtime/helper', helperHash: 'b'.repeat(64), workspace: '/project',
  bootstrapPath: '/runtime/bootstrap', bootstrapHash: 'c'.repeat(64),
}

it('publishes an explicit local execution binding before the Automation Agent runs', async () => {
  const { ctx, draft, model, workspace } = await boot()
  let binding: ExecutionBinding | undefined
  model.responses.push(async function* () {
    const agent = ctx.agents.list()[0]!
    binding = await ctx.executionBindings.bindingForSession(agent.id)
    const lease = await ctx.executionBindings.forSession(agent.id)
    try { expect(lease.cwd).toBe(workspace.path); expect(lease.binding).toEqual({ kind: 'local' }) }
    finally { await lease.release() }
    yield* answer('local execution')
  })
  const definition = await ctx.automationRuntime.create(draft)
  const run = await ctx.automationRuntime.run({ id: definition.id, expectedRevision: definition.revision, requestId: requestId('local') })
  const completed = await waitForRun(ctx.automationRuntime, definition.id, run.id, value => value.finishedAt !== null)
  expect(completed.status).toBe('completed')
  expect(binding).toEqual({ kind: 'local' })
  if (run.sessionId === null) throw new Error('Expected admitted Session')
  const log = await readColdSessionLog(ctx.sessionPersistence, run.sessionId)
  expect(log.events.filter(event => event.type === 'execution/bound')).toMatchObject([{ data: { binding: { kind: 'local' } } }])
  expect(log.events.filter(event => event.type === 'user/message' && event.data.id === run.messageId)).toHaveLength(1)
  expect(ctx.agents.list()).toEqual([])
})

it('rejects a remote Workspace before probing its colliding Host directory', async () => {
  const { ctx, draft, workspace, model } = await boot()
  // Registry execution is the external admission input; the real local directory stays present.
  vi.spyOn(workspace, 'execution', 'get').mockReturnValue(remote)
  const status = vi.spyOn(workspace, 'status')
  await expect(ctx.automationRuntime.create(draft)).rejects.toMatchObject({ code: 'resource', cause: { message: 'Automation requires a local Workspace' } })
  expect(status).not.toHaveBeenCalled()
  expect(ctx.agents.list()).toEqual([])
  expect(model.requests).toEqual([])
})

it('rejects update and run when a saved Workspace changes execution before admission', async () => {
  const { ctx, draft, workspace, model } = await boot()
  const definition = await ctx.automationRuntime.create(draft)
  vi.spyOn(workspace, 'execution', 'get').mockReturnValue(remote)
  const status = vi.spyOn(workspace, 'status')
  await expect(ctx.automationRuntime.update({ id: definition.id, expectedRevision: definition.revision, draft, enabled: true }))
    .rejects.toMatchObject({ code: 'resource' })
  await expect(ctx.automationRuntime.run({ id: definition.id, expectedRevision: definition.revision, requestId: requestId('changed') }))
    .rejects.toMatchObject({ code: 'resource' })
  expect(status).not.toHaveBeenCalled()
  expect(ctx.automationRuntime.runs(definition.id, null, 100).runs).toEqual([])
  expect(model.requests).toEqual([])
})

it('rolls back setup if preset mounting changes the Workspace to remote', async () => {
  const { ctx, draft, workspace, model } = await boot()
  const definition = await ctx.automationRuntime.create(draft)
  const original = ctx.agentPresets.mount.bind(ctx.agentPresets)
  vi.spyOn(ctx.agentPresets, 'mount').mockImplementation(async (...args) => {
    const mounted = await original(...args)
    vi.spyOn(workspace, 'execution', 'get').mockReturnValue(remote)
    return mounted
  })
  const run = await ctx.automationRuntime.run({ id: definition.id, expectedRevision: definition.revision, requestId: requestId('setup-change') })
  await waitForRun(ctx.automationRuntime, definition.id, run.id, value => value.finishedAt !== null)
  if (run.sessionId === null) throw new Error('Expected admitted Session')
  expect(ctx.agents.list()).toEqual([])
  expect(ctx.sessions.get(run.sessionId)).toBeUndefined()
  expect(model.requests).toEqual([])
  await expect(ctx.executionBindings.forSession(run.sessionId)).rejects.toThrow()
})

it('rejects publication if Workspace execution changes during the durable setup append', async () => {
  const { ctx, draft, workspace, model } = await boot()
  const definition = await ctx.automationRuntime.create(draft)
  const create = ctx.sessionPersistence.create.bind(ctx.sessionPersistence)
  let appended = false
  vi.spyOn(ctx.sessionPersistence, 'create').mockImplementation(async (header, options) => {
    const handle = await create(header, options)
    const append = handle.append.bind(handle)
    vi.spyOn(handle, 'append').mockImplementationOnce(async (events, appendOptions) => {
      await append(events, appendOptions)
      appended = true
      vi.spyOn(workspace, 'execution', 'get').mockReturnValue(remote)
    })
    return handle
  })
  const published = vi.fn()
  ctx.on('agent/created', published)
  const run = await ctx.automationRuntime.run({ id: definition.id, expectedRevision: definition.revision, requestId: requestId('append-change') })
  await waitForRun(ctx.automationRuntime, definition.id, run.id, value => value.finishedAt !== null)
  expect(appended).toBe(true)
  expect(published).not.toHaveBeenCalled()
  expect(ctx.agents.list()).toEqual([])
  expect(model.requests).toEqual([])
})
