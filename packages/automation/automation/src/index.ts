/** Durable local UTC scheduling and ordinary Agent execution for one launch profile. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import { readColdSessionLog } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-title'
import type { SessionId, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { AutomationError } from './error.ts'
import { AutomationOwnership } from './ownership.ts'
import { AutomationStore } from './store.ts'
import { AutomationExecution } from './run.ts'
import { localWorkspace } from './workspace.ts'
import { draftSchema, scheduleSchema, updateSchema } from './schema.ts'
import { nextOccurrences } from './recurrence.ts'
import { runOutcome, outcomeStatus } from './outcome.ts'
import type {
  AutomationConfig, AutomationDefinition, AutomationDelete, AutomationDraft, AutomationId,
  AutomationRun, AutomationRunId, AutomationRunPage, AutomationRunRequest, AutomationSchedule,
  AutomationSnapshot, AutomationSpec, AutomationUpdate,
} from './types.ts'

export type * from './types.ts'
export { AutomationError } from './error.ts'
/** Explicit deployment settings; the Web bundle supplies its chosen policy. */
export type Config = AutomationConfig
export const Config: z<Config> = z.object({
  profile: z.string().required(),
  clockCheckIntervalMs: z.number().min(1).required(),
  maxStartLatenessMs: z.number().min(1).required(),
})

declare module '@deepseek-ai/cordis' {
  interface Context { automationRuntime: AutomationRuntime }
}

