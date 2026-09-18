import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteStream, type RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import AutomationClient from '../src/client/index.ts'
import type { AutomationRemote } from '../src/client/remote.ts'
import type {
  AutomationCatalog, AutomationDefinition, AutomationDraft, AutomationFollowFrame,
  AutomationId, AutomationRun, AutomationRunId, AutomationSnapshot,
} from '../src/types.ts'

const roots: Context[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.restoreAllMocks()
})

const id = 'plan' as AutomationId
const runId = 'run' as AutomationRunId
const draft: AutomationDraft = {
  title: '晚间检查', prompt: '检查变更', workspaceId: 'workspace' as never,
  agentPresetId: 'coder', model: { provider: 'fake', model: 'model', reasoningEffort: 'saved-effort' as never },
  permissionPresetId: 'locked', schedule: { kind: 'daily', hour: 8, minute: 30 },
}
const definition: AutomationDefinition = {
  id, revision: 1, scheduleRevision: 1, spec: { ...draft, workspacePath: '/workspace',
    permission: { sandbox: 'read-only', approval: 'never' } },
  enabled: false, needsReview: false, nextPlannedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null,
}
const run: AutomationRun = {
  id: runId, automationId: id, definitionRevision: 1, scheduleRevision: 1, spec: definition.spec,
  trigger: 'manual', requestId: 'request' as never, plannedAt: 1, sessionId: null, messageId: null,
  turn: null, status: 'starting', reason: null, createdAt: 1, updatedAt: 1, finishedAt: null,
}
const state = (revision = 1): AutomationSnapshot => ({
  status: 'ready', profile: 'test', revision, definitions: [definition], activeRuns: [],
})
const catalog: AutomationCatalog = {
  workspaces: [{ id: draft.workspaceId, title: '工作区', path: '/workspace', availability: 'ready' }],
  agentPresets: [{ id: 'coder', name: '编码', availability: 'ready' }],
  providers: [{ id: 'fake', name: 'Provider data', availability: 'ready' }],
  models: [{ provider: 'fake', id: 'model', name: '模型', availability: 'ready' }],
  permissionPresets: [{ id: 'locked', name: '只读', permission: definition.spec.permission, availability: 'ready' }],
  defaults: { agentPresetId: 'coder', model: draft.model, modelAvailability: 'ready', permissionPresetId: 'locked' },
}
const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function harness(local = true) {
  const ctx = new Context()
  roots.push(ctx)
  let generation: ConnectionGeneration | undefined = { id: 1, host: { home: '/home' } }
  const listeners = new Set<() => void>()
  const connection = {
    isLoopback: local,
    generation: { getSnapshot: () => generation, subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    } },
  }
  const signals: AbortSignal[] = []
  const pending: AutomationFollowFrame[] = []
  let wake: (() => void) | undefined
  let closed = 0
  const remote: AutomationRemote = {
    snapshot: vi.fn(async () => ok(state())),
    catalog: vi.fn(async () => ok(catalog)),
    create: vi.fn(async () => ok(definition)),
    update: vi.fn(async () => ok(definition)),
    delete: vi.fn(async () => ok(undefined)),
    run: vi.fn(async () => ok(run)),
    cancel: vi.fn(async () => ok(undefined)),
    runs: vi.fn(async () => ok({ runs: [run], nextCursor: null })),
    previewSchedule: vi.fn(async () => ok([10, 20, 30, 40, 50])),
    async *follow(signal = new AbortController().signal) {
      signals.push(signal)
      const abort = () => { wake?.() }
      signal.addEventListener('abort', abort, { once: true })
      try {
        yield { type: 'baseline', value: state() }
        while (!signal.aborted) {
          if (pending.length === 0) await new Promise<void>((resolve) => { wake = resolve })
          if (signal.aborted) return
          while (pending.length > 0) yield pending.shift()!
        }
      } finally {
        closed++
        signal.removeEventListener('abort', abort)
      }
    },
  }
  ctx.provide('connection', connection as never)
  ctx.provide('remote', {
    automation: remote,
    $stream: <T>(options: RemoteStreamOptions<T>) => new RemoteStream(connection, options),
  } as never)
  const client = new AutomationClient(ctx)
  return { ctx, client, remote, signals, closed: () => closed,
    frame: (value: AutomationSnapshot) => { pending.push({ type: 'snapshot', value }); wake?.() },
    generation: (value: number | undefined) => {
      generation = value === undefined ? undefined : { id: value, host: { home: '/home' } }
      for (const listener of listeners) listener()
    },
  }
}
async function ready(client: AutomationClient) {
  await vi.waitFor(() => { expect(client.getSnapshot().catalogLoading).toBe(false) })
}

