/** Profile-private SQLite definitions, occurrence claims, and run journal. */
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { brandString } from '@deepseek-ai/dsh-brand'
import { definitionSchema, runSchema } from './schema.ts'
import { AutomationError } from './error.ts'
import { ensurePrivateDatabase } from './ownership.ts'
import type { AutomationDefinition, AutomationId, AutomationRun, AutomationRunId,
  AutomationRunPage, AutomationRequestId, AutomationSpec } from './types.ts'

const SCHEMA_VERSION = 1
const ACTIVE = "('starting','running','stopping')"
/** A durable invocation still owns overlap until teardown settles. */
function isActiveRun(run: AutomationRun): boolean {
  return run.status === 'starting' || run.status === 'running' || run.status === 'stopping'
}
interface StoredRow { body: string }

/** SQLite data owner. The caller must hold AutomationOwnership for this directory. */
export class AutomationStore {
  private constructor(private readonly database: DatabaseSync) {}

  /** Open an owned profile's durable data and validate its exact scope.
   * @param directory - canonical stable state directory beneath Harness home.
   * @param home - canonical Harness home recorded with the profile identity.
   * @param profile - validated actual launch profile.
   * @returns an initialized, exclusively owned store.
   */
  static async open(directory: string, home: string, profile: string): Promise<AutomationStore> {
    const path = join(directory, 'state.sqlite3')
    await ensurePrivateDatabase(path)
    const database = new DatabaseSync(path)
    try {
      database.exec('PRAGMA busy_timeout = 0; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON')
      const version = database.prepare('PRAGMA user_version').get()?.['user_version']
      if (version !== 0 && version !== SCHEMA_VERSION) throw new Error('unsupported automation schema version')
      database.exec('BEGIN IMMEDIATE')
      try {
        database.exec(
          'CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), home TEXT NOT NULL, profile TEXT NOT NULL, revision INTEGER NOT NULL);' +
          'CREATE TABLE IF NOT EXISTS definitions (id TEXT PRIMARY KEY, body TEXT NOT NULL);' +
          'CREATE TABLE IF NOT EXISTS runs (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, automation_id TEXT NOT NULL REFERENCES definitions(id), schedule_revision INTEGER NOT NULL, trigger TEXT NOT NULL, request_id TEXT, planned_at INTEGER NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);' +
          "CREATE UNIQUE INDEX IF NOT EXISTS scheduled_occurrence ON runs(automation_id,schedule_revision,planned_at) WHERE trigger='scheduled';" +
          'CREATE UNIQUE INDEX IF NOT EXISTS manual_request ON runs(request_id) WHERE request_id IS NOT NULL;' +
          'CREATE UNIQUE INDEX IF NOT EXISTS active_automation ON runs(automation_id) WHERE status IN ' + ACTIVE + ';',
        )
        const scope = database.prepare('SELECT home, profile FROM meta WHERE id=1').get()
        if (scope === undefined) database.prepare('INSERT INTO meta VALUES(1,?,?,0)').run(home, profile)
        else if (scope['home'] !== home || scope['profile'] !== profile) throw new Error('automation database belongs to another home or profile')
        database.exec('PRAGMA user_version = ' + String(SCHEMA_VERSION))
        database.exec('COMMIT')
      } catch (error: unknown) {
        database.exec('ROLLBACK')
        throw error
      }
      const store = new AutomationStore(database)
      store.definitions(true)
      for (const row of database.prepare('SELECT body FROM runs').all()) runSchema.parse(JSON.parse(String(row['body'])))
      return store
    } catch (error: unknown) {
      database.close()
      throw new AutomationError('storage', 'Automation storage could not be opened.', { cause: error })
    }
  }

  /** Last committed state revision. */
  get revision(): number { return Number(this.database.prepare('SELECT revision FROM meta WHERE id=1').get()?.['revision']) }

  /** Read saved plans, optionally retaining deleted records for journal validation.
   * @param includeDeleted - whether deleted definitions are included.
   * @returns detached validated records.
   */
  definitions(includeDeleted = false): AutomationDefinition[] {
    return this.database.prepare('SELECT body FROM definitions ORDER BY rowid').all()
      .map(row => definitionSchema.parse(JSON.parse(String(row['body']))))
      .filter(item => includeDeleted || item.deletedAt === null)
  }