/** Concrete same-Host automation owner, with no remote routing or replay queue. */
export class AutomationRuntime extends Service {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionTitle',
    'agentPresets', 'permissionPresets', 'workspaceRegistry', 'llm']
  private store: AutomationStore | undefined
  private ownership: AutomationOwnership | undefined
  private current: AutomationSnapshot
  private readonly listeners = new Set<(value: AutomationSnapshot) => void>()
  private readonly executions = new Map<AutomationRunId, { operation: AutomationExecution; done: Promise<void> }>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private tick: Promise<void> | undefined
  private initialization: Promise<void> | undefined
  private closing = false

  /** @param ctx - actual launch profile and Host services.
   * @param config - required profile and validated scheduling policy.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'automationRuntime')
    if (config.profile === '' || config.profile === '.' || config.profile === '..' || config.profile === 'node_modules'
      || config.profile.includes('/') || config.profile.includes(String.fromCharCode(92)) || config.profile.includes(String.fromCharCode(0))
      || ctx.get('dshProfileName') !== config.profile) throw new Error('automation requires the actual launcher profile identity')
    if (![config.clockCheckIntervalMs, config.maxStartLatenessMs].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('automation timing policy requires positive safe integers')
    }
    this.current = { status: 'unavailable', profile: config.profile, reason: 'storage' }
  }

  protected async [Service.init](): Promise<void> {
    this.ctx.effect(() => () => this.disposeRuntime(), 'automation.runtime')
    this.initialization = this.initialize()
    await this.initialization
  }

  private async initialize(): Promise<void> {
    try {
      await mkdir(resolveDshHome(), { recursive: true, mode: 0o700 })
      const home = await realpath(resolveDshHome())
      const directory = join(home, 'automations', this.config.profile)
      const ownership = await AutomationOwnership.acquire(directory)
      if (ownership === null) {
        this.current = { status: 'unavailable', profile: this.config.profile, reason: 'owned' }
        return
      }
      this.ownership = ownership
      if (this.isClosing()) return
      this.store = await AutomationStore.open(directory, home, this.config.profile)
      await this.recover()
      if (this.isClosing()) return
      const now = Date.now()
      for (const definition of this.store.definitions()) {
        if (definition.enabled && definition.nextPlannedAt !== null && definition.nextPlannedAt <= now) {
          this.store.advance(definition.id, definition.nextPlannedAt, this.next(definition.spec.schedule, now), now)
        }
      }
      this.current = this.readSnapshot()
      this.publish()
      this.arm()
    } catch (error: unknown) { this.failStorage(error) }
  }

  /** Current committed state; object identity changes only with publication.
   * @returns the most recently committed view or explicit availability state.
   */
  snapshot(): AutomationSnapshot { return this.current }

  /** Subscribe to committed snapshots.
   * @param listener - observer whose failure does not undo a durable operation.
   * @returns the subscription disposer.
   */
  subscribe(listener: (snapshot: AutomationSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Resolve and save a disabled automation for a local Workspace; remote bindings reject before path access.
   * @param draft - explicit user choices; defaults are resolved by the editor.
   * @returns the committed definition.
   */
  async create(draft: AutomationDraft): Promise<AutomationDefinition> {
    this.requireStore()
    const spec = await this.resolveDraft(draft)
    const now = Date.now()
    const definition = this.commit(() => this.requireStore().create(spec, now, this.next(spec.schedule, now)))
    return definition
  }

  /** Save a complete revision-fenced draft with explicit enable/pause behavior.
   * @param request - edited revision, explicit values, and intended enable state.
   * @returns the committed replacement; active runs keep their immutable inputs.
   */
  async update(request: AutomationUpdate): Promise<AutomationDefinition> {
    const input = this.parse(() => updateSchema.parse(request))
    const previous = this.definition(input.id, input.expectedRevision)
    const spec = await this.resolveDraft(input.draft)
    const now = Date.now()
    const changed = JSON.stringify(previous.spec.schedule) !== JSON.stringify(spec.schedule)
    const reset = changed || (!previous.enabled && input.enabled)
    const next = reset ? this.next(spec.schedule, changed ? now : Math.max(now,
      (previous.nextPlannedAt ?? now) - 1)) : previous.nextPlannedAt
    const definition = this.commit(() => this.requireStore().update({ ...previous, spec, enabled: input.enabled,
      needsReview: input.enabled ? false : previous.needsReview, revision: previous.revision + 1,
      scheduleRevision: previous.scheduleRevision + (changed ? 1 : 0), nextPlannedAt: next, updatedAt: now }, input.expectedRevision))
    this.arm()
    return definition
  }

  /** Remove an inactive plan while retaining its journal.
   * @param request - exact identity and edited revision.
   */
  delete(request: AutomationDelete): Promise<void> {
    return Promise.resolve().then(() => {
      this.definition(request.id, request.expectedRevision)
      this.commit(() => { this.requireStore().delete(request.id, request.expectedRevision, Date.now()) })
      this.arm()
    })
  }

  /** Admit an explicit manual run without enabling or moving recurrence.
   * @param request - exact definition revision and stable retry token.
   * @returns an already durable invocation receipt.
   */
  async run(request: AutomationRunRequest): Promise<AutomationRun> {
    if (typeof request.requestId !== 'string' || request.requestId.length === 0) throw new AutomationError('invalid',
      'Run request id is required.')
    const previous = this.requireStore().request(request.requestId)
    if (previous !== undefined) {
      if (previous.automationId !== request.id) throw new AutomationError('conflict', 'Run request belongs to another automation.')
      return previous
    }
    const definition = this.definition(request.id, request.expectedRevision)
    const workspace = await this.verifySpec(definition.spec)
    const { run, message } = this.proposal(definition, Date.now(), request.requestId)
    const receipt = this.commit(() => this.requireStore().claim(run, request.expectedRevision, null))
    if (receipt.id === run.id) this.launch(receipt, message, workspace)
    return receipt
  }

  /** Request real cancellation of this runtime's invocation.
   * @param id - durable run identity.
   */
  async cancel(id: AutomationRunId): Promise<void> {
    const active = this.executions.get(id)
    if (active === undefined) throw new AutomationError('not-found', 'No live automation invocation owns this run.')
    try {
      this.commit(() => this.requireStore().changeRun(id, { status: 'stopping', updatedAt: Date.now() }))
    } finally { active.operation.cancel('user') }
    await active.done
  }

  /** Read a bounded newest-first journal page.
   * @param id - task identity.
   * @param cursor - previous page cursor, or null.
   * @param limit - record count, 1 through 100.
   * @returns recorded invocations, never synthetic history.
   */
  runs(id: AutomationId, cursor: AutomationRunId | null, limit: number): AutomationRunPage {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AutomationError('invalid',
      'Journal page size must be between 1 and 100.')
    return this.requireStore().runs(id, cursor, limit)
  }

  /** Preview five future UTC occurrences without saving or dispatching.
   * @param schedule - proposed minute schedule.
   * @param afterUtc - absolute epoch milliseconds.
   * @returns five strictly future UTC instants.
   */
  previewSchedule(schedule: AutomationSchedule, afterUtc: number): number[] {
    const parsed = this.parse(() => scheduleSchema.parse(schedule))
    if (!Number.isSafeInteger(afterUtc) || afterUtc < 0 || afterUtc > 8_640_000_000_000_000) throw new AutomationError('invalid',
      'Preview requires a valid UTC instant.')
    return nextOccurrences(parsed, afterUtc, 5)
  }

  private definition(id: AutomationId, revision?: number): AutomationDefinition {
    const definition = this.requireStore().get(id)
    if (definition === undefined || definition.deletedAt !== null) throw new AutomationError('not-found', 'Automation not found.')
    if (revision !== undefined && revision !== definition.revision) throw new AutomationError('conflict',
      'Automation changed. Reload before saving.')
    return definition
  }

  private async resolveDraft(input: AutomationDraft): Promise<AutomationSpec> {
    const draft = this.parse(() => draftSchema.parse(input))
    try {
      const workspace = localWorkspace(this.ctx, draft.workspaceId)
      if (await workspace.status() !== 'ok') throw new Error('saved workspace is unavailable')
      const permission = this.ctx.permissionPresets.resolve(draft.permissionPresetId)
      const spec: AutomationSpec = { ...draft, workspacePath: workspace.path,
        permission: { sandbox: permission.sandbox, approval: permission.approval } }
      await this.verifySpec(spec)
      return spec
    } catch (error: unknown) {
      throw new AutomationError('resource', 'Choose an available workspace, preset, model and permission.', { cause: error })
    }
  }

  private async verifySpec(spec: AutomationSpec): Promise<Workspace> {
    try {
      const workspace = localWorkspace(this.ctx, spec.workspaceId, spec.workspacePath)
      if (await workspace.status() !== 'ok') throw new Error('saved workspace is unavailable')
      localWorkspace(this.ctx, spec.workspaceId, spec.workspacePath)
      if (await realpath(spec.workspacePath) !== spec.workspacePath) throw new Error('saved workspace moved')
      const permission = this.ctx.permissionPresets.resolve(spec.permissionPresetId)
      if (permission.sandbox !== spec.permission.sandbox || permission.approval !== spec.permission.approval) throw new Error('saved permission preset changed')
      const preset = await this.ctx.agentPresets.resolve(spec.agentPresetId)
      if (preset.broken !== undefined) throw new Error('saved Agent preset is unavailable')
      const model = await this.ctx.llm.resolveModelInfo(spec.model.provider, spec.model.model)
      const effort = spec.model.reasoningEffort
      if (effort !== undefined && (model.reasoning === undefined || !model.reasoning.efforts.some(choice => choice.id === effort))) throw new Error('saved reasoning effort is unavailable')
      return localWorkspace(this.ctx, spec.workspaceId, spec.workspacePath)
    } catch (error: unknown) {
      throw new AutomationError('resource', 'Saved workspace, preset, model, or permission is unavailable or changed.', { cause: error })
    }
  }

  private proposal(definition: AutomationDefinition, plannedAt: number,
    requestId: AutomationRunRequest['requestId'] | null): { run: AutomationRun; message: UserMessage } {
    const message = createUserMessage({ content: [{ type: 'text', text: definition.spec.prompt }],
      source: { kind: 'plugin', plugin: 'automation', form: 'notice', summary: boundContextSummary(definition.spec.title) } })
    const now = Date.now()
    const run: AutomationRun = { id: brandString<AutomationRunId>(randomUUID()), automationId: definition.id,
      definitionRevision: definition.revision, scheduleRevision: definition.scheduleRevision, spec: definition.spec,
      trigger: requestId === null ? 'scheduled' : 'manual', requestId, plannedAt,
      sessionId: brandString<SessionId>('automation-' + randomUUID()), messageId: message.id, turn: null,
      status: 'starting', reason: null, createdAt: now, updatedAt: now, finishedAt: null }
    return { run, message }
  }

  private launch(run: AutomationRun, message: UserMessage, workspace: Workspace): void {
    const operation = new AutomationExecution(this.ctx, this.requireStore(), run, message, workspace,
      () => { this.publish() }, (error) => { this.failStorage(error) })
    const done = this.ctx.agents.withoutInitiator(() => Promise.resolve().then(() => operation.execute()))
      .catch((error: unknown) => { this.failStorage(error) }).finally(() => { this.executions.delete(run.id) })
    this.executions.set(run.id, { operation, done })
  }

  private async checkDue(): Promise<void> {
    const store = this.requireStore()
    for (const definition of store.definitions()) {
      if (!this.available()) return
      const planned = definition.nextPlannedAt
      const now = Date.now()
      if (!definition.enabled || planned === null || planned > now) continue
      const next = this.next(definition.spec.schedule, Math.max(now, planned))
      if (now - planned >= this.config.maxStartLatenessMs) {
        store.advance(definition.id, planned, next, now)
        this.publish()
        continue
      }
      const { run, message } = this.proposal(definition, planned, null)
      let workspace: Workspace | undefined
      if (!store.activeRuns().some(active => active.automationId === definition.id)) {
        try { workspace = await this.verifySpec(definition.spec) } catch (resourceFailure: unknown) {
          this.ctx.logger.warn('automation resource preflight failed: %s', String(resourceFailure))
        }
      }
      if (!this.available()) return
      const checkedAt = Date.now()
      if (store.get(definition.id)?.revision !== definition.revision) continue
      if (checkedAt - planned >= this.config.maxStartLatenessMs) {
        store.advance(definition.id, planned, this.next(definition.spec.schedule, checkedAt), checkedAt)
        this.publish()
        continue
      }
      try {
        const receipt = store.claim(run, definition.revision, next)
        this.publish()
        if (receipt.status === 'skipped-overlap') continue
        if (workspace === undefined) {
          store.changeRun(run.id, { status: 'failed', reason: 'resource-unavailable', updatedAt: Date.now(), finishedAt: Date.now() }, true)
          this.publish()
        } else this.launch(receipt, message, workspace)
      } catch (error: unknown) {
        if (error instanceof AutomationError && error.code === 'conflict') continue
        throw error
      }
    }
  }

  private arm(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.closing || this.current.status !== 'ready' || this.tick !== undefined) return
    const next = this.current.definitions.flatMap(item => item.enabled && item.nextPlannedAt !== null ? [item.nextPlannedAt] : [])
    const delay = Math.min(this.config.clockCheckIntervalMs, Math.max(0, Math.min(...next) - Date.now()), 2_147_483_647)
    this.timer = setTimeout(() => {
      this.tick = this.ctx.agents.withoutInitiator(() => this.checkDue())
        .catch((error: unknown) => { this.failStorage(error) }).finally(() => { this.tick = undefined; this.arm() })
    }, delay)
    this.timer.unref()
  }

  private next(schedule: AutomationSchedule, after: number): number {
    const next = nextOccurrences(schedule, after, 1)[0]
    if (next === undefined || next <= after) throw new AutomationError('invalid', 'UTC recurrence did not advance.')
    return next
  }

  private async recover(): Promise<void> {
    if (this.store === undefined) return
    for (const run of this.store.activeRuns()) {
      let outcome: TurnEndReason | undefined
      if (run.sessionId !== null) {
        try { outcome = runOutcome(run, (await readColdSessionLog(this.ctx.sessionPersistence,
          run.sessionId)).events) } catch (error: unknown) {
          if (!(error instanceof SessionPersistenceNotFoundError)) throw error
        }
      }
      const status = outcome === undefined ? run.status === 'starting' ? 'ambiguous' : 'interrupted' : outcomeStatus(outcome)
      const now = Date.now()
      this.store.changeRun(run.id, { status, reason: outcome?.kind ?? 'owner-interrupted',
        updatedAt: now, finishedAt: now }, status === 'ambiguous' || status === 'interrupted')
    }
  }

  private commit<T>(operation: () => T): T {
    try {
      const result = operation()
      this.publish()
      return result
    } catch (error: unknown) {
      if (error instanceof AutomationError && error.code !== 'storage') throw error
      this.failStorage(error)
      throw error instanceof AutomationError ? error
        : new AutomationError('storage', 'Automation state could not be confirmed.', { cause: error })
    }
  }

  private parse<T>(parse: () => T): T {
    try { return parse() } catch (error: unknown) { throw new AutomationError('invalid',
      'Automation fields are invalid.', { cause: error }) }
  }

  private isClosing(): boolean { return this.closing }

  private available(): boolean { return !this.closing && this.current.status === 'ready' }

  private requireStore(): AutomationStore {
    if (this.closing || this.current.status !== 'ready' || this.store === undefined) throw new AutomationError('unavailable',
      'Automation scheduling is unavailable on this Host.')
    return this.store
  }

  private readSnapshot(): AutomationSnapshot {
    if (this.store === undefined) throw new Error('automation store is not initialized')
    return { status: 'ready', profile: this.config.profile, revision: this.store.revision,
      definitions: this.store.definitions(), activeRuns: this.store.activeRuns() }
  }

  private publish(): void {
    if (!this.closing && this.current.status === 'ready') this.current = this.readSnapshot()
    for (const listener of this.listeners) {
      try { listener(this.current) } catch (error: unknown) { this.ctx.logger.warn('automation observer failed: %s', String(error)) }
    }
  }

  private failStorage(error: unknown): void {
    this.current = { status: 'unavailable', profile: this.config.profile, reason: 'storage' }
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const { operation } of this.executions.values()) operation.cancel('disposed')
    this.ctx.logger.error('automation stopped after a local failure: %s', error instanceof Error ? error.message : String(error))
    this.publish()
  }

  private async disposeRuntime(): Promise<void> {
    this.closing = true
    this.current = { status: 'unavailable', profile: this.config.profile, reason: 'closing' }
    if (this.timer !== undefined) clearTimeout(this.timer)
    for (const { operation } of this.executions.values()) operation.cancel('disposed')
    await this.initialization
    await this.tick
    await Promise.allSettled([...this.executions.values()].map(item => item.done))
    try { this.store?.close() } finally { this.ownership?.close() }
    this.listeners.clear()
  }
}

export default AutomationRuntime