describe('AutomationClient source and commands', () => {
  it('keeps source and snapshot identities stable, with source labels unchanged across locale reads', async () => {
    const { client } = harness()
    await ready(client)
    const source = client.source
    const englishRead = source.getSnapshot()
    const chineseRead = source.getSnapshot()
    expect(chineseRead).toBe(englishRead)
    expect(client.source).toBe(source)
    expect(chineseRead.catalog?.workspaces[0]?.title).toBe('工作区')
    expect(chineseRead.catalog?.defaults.model.reasoningEffort).toBe('saved-effort')
    expect(chineseRead.runtime).toEqual(state())
  })

  it('delegates plain commands without request ids or optimistic state', async () => {
    const { client, remote } = harness()
    await ready(client)
    expect(await client.create(draft)).toEqual(definition)
    expect(await client.update({ id, expectedRevision: 1, draft, enabled: true })).toEqual(definition)
    await client.delete({ id, expectedRevision: 1 })
    expect(await client.run({ id, expectedRevision: 1, requestId: 'same-token' as never })).toEqual(run)
    await client.cancel(runId)
    expect(await client.runs(id, null, 2)).toEqual({ runs: [run], nextCursor: null })
    expect(await client.previewSchedule(draft.schedule, 0)).toEqual([10, 20, 30, 40, 50])
    expect(remote.cancel).toHaveBeenCalledWith({ runId })
    expect(remote.run).toHaveBeenCalledWith({ id, expectedRevision: 1, requestId: 'same-token' })
    expect(client.getSnapshot().runtime).toEqual(state())
  })

  it('preserves committed state and command errors across unrelated stream commits', async () => {
    const { client, remote, frame } = harness()
    await ready(client)
    vi.mocked(remote.update).mockResolvedValueOnce({ ok: false,
      error: new RemoteError('automation/operation-failed', 'Refresh required.', { code: 'conflict' }) })
    await expect(client.update({ id, expectedRevision: 1, draft, enabled: true })).rejects.toMatchObject({
      failure: { code: 'conflict' },
    })
    expect(client.getSnapshot()).toMatchObject({ availability: 'ready', runtime: state(), error: { code: 'conflict' } })
    frame(state(2))
    await vi.waitFor(() => { expect(client.getSnapshot().runtime).toEqual(state(2)) })
    expect(client.getSnapshot().error?.code).toBe('conflict')
  })

  it('keeps cached catalog and runtime after read failures instead of synthesizing empty lists', async () => {
    const { client, remote } = harness()
    await ready(client)
    vi.mocked(remote.catalog).mockRejectedValueOnce(new Error('secret provider diagnostics'))
    vi.mocked(remote.snapshot).mockRejectedValueOnce(new Error('storage path'))
    await client.refresh()
    expect(client.getSnapshot()).toMatchObject({ runtime: state(), catalog, error: { code: 'transport', message: 'Automation connection failed.' } })
  })

  it('refuses nonlocal mutations before invoking the generated Remote', async () => {
    const { client, remote } = harness(false)
    await ready(client)
    expect(client.getSnapshot().writable).toBe(false)
    for (const operation of [() => client.create(draft), () => client.update({ id, expectedRevision: 1, draft, enabled: true }),
      () => client.delete({ id, expectedRevision: 1 }), () => client.run({ id, expectedRevision: 1, requestId: 'token' as never }),
      () => client.cancel(runId)]) await expect(operation()).rejects.toMatchObject({ failure: { code: 'unavailable' } })
    expect(remote.create).not.toHaveBeenCalled()
    expect(remote.update).not.toHaveBeenCalled()
    expect(remote.delete).not.toHaveBeenCalled()
    expect(remote.run).not.toHaveBeenCalled()
    expect(remote.cancel).not.toHaveBeenCalled()
  })

  it('contains subscriber errors and stops stream callbacks during HMR teardown', async () => {
    const { ctx, client, frame, signals, closed } = harness()
    await ready(client)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const later = vi.fn()
    client.subscribe(() => { throw new Error('broken observer') })
    const unsubscribe = client.subscribe(later)
    frame(state(2))
    await vi.waitFor(() => { expect(later).toHaveBeenCalled() })
    unsubscribe()
    unsubscribe()
    await ctx.fiber.dispose()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(closed()).toBe(1)
    const snapshot = client.getSnapshot()
    frame(state(3))
    await Promise.resolve()
    expect(client.getSnapshot()).toBe(snapshot)
    await expect(client.create(draft)).rejects.toMatchObject({ failure: { code: 'unavailable' } })
  })
})

