/** Durable atomic claim, journal, and edit behavior on a real private SQLite database. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationStore } from '../src/store.ts'
import { AutomationOwnership } from '../src/ownership.ts'
import type { AutomationDefinition, AutomationRequestId, AutomationRun, AutomationRunId, AutomationSpec } from '../src/types.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

const resources: { directory: string; store: AutomationStore; lock: AutomationOwnership }[] = []
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.store.close()
    resource.lock.close()
    await rm(resource.directory, { recursive: true, force: true })
  }
})
async function bench() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-automation-store-'))
  const lock = await AutomationOwnership.acquire(directory)
  if (lock === null) throw new Error('isolated store unexpectedly occupied')
  const store = await AutomationStore.open(directory, directory, 'test')
  const resource = { directory, store, lock }
  resources.push(resource)
  const spec: AutomationSpec = { title: 'Nightly report', prompt: 'Write a report', workspaceId: brandString<WorkspaceId>('workspace'),
    workspacePath: directory, agentPresetId: 'default', model: { provider: 'fake', model: 'test' }, permissionPresetId: 'review',
    permission: { sandbox: 'read-only', approval: 'ask' }, schedule: { kind: 'hourly', minute: 0 } }
  return { resource, definition: store.create(spec, 1000, 3_600_000) }
}
function proposed(definition: AutomationDefinition, trigger: 'manual' | 'scheduled' = 'manual'): AutomationRun {
  return { id: brandString<AutomationRunId>(randomUUID()), automationId: definition.id, definitionRevision: definition.revision,
    scheduleRevision: definition.scheduleRevision, spec: definition.spec, trigger,
    requestId: trigger === 'manual' ? brandString<AutomationRequestId>(randomUUID()) : null, plannedAt: 3_600_000,
    sessionId: null, messageId: null, turn: null, status: 'starting', reason: null,
    createdAt: 3_600_100, updatedAt: 3_600_100, finishedAt: null }
}

describe('durable automation claims', () => {
  it('creates disabled and keeps first-edit revision fences independent of journal activity', async () => {
    const { resource, definition } = await bench()
    expect(definition.enabled).toBe(false)
    resource.store.claim(proposed(definition), definition.revision, null)
    const next = { ...definition, revision: 2, spec: { ...definition.spec, title: 'Edited report' } }
    expect(resource.store.update(next, 1).spec.title).toBe('Edited report')
    expect(() => resource.store.update({ ...next, revision: 3 }, 1)).toThrow('changed')
  })

  it('deduplicates manual retries after reopen without moving the recurring cursor', async () => {
    const { resource, definition } = await bench()
    const first = proposed(definition)
    const receipt = resource.store.claim(first, definition.revision, null)
    resource.store.close()
    resource.store = await AutomationStore.open(resource.directory, resource.directory, 'test')
    const retry = { ...first, id: brandString<AutomationRunId>(randomUUID()) }
    expect(resource.store.claim(retry, 99, null)).toEqual(receipt)
    expect(resource.store.get(definition.id)?.nextPlannedAt).toBe(definition.nextPlannedAt)
    expect(resource.store.runs(definition.id, null, 10).runs).toHaveLength(1)
  })

  it('claims scheduled UTC instant and cursor atomically and records overlapping occurrences', async () => {
    const { resource, definition } = await bench()
    const enabled = resource.store.update({ ...definition, enabled: true, revision: 2 }, 1)
    const first = proposed(enabled, 'scheduled')
    resource.store.claim(first, 2, 7_200_000)
    expect(resource.store.get(definition.id)?.nextPlannedAt).toBe(7_200_000)
    expect(() => resource.store.claim({ ...first, id: brandString<AutomationRunId>(randomUUID()) }, 2, 7_200_000)).toThrow('changed')
    const second = { ...proposed(enabled, 'scheduled'), plannedAt: 7_200_000 }
    expect(resource.store.claim(second, 2, 10_800_000)).toMatchObject({ status: 'skipped-overlap', sessionId: null, messageId: null })
    expect(resource.store.activeRuns()).toHaveLength(1)
    expect(resource.store.get(definition.id)?.nextPlannedAt).toBe(10_800_000)
  })

  it('rejects manual overlap and deleting an active plan', async () => {
    const { resource, definition } = await bench()
    resource.store.claim(proposed(definition), 1, null)
    expect(() => resource.store.claim(proposed(definition), 1, null)).toThrow('active run')
    expect(() => { resource.store.delete(definition.id, 1, 5000) }).toThrow('active run')
  })

  it('rolls back both claim and next cursor when persistence rejects insertion', async () => {
    const { resource, definition } = await bench()
    const enabled = resource.store.update({ ...definition, enabled: true, revision: 2 }, 1)
    const external = new DatabaseSync(join(resource.directory, 'state.sqlite3'))
    try { external.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON runs BEGIN SELECT RAISE(FAIL, 'disk failure'); END") } finally { external.close() }
    expect(() => resource.store.claim(proposed(enabled, 'scheduled'), 2, 7_200_000)).toThrow('could not be committed')
    expect(resource.store.runs(definition.id, null, 10).runs).toEqual([])
    expect(resource.store.get(definition.id)?.nextPlannedAt).toBe(definition.nextPlannedAt)
  })

  it('quarantines ambiguous work atomically and retains history after deleting the plan', async () => {
    const { resource, definition } = await bench()
    const run = resource.store.claim(proposed(definition), 1, null)
    resource.store.changeRun(run.id, { status: 'ambiguous', reason: 'dispatch-unconfirmed', updatedAt: 5000, finishedAt: 5000 }, true)
    expect(resource.store.get(definition.id)).toMatchObject({ enabled: false, needsReview: true, revision: 2 })
    resource.store.delete(definition.id, 2, 6000)
    expect(resource.store.definitions()).toEqual([])
    expect(resource.store.runs(definition.id, null, 10).runs).toMatchObject([{ id: run.id, status: 'ambiguous' }])
  })

  it('pages equal-time receipts by durable sequence and refuses a foreign cursor', async () => {
    const { resource, definition } = await bench()
    for (let count = 0; count < 3; count++) {
      const run = resource.store.claim(proposed(definition), 1, null)
      resource.store.changeRun(run.id, { status: 'completed', finishedAt: 5000, updatedAt: 5000 })
    }
    const first = resource.store.runs(definition.id, null, 2)
    const second = resource.store.runs(definition.id, first.nextCursor, 2)
    expect([...first.runs, ...second.runs]).toHaveLength(3)
    expect(new Set([...first.runs, ...second.runs].map(run => run.id)).size).toBe(3)
    expect(second.nextCursor).toBeNull()
    expect(() => resource.store.runs(definition.id, brandString<AutomationRunId>('foreign'), 2)).toThrow('cursor')
  })

  it('rejects opening another home or profile and invalid durable JSON', async () => {
    const { resource, definition } = await bench()
    await expect(AutomationStore.open(resource.directory, resource.directory, 'other')).rejects.toThrow('could not be opened')
    const external = new DatabaseSync(join(resource.directory, 'state.sqlite3'))
    try { external.prepare('UPDATE definitions SET body=? WHERE id=?').run('{"invalid":true}', definition.id) } finally { external.close() }
    resource.store.close()
    await expect(AutomationStore.open(resource.directory, resource.directory, 'test')).rejects.toThrow('could not be opened')
    // Restore valid source data so the caller-owned cleanup can close a live handle.
    const repair = new DatabaseSync(join(resource.directory, 'state.sqlite3'))
    try { repair.prepare('UPDATE definitions SET body=? WHERE id=?').run(JSON.stringify(definition),
      definition.id) } finally { repair.close() }
    resource.store = await AutomationStore.open(resource.directory, resource.directory, 'test')
  })
})
