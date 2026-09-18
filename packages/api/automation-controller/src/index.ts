/** Automation Host Remote namespace; storage and execution remain runtime-owned. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-automation'
import { automationCatalog } from './catalog.ts'
import { automationFailure, automationOperation } from './errors.ts'
import { AutomationFeed } from './feed.ts'
import type {
  AutomationCancelRequest, AutomationCatalog, AutomationDefinition, AutomationDelete, AutomationDraft,
  AutomationFollowFrame, AutomationPreviewRequest, AutomationRun, AutomationRunPage, AutomationRunRequest,
  AutomationRunsRequest, AutomationSnapshot, AutomationUpdate,
} from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host automation commands and committed-state transport. */
    automationController: AutomationController
  }
}

/** Generated Remote owner for the automation namespace. */
export class AutomationController extends TypertRemoteService {
  static inject = ['typert', 'automationRuntime', 'workspaceRegistry', 'agentPresets', 'agentDefaultModel', 'llm', 'permissionPresets']
  private readonly feed: AutomationFeed

  /** @param ctx - Host dependencies from the same launch profile. */
  constructor(ctx: Context) {
    super(ctx, 'automationController', { namespace: 'automation' })
    this.feed = new AutomationFeed(ctx)
  }

  /** Read the committed runtime view.
   * @returns the full state, including explicit unavailability.
   */
  @Remote('snapshot')
  snapshot(): AutomationSnapshot {
    try { return this.ctx.automationRuntime.snapshot() } catch (error) { throw automationFailure(error) }
  }


  /** Create a disabled plan.
   * @param draft - explicit draft inputs.
   * @returns the committed disabled definition.
   */
  @Remote('create')
  create(draft: AutomationDraft): Promise<AutomationDefinition> {
    return automationOperation(() => this.ctx.automationRuntime.create(draft))
  }

  /** Save a complete revision-fenced replacement.
   * @param update - replacement fenced by the first-edit revision.
   * @returns the committed definition.
   */
  @Remote('update')
  update(update: AutomationUpdate): Promise<AutomationDefinition> {
    return automationOperation(() => this.ctx.automationRuntime.update(update))
  }

  /** Delete a plan while retaining its journal.
   * @param request - target and expected revision; active invocations refuse deletion.
   */
  @Remote('delete')
  delete(request: AutomationDelete): Promise<void> {
    return automationOperation(() => this.ctx.automationRuntime.delete(request))
  }

  /** Admit one explicit manual invocation.
   * @param request - target revision and retained idempotency token.
   * @returns the admitted invocation.
   */
  @Remote('run')
  run(request: AutomationRunRequest): Promise<AutomationRun> {
    return automationOperation(() => this.ctx.automationRuntime.run(request))
  }

  /** Cancel an invocation without changing recurrence.
   * @param request - admitted invocation to cancel.
   */
  @Remote('cancel')
  cancel(request: AutomationCancelRequest): Promise<void> {
    return automationOperation(() => this.ctx.automationRuntime.cancel(request.runId))
  }

  /** Read a bounded journal page.
   * @param request - bounded journal cursor.
   * @returns newest-first committed receipts.
   */
  @Remote('runs')
  runs(request: AutomationRunsRequest): Promise<AutomationRunPage> {
    return automationOperation(() => this.ctx.automationRuntime.runs(request.id, request.cursor, request.limit))
  }

  /** Preview a UTC schedule without saving it.
   * @param request - UTC schedule and exclusive lower bound.
   * @returns five future UTC timestamps.
   */
  @Remote('previewSchedule')
  previewSchedule(request: AutomationPreviewRequest): Promise<number[]> {
    return automationOperation(() => this.ctx.automationRuntime.previewSchedule(request.schedule, request.afterUtc))
  }

  /** Read the current Host selector catalog.
   * @returns actual selector metadata; model membership is advisory.
   */
  @Remote('catalog')
  catalog(): Promise<AutomationCatalog> {
    return automationOperation(() => automationCatalog(this.ctx))
  }

  /** Follow full committed state for one carrier generation.
   * @param signal - carrier cancellation.
   * @returns full committed snapshots with bounded coalescing.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<AutomationFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default AutomationController