  /** Resolve one saved identity, including a deleted plan's history.
   * @param id - exact profile-local task id.
   * @returns the saved definition, or undefined.
   */
  get(id: AutomationId): AutomationDefinition | undefined {
    const row = this.database.prepare('SELECT body FROM definitions WHERE id=?').get(id) as StoredRow | undefined
    return row === undefined ? undefined : definitionSchema.parse(JSON.parse(row.body))
  }

  /** Read all still-owned invocations.
   * @returns the committed claims whose Agent teardown has not settled.
   */
  activeRuns(): AutomationRun[] {
    return this.database.prepare('SELECT body FROM runs WHERE status IN ' + ACTIVE).all().map(row => runSchema.parse(JSON.parse(String(row['body']))))
  }

  /** Resolve an existing manual retry before any revision or resource work.
   * @param requestId - original client request token.
   * @returns its committed receipt, if one exists.
   */
  request(requestId: AutomationRequestId): AutomationRun | undefined {
    return this.parseRun(this.database.prepare('SELECT body FROM runs WHERE request_id=?').get(requestId))
  }

  /** Resolve one committed run.
   * @param id - durable run id.
   * @returns the invocation receipt, or undefined.
   */
  run(id: AutomationRunId): AutomationRun | undefined {
    return this.parseRun(this.database.prepare('SELECT body FROM runs WHERE id=?').get(id))
  }

  /** Read a bounded newest-first journal page.
   * @param id - task identity, including deleted tasks.
   * @param cursor - last run of the previous page.
   * @param limit - validated page size.
   * @returns records and an exact next cursor.
   */
  runs(id: AutomationId, cursor: AutomationRunId | null, limit: number): AutomationRunPage {
    if (this.get(id) === undefined) throw new AutomationError('not-found', 'Automation not found.')
    let before = Number.MAX_SAFE_INTEGER
    if (cursor !== null) {
      const row = this.database.prepare('SELECT sequence FROM runs WHERE id=? AND automation_id=?').get(cursor, id)
      if (row === undefined) throw new AutomationError('invalid', 'Journal cursor does not belong to this automation.')
      before = Number(row['sequence'])
    }
    const records = this.database.prepare('SELECT body FROM runs WHERE automation_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?')
      .all(id, before, limit + 1).map(row => runSchema.parse(JSON.parse(String(row['body']))))
    const runs = records.slice(0, limit)
    return { runs, nextCursor: records.length > limit ? runs.at(-1)?.id ?? null : null }
  }

  /** Persist a new disabled plan.
   * @param spec - fully resolved input and authority.
   * @param now - creation instant.
   * @param next - first future UTC occurrence.
   * @returns the committed disabled definition.
   */
  create(spec: AutomationSpec, now: number, next: number): AutomationDefinition {
    return this.transaction(() => {
      const definition: AutomationDefinition = { id: brandString<AutomationId>(randomUUID()),
        revision: 1, scheduleRevision: 1, spec, enabled: false, needsReview: false,
        nextPlannedAt: next, createdAt: now, updatedAt: now, deletedAt: null }
      this.writeDefinition(definition)
      return definition
    })
  }

  /** Replace one definition using the first-edit revision.
   * @param next - proposed resolved replacement.
   * @param expectedRevision - revision the user edited.
   * @returns the committed replacement.
   */
  update(next: AutomationDefinition, expectedRevision: number): AutomationDefinition {
    return this.transaction(() => {
      this.requireCurrent(next.id, expectedRevision)
      this.writeDefinition(next)
      return next
    })
  }

  /** Delete an inactive definition while keeping every run receipt.
   * @param id - task to remove from the live list.
   * @param revision - current edited revision.
   * @param now - deletion instant.
   */
  delete(id: AutomationId, revision: number, now: number): void {
    this.transaction(() => {
      const definition = this.requireCurrent(id, revision)
      if (this.activeRuns().some(run => run.automationId === id)) throw new AutomationError('busy',
        'Stop the active run before deleting this automation.')
      this.writeDefinition({ ...definition, enabled: false, deletedAt: now, updatedAt: now, revision: definition.revision + 1 })
    })
  }

