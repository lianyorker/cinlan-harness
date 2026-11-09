import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { TaskId } from '@cinlan/coordination'
import type { CoordinationEvent, TaskSnapshot } from '@cinlan/coordination'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import type { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { JOURNAL_UNIT, SqliteCoordinationService, journalKey } from '@cinlan/coordination-sqlite'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    // Crashed contexts leak their SQLite connection until process exit, so on
    // Windows the directory may still be locked; leftovers in tmpdir are fine.
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

async function makeDatabase(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'coordination-sqlite-'))
  directories.push(directory)
  return join(directory, 'harness.db')
}

/**
 * Start a service on a file-backed database and abandon the context without
 * disposal, mimicking a process crash: the journal keeps whatever was
 * committed before the abandonment, running executors never settle, and no
 * cancellation or eviction bookkeeping ever runs.
 */
async function crashedSetup(path: string, config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path })
  await ctx.plugin(SqliteCoordinationService, config)
  return ctx
}

async function resumedSetup(path: string, config: Record<string, unknown> = {}): Promise<Context> {
  // A resumed service replays the journal from the same construction path a
  // crashed process used; building the context identically keeps that
  // equivalence literal.
  return crashedSetup(path, config)
}

async function waitForStatus(ctx: Context, taskId: TaskId, status: TaskSnapshot['status']): Promise<void> {
  await vi.waitFor(() => { expect(ctx.coordination.getTask(taskId).status).toBe(status) })
}

