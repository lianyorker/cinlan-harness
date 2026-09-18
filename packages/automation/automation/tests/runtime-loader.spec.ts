import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import type { AutomationRequestId } from '../src/types.ts'
import { answer, bootRuntimeFixture, policyEvidence, waitForRun } from './fixtures/runtime.ts'

let home: string
const fixtures: Awaited<ReturnType<typeof bootRuntimeFixture>>[] = []
const releaseBarriers: (() => void)[] = []

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-automation-loader-'))
  vi.stubEnv('DSH_HOME', home)
})
afterEach(async () => {
  try {
    for (const release of releaseBarriers.splice(0)) release()
    for (const fixture of fixtures.splice(0).reverse()) {
      await fixture.dispose()
      expect(fixture.model.unexpected).toEqual([])
    }
  } finally {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true, maxRetries: 5 })
  }
})

async function boot() {
  const fixture = await bootRuntimeFixture({ home })
  fixtures.push(fixture)
  return fixture
}
const requestId = (value: string) => brandString<AutomationRequestId>(value)

function barrier() {
  const pending = Promise.withResolvers<undefined>()
  return { promise: pending.promise, resolve: () => { pending.resolve(undefined) } }
}

describe('real Loader automation runtime', () => {
  it('latches storage unavailability after a real failed claim and admits no Agent until restart', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2030-01-01T00:14:59Z'))
    const fixture = await boot()
    const { ctx, model, draft } = fixture
    const runtime = ctx.automationRuntime
    const created = await runtime.create(draft)
    expect(created.enabled).toBe(false)
    expect(model.requests).toEqual([])
    const enabled = await runtime.update({ id: created.id, expectedRevision: created.revision, draft, enabled: true })
    const request = { id: enabled.id, expectedRevision: enabled.revision, requestId: requestId('failed-claim') }
    const createAgent = vi.spyOn(ctx.agents, 'create')
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(join(await realpath(home), 'automations', 'automation-test', 'state.sqlite3'))
      database.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT, 'fixture claim failure'); END")
      await expect(runtime.run(request)).rejects.toMatchObject({ code: 'storage' })
      expect(runtime.snapshot()).toEqual({ status: 'unavailable', profile: 'automation-test', reason: 'storage' })
      expect(database.prepare('SELECT id FROM runs').all()).toEqual([])
      expect(createAgent).not.toHaveBeenCalled()
      expect(ctx.agents.list()).toEqual([])
      expect(model.requests).toEqual([])

      database.exec('DROP TRIGGER fail_claim')
      await expect(runtime.run(request)).rejects.toMatchObject({ code: 'unavailable' })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(runtime.snapshot()).toEqual({ status: 'unavailable', profile: 'automation-test', reason: 'storage' })
      expect(database.prepare('SELECT id FROM runs').all()).toEqual([])
      expect(createAgent).not.toHaveBeenCalled()
      expect(model.requests).toEqual([])
    } finally {
      database?.close()
      createAgent.mockRestore()
    }
    await fixture.dispose()
    const restarted = await boot()
    expect(restarted.ctx.automationRuntime.snapshot()).toMatchObject({ status: 'ready', activeRuns: [] })
    expect(restarted.ctx.automationRuntime.runs(enabled.id, null, 10).runs).toEqual([])
    expect(restarted.model.requests).toEqual([])
    restarted.model.responses.push(() => answer())
    const receipt = await restarted.ctx.automationRuntime.run(request)
    expect(await waitForRun(restarted.ctx.automationRuntime, enabled.id, receipt.id, run => run.finishedAt !== null))
      .toMatchObject({ status: 'completed' })
    expect(restarted.model.requests).toHaveLength(1)
  })

  it('deduplicates concurrent manual requests and retains overlap until cancelled provider work drains', async () => {
    const fixture = await boot()
    const { ctx, model, draft } = fixture
    const runtime = ctx.automationRuntime
    const definition = await runtime.create(draft)
    const entered = barrier()
    const aborted = barrier()
    const release = barrier()
    releaseBarriers.push(release.resolve)
    model.responses.push(async function* (options) {
      const signal = options.signal
      if (signal === undefined) throw new Error('Real Agent must provide cancellation')
      const abort = () => { aborted.resolve() }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) aborted.resolve()
      entered.resolve()
      try {
        await aborted.promise
        await release.promise
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Fixture response cancelled' } } }
      } finally { signal.removeEventListener('abort', abort) }
    })
    const request = { id: definition.id, expectedRevision: definition.revision, requestId: requestId('dedup') }
    const [first, retry] = await Promise.all([runtime.run(request), runtime.run(request)])
    expect(first.id).toBe(retry.id)
    await Promise.race([
      entered.promise,
      waitForRun(runtime, definition.id, first.id, run => run.finishedAt !== null).then((run) => {
        throw new Error('Run terminated before model entry: ' + JSON.stringify(run))
      }),
    ])
    expect(model.requests).toHaveLength(1)
    expect(runtime.runs(definition.id, null, 10).runs).toHaveLength(1)
    await expect(runtime.run({ ...request, requestId: requestId('overlap') })).rejects.toMatchObject({ code: 'busy' })
    await expect(runtime.delete({ id: definition.id, expectedRevision: definition.revision })).rejects.toMatchObject({ code: 'busy' })
    let cancelSettled = false
    const cancelling = runtime.cancel(first.id).then(() => { cancelSettled = true })
    await aborted.promise
    expect(runtime.runs(definition.id, null, 10).runs[0]).toMatchObject({ status: 'stopping', finishedAt: null })
    await expect(runtime.run({ ...request, requestId: requestId('draining') })).rejects.toMatchObject({ code: 'busy' })
    expect(cancelSettled).toBe(false)
    release.resolve()
    await cancelling
    const cancelled = await waitForRun(runtime, definition.id, first.id, run => run.finishedAt !== null)
    expect(cancelled).toMatchObject({ status: 'cancelled', reason: 'aborted', turn: 1 })
    expect(ctx.agents.list()).toEqual([])
    expect(await runtime.run(request)).toEqual(cancelled)
    expect(model.requests).toHaveLength(1)
    if (first.sessionId === null) throw new Error('Missing Session id')
    const persisted = await readColdSessionLog(ctx.sessionPersistence, first.sessionId)
    expect(persisted.events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { turn: 1, reason: { kind: 'aborted' } } }])
  })

  it('dispatches only an explicitly enabled UTC occurrence and records scheduled overlap without another Agent', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2030-01-01T00:14:59Z'))
    const { ctx, model, draft } = await boot()
    const runtime = ctx.automationRuntime
    const created = await runtime.create(draft)
    const entered = barrier()
    const release = barrier()
    releaseBarriers.push(release.resolve)
    model.responses.push(async function* () {
      entered.resolve()
      await release.promise
      yield* answer()
    })
    await runtime.update({ id: created.id, expectedRevision: created.revision, draft, enabled: true })
    expect(model.requests).toEqual([])
    await vi.advanceTimersByTimeAsync(1000)
    await entered.promise
    const [first] = runtime.runs(created.id, null, 10).runs
    expect(first).toMatchObject({ trigger: 'scheduled', plannedAt: Date.parse('2030-01-01T00:15:00Z'), status: 'running' })
    if (first === undefined) throw new Error('Missing scheduled claim')
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(runtime.runs(created.id, null, 10).runs).toMatchObject([
      { trigger: 'scheduled', plannedAt: Date.parse('2030-01-01T01:15:00Z'), status: 'skipped-overlap', sessionId: null, messageId: null },
      { id: first.id, status: 'running' },
    ])
    expect(model.requests).toHaveLength(1)
    release.resolve()
    expect(await waitForRun(runtime, created.id, first.id, run => run.finishedAt !== null)).toMatchObject({ status: 'completed' })
    expect(ctx.agents.list()).toEqual([])
  })

  it('awaits provider quiescence on owner disposal and quarantines its durable interrupted turn', async () => {
    const fixture = await boot()
    const { ctx, model, draft } = fixture
    const runtime = ctx.automationRuntime
    const created = await runtime.create(draft)
    const entered = barrier()
    const aborted = barrier()
    const release = barrier()
    releaseBarriers.push(release.resolve)
    model.responses.push(async function* (options) {
      const signal = options.signal
      if (signal === undefined) throw new Error('Missing cancellation signal')
      const onAbort = () => { aborted.resolve() }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) aborted.resolve()
      entered.resolve()
      try {
        await aborted.promise
        await release.promise
        yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Fixture response cancelled' } } }
      } finally { signal.removeEventListener('abort', onAbort) }
    })
    const run = await runtime.run({ id: created.id, expectedRevision: created.revision, requestId: requestId('dispose') })
    await entered.promise
    let disposed = false
    const disposing = fixture.dispose().then(() => { disposed = true })
    await aborted.promise
    expect(runtime.snapshot()).toMatchObject({ status: 'unavailable', reason: 'closing' })
    expect(disposed).toBe(false)
    release.resolve()
    await disposing
    const reopened = await boot()
    if (run.sessionId === null) throw new Error('Missing Session id')
    const persisted = await readColdSessionLog(reopened.ctx.sessionPersistence, run.sessionId)
    expect(persisted.events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { turn: 1, reason: { kind: 'interrupted' } } }])
    expect(reopened.ctx.automationRuntime.runs(created.id, null, 10).runs).toMatchObject([{ id: run.id, status: 'interrupted', reason: 'interrupted' }])
    expect(reopened.ctx.automationRuntime.snapshot()).toMatchObject({
      status: 'ready', activeRuns: [], definitions: [expect.objectContaining({ id: created.id, enabled: false, needsReview: true })],
    })
    expect(reopened.model.requests).toEqual([])
  })

  it('pauses without dispatch and skips missed UTC cursors on restart without replay', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2030-01-01T00:10:00Z'))
    const fixture = await boot()
    const { ctx, model, draft } = fixture
    const runtime = ctx.automationRuntime
    const created = await runtime.create(draft)
    const enabled = await runtime.update({ id: created.id, expectedRevision: created.revision, draft, enabled: true })
    expect(enabled.nextPlannedAt).toBe(Date.parse('2030-01-01T00:15:00Z'))
    const paused = await runtime.update({ id: enabled.id, expectedRevision: enabled.revision, draft, enabled: false })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(model.requests).toEqual([])
    expect(runtime.runs(created.id, null, 10).runs).toEqual([])
    const resumed = await runtime.update({ id: paused.id, expectedRevision: paused.revision, draft, enabled: true })
    expect(resumed.nextPlannedAt).toBe(Date.parse('2030-01-01T01:15:00Z'))
    await fixture.dispose()
    vi.setSystemTime(new Date('2030-01-01T05:20:00Z'))
    const restarted = await boot()
    expect(restarted.ctx.automationRuntime.snapshot()).toMatchObject({
      status: 'ready', definitions: [expect.objectContaining({ enabled: true, nextPlannedAt: Date.parse('2030-01-01T06:15:00Z') })], activeRuns: [],
    })
    expect(restarted.ctx.automationRuntime.runs(created.id, null, 10).runs).toEqual([])
    expect(restarted.model.requests).toEqual([])
  })

  it('uses its identified prompt turn rather than a later unrelated turn ending', async () => {
    const { ctx, model, draft } = await boot()
    const runtime = ctx.automationRuntime
    const definition = await runtime.create(draft)
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      if (message.source.kind !== 'plugin' || message.source.plugin !== 'automation') return
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'A separate later request.' }], source: { kind: 'user' } }))
    })
    model.responses.push(() => answer('The automation completed.'))
    model.responses.push(async function* () {
      for await (const chunk of answer('Later request was cut short.')) {
        yield chunk.type === 'finish' ? { type: 'finish', reason: { kind: 'max-tokens' } } : chunk
      }
    })
    const receipt = await runtime.run({ id: definition.id, expectedRevision: definition.revision, requestId: requestId('owned-turn') })
    const completed = await waitForRun(runtime, definition.id, receipt.id, run => run.finishedAt !== null)
    expect(completed).toMatchObject({ status: 'completed', reason: 'completed', turn: 1 })
    expect(model.requests).toHaveLength(2)
    if (receipt.sessionId === null) throw new Error('Missing Session id')
    const log = await readColdSessionLog(ctx.sessionPersistence, receipt.sessionId)
    expect(log.events.filter(event => event.type === 'turn/end').map(event => event.data)).toEqual([
      { turn: 1, reason: { kind: 'completed' } },
      { turn: 2, reason: { kind: 'max-tokens' } },
    ])
    expect(ctx.agents.list()).toEqual([])
  })

  it('creates disabled, composes authority before publication, logs its own turn, and reopens exact durable results', async () => {
    const fixture = await boot()
    const { ctx, model, workspace, draft } = fixture
    const runtime = ctx.automationRuntime
    expect(model.requests).toEqual([])
    expect(ctx.agents.list()).toEqual([])
    const definition = await runtime.create(draft)
    expect(definition.enabled).toBe(false)
    expect(definition.needsReview).toBe(false)
    expect(runtime.runs(definition.id, null, 10).runs).toEqual([])
    expect(model.requests).toEqual([])
    expect(await stat(join(await realpath(home), 'automations', 'automation-test', 'state.sqlite3'))).toBeDefined()

    const published: unknown[] = []
    ctx.on('agent/created', ({ agent }) => {
      published.push({
        permission: ctx.permissionPresets.current(agent.session),
        cwd: agent.session.header.cwd,
        preset: agent.session.header.agentPreset,
        authority: policyEvidence(agent.session.snapshotEvents()),
        calls: model.requests.length,
      })
    })
    model.responses.push(() => answer())
    const request = { id: definition.id, expectedRevision: definition.revision, requestId: requestId('first-run') }
    const receipt = await runtime.run(request)
    const completed = await waitForRun(runtime, definition.id, receipt.id, run => run.finishedAt !== null)
    expect(completed).toMatchObject({ status: 'completed', reason: 'completed', turn: 1 })
    expect(published).toHaveLength(1)
    expect(published[0]).toMatchObject({
      permission: 'unattended', cwd: workspace.path, preset: 'fixture', calls: 0,
      authority: [
        { type: 'permission/preset', data: { preset: 'unattended' } },
        { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
        { type: 'approval/policy', data: { policy: 'never' } },
      ],
    })
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]).toMatchObject({ provider: 'fixture', model: 'deterministic', sessionId: receipt.sessionId })
    expect(model.requests[0]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: [{ type: 'text', text: 'You are an AI agent powered by DeepSeek Harness.\n\nAutomation integration preset. Use only the supplied task.' }] }),
    ]))
    expect(receipt.sessionId).not.toBeNull()
    if (receipt.sessionId === null) throw new Error('Missing Session id')
    const log = await readColdSessionLog(ctx.sessionPersistence, receipt.sessionId)
    expect(log.events.find(event => event.type === 'user/message')).toMatchObject({
      data: { id: receipt.messageId, content: [{ type: 'text', text: draft.prompt }], source: { kind: 'plugin', plugin: 'automation', form: 'notice', summary: draft.title } },
    })
    expect(log.events.filter(event => event.type === 'turn/end')).toMatchObject([{ data: { turn: completed.turn, reason: { kind: 'completed' } } }])
    expect(workspace.sessionIds).toContain(receipt.sessionId)
    expect(ctx.agents.list()).toEqual([])
    expect(await runtime.run(request)).toEqual(completed)
    expect(model.requests).toHaveLength(1)
    expect(policyEvidence(log.events)).toMatchSnapshot()
    await fixture.dispose()
    const reopened = await boot()
    expect(reopened.ctx.automationRuntime.runs(definition.id, null, 10).runs).toEqual([completed])
    expect((await readColdSessionLog(reopened.ctx.sessionPersistence, receipt.sessionId)).events).toEqual(log.events)
    expect(reopened.workspace.sessionIds).toContain(receipt.sessionId)
    expect(reopened.model.requests).toEqual([])
  })
})