  /** Commit claim and recurrence movement together before creating an Agent.
   * @param proposed - immutable run specification with preallocated Session and message identities.
   * @param expectedRevision - definition observed during preflight.
   * @param next - scheduled cursor movement; null for manual runs.
   * @returns the committed receipt, including an overlap skip or an existing idempotent request.
   */
  claim(proposed: AutomationRun, expectedRevision: number, next: number | null): AutomationRun {
    return this.transaction(() => {
      if (proposed.requestId !== null) {
        const previous = this.request(proposed.requestId)
        if (previous !== undefined) {
          if (previous.automationId !== proposed.automationId) throw new AutomationError('conflict',
            'Run request belongs to another automation.')
          return previous
        }
      }
      const definition = this.requireCurrent(proposed.automationId, expectedRevision)
      if (proposed.trigger === 'scheduled' && (!definition.enabled || definition.nextPlannedAt !== proposed.plannedAt)) {
        throw new AutomationError('conflict', 'Scheduled occurrence changed before admission.')
      }
      const busy = this.activeRuns().some(run => run.automationId === proposed.automationId)
      if (busy && proposed.trigger === 'manual') throw new AutomationError('busy', 'This automation already has an active run.')
      const run: AutomationRun = busy ? { ...proposed, status: 'skipped-overlap',
        sessionId: null, messageId: null, finishedAt: proposed.createdAt, reason: 'overlap' } : proposed
      this.database.prepare('INSERT INTO runs(id,automation_id,schedule_revision,trigger,request_id,planned_at,status,body) VALUES(?,?,?,?,?,?,?,?)')
        .run(run.id, run.automationId, run.scheduleRevision, run.trigger,
          run.requestId, run.plannedAt, run.status, JSON.stringify(runSchema.parse(run)))
      if (next !== null) this.writeDefinition({ ...definition, nextPlannedAt: next, updatedAt: proposed.createdAt })
      return run
    })
  }

  /** Commit run evidence, optionally pausing uncertain work for review.
   * @param id - invocation to transition.
   * @param patch - next evidence fields.
   * @param quarantine - pause future scheduling after uncertainty.
   * @returns the newly committed receipt.
   */
  changeRun(id: AutomationRunId, patch: Partial<Pick<AutomationRun, 'status' | 'turn' | 'reason' | 'updatedAt' | 'finishedAt'>>,
    quarantine = false): AutomationRun {
    return this.transaction(() => {
      const previous = this.run(id)
      if (previous === undefined) throw new AutomationError('not-found', 'Automation run not found.')
      if (!isActiveRun(previous)) return previous
      const next = runSchema.parse({ ...previous, ...patch })
      this.database.prepare('UPDATE runs SET status=?,body=? WHERE id=?').run(next.status, JSON.stringify(next), id)
      if (quarantine) {
        const definition = this.get(next.automationId)
        if (definition !== undefined) this.writeDefinition({ ...definition,
          enabled: false, needsReview: true, updatedAt: next.updatedAt, revision: definition.revision + 1 })
      }
      return next
    })
  }

  /** Move past missed time without creating fictional run records.
   * @param id - enabled task.
   * @param before - exact cursor observed by the scheduler.
   * @param next - future instant, never earlier than the old cursor.
   * @param now - observation instant.
   */
  advance(id: AutomationId, before: number, next: number, now: number): void {
    this.transaction(() => {
      const definition = this.get(id)
      if (definition === undefined || !definition.enabled || definition.nextPlannedAt !== before) return
      if (next <= before) throw new AutomationError('invalid', 'Schedule cursor must advance.')
      this.writeDefinition({ ...definition, nextPlannedAt: next, updatedAt: now })
    })
  }

  /** Close only after the runtime drains all writers. */
  close(): void { this.database.close() }

  private parseRun(row: Record<string, unknown> | undefined): AutomationRun | undefined {
    return row === undefined ? undefined : runSchema.parse(JSON.parse(String(row['body'])))
  }

  private requireCurrent(id: AutomationId, revision: number): AutomationDefinition {
    const definition = this.get(id)
    if (definition === undefined || definition.deletedAt !== null) throw new AutomationError('not-found', 'Automation not found.')
    if (definition.revision !== revision) throw new AutomationError('conflict', 'Automation changed. Reload before saving.')
    return definition
  }

  private writeDefinition(definition: AutomationDefinition): void {
    this.database.prepare('INSERT INTO definitions(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(definition.id, JSON.stringify(definitionSchema.parse(definition)))
  }

  private transaction<T>(action: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.database.exec('UPDATE meta SET revision=revision+1 WHERE id=1')
      this.database.exec('COMMIT')
      return result
    } catch (error: unknown) {
      try { this.database.exec('ROLLBACK') } catch (rollbackError: unknown) {
        throw new AutomationError('storage', 'Automation commit could not be confirmed.',
          { cause: new AggregateError([error, rollbackError]) })
      }
      if (error instanceof AutomationError) throw error
      throw new AutomationError('storage', 'Automation state could not be committed.', { cause: error })
    }
  }
}