describe('SqliteCoordinationService crash recovery', () => {
  it('fails tasks that were running when the process died, without re-dispatching them', async () => {
    const path = await makeDatabase()
    const crashed = await crashedSetup(path)
    const oldDispatches: TaskId[] = []
    crashed.coordination.registerExecutor('slow', (task) => {
      oldDispatches.push(task.id)
      return new Promise<never>(() => {})
    })

    const run = await crashed.coordination.start({ tasks: [
      { id: TaskId('was-running'), label: 'was running', executor: 'slow' },
    ] })
    await waitForStatus(crashed, TaskId('was-running'), 'running')
    void crashed

    const resumed = await resumedSetup(path)
    const newDispatches: TaskId[] = []
    resumed.coordination.registerExecutor('slow', (task) => {
      newDispatches.push(task.id)
      return { status: 'succeeded' }
    })

    expect(resumed.coordination.getTask(TaskId('was-running')).status).toBe('failed')
    expect(resumed.coordination.getTask(TaskId('was-running')).error).toBe('execution interrupted by process restart')
    expect(resumed.coordination.getRun(run.snapshot.id).status).toBe('failed')
    expect(oldDispatches).toEqual([TaskId('was-running')])
    // The interrupted task is never handed to a fresh executor: re-running it
    // would repeat side effects the journal already accounts for.
    await vi.waitFor(() => { expect(newDispatches).toEqual([]) })
    // The run settled as failed, so it is terminal and refuses new work.
    await expect(resumed.coordination.addTask(run.snapshot.id, { label: 'late', executor: 'slow' })).rejects.toThrow(/terminal/)
    await resumed.fiber.dispose()
  })

  it('continues tasks that had not been dispatched from their journaled state', async () => {
    const path = await makeDatabase()
    const crashed = await crashedSetup(path, { maxConcurrency: 1 })
    // The first task saturates the only slot and never settles; the second
    // stays `ready`, admitted but never dispatched, when the crash hits.
    crashed.coordination.registerExecutor('saturate', () => new Promise<never>(() => {}))
    const run = await crashed.coordination.start({ tasks: [
      { id: TaskId('holder'), label: 'holder', executor: 'saturate' },
      { id: TaskId('queued'), label: 'queued', executor: 'saturate' },
    ] })
    await waitForStatus(crashed, TaskId('holder'), 'running')
    await waitForStatus(crashed, TaskId('queued'), 'ready')
    void crashed

    const resumed = await resumedSetup(path, { maxConcurrency: 1 })
    // The interrupted one fails; the not-yet-dispatched one resumes `ready`.
    expect(resumed.coordination.getTask(TaskId('holder')).status).toBe('failed')
    resumed.coordination.registerExecutor('saturate', () => ({ status: 'succeeded' }))
    // Registration alone does not pump (mirrors the local provider); a fresh
    // admission op drives the pump that dispatches the recovered ready task.
    // The pump dispatches the older `queued` first, so both runs settle.
    const trigger = await resumed.coordination.start({ tasks: [
      { id: TaskId('trigger'), label: 'trigger', executor: 'saturate' },
    ] })
    await expect(trigger.result).resolves.toMatchObject({ status: 'succeeded' })
    // The resumed run settled `failed` (its holder was interrupted); the
    // crashed context's own run.result promise died with that process.
    expect(resumed.coordination.getRun(run.snapshot.id).status).toBe('failed')
    expect(resumed.coordination.getTask(TaskId('queued')).status).toBe('succeeded')
    await resumed.fiber.dispose()
  })

  it('does not restore pending approvals or listeners across the crash', async () => {
    const path = await makeDatabase()
    const crashed = await crashedSetup(path)
    crashed.coordination.registerExecutor('wait', () => new Promise<never>(() => {}))
    const run = await crashed.coordination.start({ tasks: [
      { id: TaskId('task'), label: 'task', executor: 'wait' },
    ] })
    await waitForStatus(crashed, TaskId('task'), 'running')
    // An adapter that never answers: the gate stays pending in the crashed
    // process forever, exactly as it would if the process had died.
    crashed.coordination.onApprovalRequest(() => new Promise<never>(() => {}))
    void crashed.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?' }).catch(() => {})
    void crashed

    const resumed = await resumedSetup(path)
    // Listeners are not restored: recovery emits only the recovery-time
    // transitions, and nothing replays the journal into listener callbacks.
    const replayed: CoordinationEvent[] = []
    resumed.coordination.onEvent((event) => { replayed.push(event) })
    expect(resumed.coordination.getTask(TaskId('task')).status).toBe('failed')

    // No approval state survives: the gate is unknown to the new process.
    expect(() => {
      resumed.coordination.decideApproval({
        taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?', approved: true, decidedAt: 1,
      })
    }).toThrow(/not pending/)
    // The task is terminal, so a fresh approval request is refused.
    expect(() => resumed.coordination.requestApproval({ taskId: TaskId('task'), gateId: 'gate', prompt: 'continue?' })).toThrow(/terminal/)
    // Recovery transitions were emitted during init, before any listener
    // could attach; a late listener sees only transitions from now on.
    expect(resumed.coordination.getRun(run.snapshot.id)).toMatchObject({ status: 'failed' })
    expect(replayed).toEqual([])
    await resumed.fiber.dispose()
  })

  it('rejects calls while the journal is still recovering', async () => {
    const ctx = new Context()
    await ctx.plugin(Storage)
    // A backend whose kv facet never finishes opening: the service's init
    // stalls, so the plugin fiber stays pending while ctx.coordination is
    // already registered — reads must fail loudly, not serve a half-open view.
    const stalled = { kv: { open: (): Promise<never> => new Promise(() => {}) } }
    ctx.storage.backend.register('stalled', stalled as never)
    void ctx.plugin(SqliteCoordinationService, { backend: 'stalled' })

    await vi.waitFor(async () => {
      await expect(ctx.coordination.start({ tasks: [{ label: 'x', executor: 'x' }] })).rejects.toThrow(/still recovering/)
    })
    expect(() => ctx.coordination.getRun('run-x' as never)).toThrow(/still recovering/)
  })

  it('fails startup loudly on a tampered journal record', async () => {
    const path = await makeDatabase()
    const crashed = await crashedSetup(path)
    crashed.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const run = await crashed.coordination.start({ tasks: [
      { id: TaskId('task'), label: 'task', executor: 'noop' },
    ] })
    await run.result
    void crashed

    // Tamper: record 1's envelope claims sequence 2, contradicting its key.
    const tamper = new Context()
    await tamper.plugin(Storage)
    await tamper.plugin(StorageSqlite, { path })
    const backend = tamper.storage.backend.get('sqlite') as SqliteStorageBackend
    const unit = await backend.kv!.open({ ...JOURNAL_UNIT })
    await unit.putRecord('journal', journalKey(1), {
      seq: 2,
      event: { type: 'run/started', run: { id: 'run-fake', status: 'running', taskIds: [], createdAt: 0 } },
      at: 0,
      submissionId: 'jnl/fake',
      resultDigest: 'fake',
    })
    await backend.close()

    // Recovery validates every envelope against its key: startup rejects.
    await expect(resumedSetup(path)).rejects.toThrow()
  })

  it('keeps the full journal history across evictions for later processes', async () => {
    const path = await makeDatabase()
    const first = await crashedSetup(path, { maxRetainedRuns: 1 })
    first.coordination.registerExecutor('noop', () => ({ status: 'succeeded' }))
    const runA = await first.coordination.start({ tasks: [
      { id: TaskId('a'), label: 'A', executor: 'noop' },
    ] })
    await runA.result
    const runB = await first.coordination.start({ tasks: [
      { id: TaskId('b'), label: 'B', executor: 'noop' },
    ] })
    await runB.result
    await vi.waitFor(() => { expect(() => first.coordination.getRun(runA.snapshot.id)).toThrow(/unknown run/) })
    void first

    // A fresh backend instance on the same file reads the whole history:
    // eviction is a memory projection, never a journal deletion.
    const reader = new Context()
    await reader.plugin(Storage)
    await reader.plugin(StorageSqlite, { path })
    const backend = reader.storage.backend.get('sqlite') as SqliteStorageBackend
    const unit = await backend.kv!.open({ ...JOURNAL_UNIT })
    const records = await unit.loadAll()
    const keys = Object.keys(records.tables.journal ?? {}).sort()
    expect(keys.length).toBeGreaterThan(10)
    expect(keys).toEqual(keys.map((_key, index) => journalKey(index + 1)))
    const entries = Object.values(records.tables.journal ?? {}) as Array<{ event: CoordinationEvent }>
    const types = entries.map(entry => entry.event.type)
    expect(types).toContain('run/started')
    expect(types).toContain('run/ended')
    expect(types).toContain('run/evicted')
    await backend.close()
  })
})