describe('AutomationClient generation and journal races', () => {
  it('revalidates the selected journal after commits and coalesces updates while a page is pending', async () => {
    const { client, remote, frame } = harness()
    await ready(client)
    await client.loadRuns(id)
    const pending = deferred<RemoteResult<{ runs: AutomationRun[]; nextCursor: null }>>()
    vi.mocked(remote.runs).mockReturnValueOnce(pending.promise)
    frame(state(2))
    await vi.waitFor(() => { expect(remote.runs).toHaveBeenCalledTimes(2) })
    expect(client.getSnapshot().history).toMatchObject({ runs: [run], loading: true })
    for (let revision = 3; revision <= 25; revision++) frame(state(revision))
    await vi.waitFor(() => { expect(client.getSnapshot().runtime).toEqual(state(25)) })
    expect(remote.runs).toHaveBeenCalledTimes(2)
    const terminal = { ...run, status: 'completed' as const, finishedAt: 25 }
    vi.mocked(remote.runs).mockResolvedValueOnce(ok({ runs: [terminal], nextCursor: null }))
    pending.resolve(ok({ runs: [run], nextCursor: null }))
    await vi.waitFor(() => { expect(client.getSnapshot().history).toMatchObject({ runs: [terminal], loading: false }) })
    expect(remote.runs).toHaveBeenCalledTimes(3)
  })

  it('ignores stale refresh results after a newer Connection generation', async () => {
    const { client, remote, generation } = harness()
    await ready(client)
    const stale = deferred<RemoteResult<AutomationCatalog>>()
    vi.mocked(remote.catalog).mockReturnValueOnce(stale.promise)
    const old = client.refresh()
    generation(undefined)
    generation(2)
    await ready(client)
    stale.resolve(ok({ ...catalog, workspaces: [] }))
    await old
    expect(client.getSnapshot().catalog).toEqual(catalog)
  })

  it('does not overwrite a later stream commit with an earlier unary snapshot', async () => {
    const { client, remote, frame } = harness()
    await ready(client)
    const stale = deferred<RemoteResult<AutomationSnapshot>>()
    vi.mocked(remote.snapshot).mockReturnValueOnce(stale.promise)
    const refresh = client.refresh()
    frame(state(4))
    await vi.waitFor(() => { expect(client.getSnapshot().runtime).toEqual(state(4)) })
    stale.resolve(ok(state(2)))
    await refresh
    expect(client.getSnapshot().runtime).toEqual(state(4))
  })

  it('owns selected pages, suppresses late selections and preserves failed page data', async () => {
    const { client, remote } = harness()
    await ready(client)
    const stale = deferred<RemoteResult<{ runs: AutomationRun[]; nextCursor: null }>>()
    vi.mocked(remote.runs).mockReturnValueOnce(stale.promise)
    const first = client.loadRuns(id)
    const other = 'other' as AutomationId
    const secondRun = { ...run, id: 'other-run' as AutomationRunId, automationId: other }
    vi.mocked(remote.runs).mockResolvedValueOnce(ok({ runs: [secondRun], nextCursor: secondRun.id }))
    await client.loadRuns(other, 1)
    stale.resolve(ok({ runs: [run], nextCursor: null }))
    await first
    expect(client.getSnapshot().history).toMatchObject({ automationId: other, runs: [secondRun], nextCursor: secondRun.id })
    vi.mocked(remote.runs).mockRejectedValueOnce(new Error('history read failure'))
    await client.loadMoreRuns()
    expect(client.getSnapshot().history).toMatchObject({ runs: [secondRun], nextCursor: secondRun.id, error: { code: 'transport' } })
    vi.mocked(remote.runs).mockResolvedValueOnce(ok({ runs: [secondRun, run], nextCursor: null }))
    await client.loadMoreRuns()
    expect(client.getSnapshot().history).toMatchObject({ runs: [secondRun, run], nextCursor: null, loading: false, error: null })
  })

  it('fences late history and errors after disposal and disconnect', async () => {
    const { client, remote, ctx, generation } = harness()
    await ready(client)
    await client.loadRuns(id)
    const stale = deferred<RemoteResult<{ runs: AutomationRun[]; nextCursor: null }>>()
    vi.mocked(remote.runs).mockReturnValueOnce(stale.promise)
    const refresh = client.loadRuns(id)
    generation(undefined)
    await ctx.fiber.dispose()
    const snapshot = client.getSnapshot()
    stale.resolve({ ok: false, error: new RemoteError('automation/operation-failed', 'missing', { code: 'not-found' }) })
    await refresh
    expect(client.getSnapshot()).toBe(snapshot)
    expect(snapshot.history?.runs).toEqual([run])
  })
})
