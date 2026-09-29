/**
 * Host-side TaskSurfaceService implementation coordinating active queries, submissions, and dismissals.
 * @module @deepseek-ai/dsh-task-surface/service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { formatSubmissionMessage, validateSubmission } from './model.ts'
import { taskSurfaceProjectionDefinition } from './projection.ts'
import type {
  DismissTaskSurfaceRequest,
  DismissTaskSurfaceResult,
  GetActiveTaskSurfaceResult,
  SubmitTaskSurfaceRequest,
  SubmitTaskSurfaceResult,
  TaskSurfaceId,
  TaskSurfacePendingSubmission,
  TaskSurfacePresentationMeta,
  TaskSurfaceService,
  TaskSurfaceUserMessageSource,
} from './types.ts'

/**
 * Service managing Task Surface interactions, submission transactional handoff, and dismissal.
 */
export class TaskSurfaceServiceImpl extends Service implements TaskSurfaceService {
  static inject = ['sessionProjections', 'sessions']

  private readonly pendingSubmissions = new Map<string, TaskSurfacePendingSubmission>()
  private readonly submissions = new Map<string, MessageId>()
  private readonly dismissals = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'taskSurface')

    ctx.sessionProjections.register(taskSurfaceProjectionDefinition)

    ctx.on('session/event', (session: Session, event) => {
      if (event.type === 'user/message' || event.type === 'task-surface/dismissed') {
        const prefix = `${session.id}:`
        for (const key of this.pendingSubmissions.keys()) {
          if (key.startsWith(prefix)) {
            this.pendingSubmissions.delete(key)
          }
        }
      }
    })
  }

  private resolveSession(sessionId: SessionId): Session | undefined {
    return this.ctx.sessions.get(sessionId)
  }

  getActive(input: { readonly sessionId: SessionId; readonly surfaceId?: TaskSurfaceId }): Promise<GetActiveTaskSurfaceResult> {
    const session = this.resolveSession(input.sessionId)
    if (session === undefined) {
      return Promise.resolve({ active: false, reason: 'not-open' })
    }

    const projection = this.ctx.sessionProjections.stateOf(session, 'taskSurface')
    if (!projection || projection.active === null) {
      return Promise.resolve({ active: false, reason: 'not-open' })
    }

    if (input.surfaceId !== undefined && projection.active.surfaceId !== input.surfaceId) {
      return Promise.resolve({ active: false, reason: 'not-open' })
    }

    const events = session.snapshotEvents()
    const targetSurfaceId = projection.active.surfaceId

    let foundMeta: TaskSurfacePresentationMeta | undefined
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev !== undefined && ev.type === 'tool/result') {
        const meta = ev.data.meta as Record<string, unknown> | undefined
        if (
          meta !== undefined &&
          typeof meta === 'object' &&
          meta['kind'] === 'dsh/task-surface' &&
          meta['surfaceId'] === targetSurfaceId
        ) {
          foundMeta = meta as unknown as TaskSurfacePresentationMeta
          break
        }
      }
    }

    if (foundMeta === undefined) {
      return Promise.resolve({ active: false, reason: 'not-open' })
    }

    const pendingKey = `${input.sessionId}:${targetSurfaceId}`
    const pending = this.pendingSubmissions.get(pendingKey) ?? null

    return Promise.resolve({
      active: true,
      callId: projection.active.callId,
      surfaceId: targetSurfaceId,
      model: foundMeta.model,
      pending,
    })
  }

  async submit(input: SubmitTaskSurfaceRequest): Promise<SubmitTaskSurfaceResult> {
    const session = this.resolveSession(input.sessionId)
    if (session === undefined) {
      return { accepted: false, reason: 'not-open' }
    }

    const subKey = `${input.sessionId}:${input.surfaceId}:${input.submissionId}`
    const existingMsgId = this.submissions.get(subKey)
    if (existingMsgId !== undefined) {
      return { accepted: true, messageId: existingMsgId, phase: 'queued' }
    }

    const pendingKey = `${input.sessionId}:${input.surfaceId}`
    const currentPending = this.pendingSubmissions.get(pendingKey)
    if (currentPending !== undefined && currentPending.submissionId !== input.submissionId) {
      return { accepted: false, reason: 'submission-pending' }
    }

    const activeRes = await this.getActive({ sessionId: input.sessionId, surfaceId: input.surfaceId })
    if (!activeRes.active) {
      return { accepted: false, reason: 'not-open' }
    }

    try {
      validateSubmission(activeRes.model, input.values)
    } catch {
      return { accepted: false, reason: 'invalid-submission' }
    }

    const text = formatSubmissionMessage(activeRes.model, input.values, input.note)
    const source: TaskSurfaceUserMessageSource = {
      kind: 'user',
      taskSurface: {
        version: 1,
        submissionId: input.submissionId,
        callId: activeRes.callId,
        surfaceId: input.surfaceId,
        values: input.values,
      },
    }

    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source,
    })

    const pendingRecord: TaskSurfacePendingSubmission = {
      submissionId: input.submissionId,
      messageId: message.id,
      phase: 'queued',
    }
    this.pendingSubmissions.set(pendingKey, pendingRecord)
    this.submissions.set(subKey, message.id)

    session.append('user/message', message, { surfaceOp: 'append' })

    return { accepted: true, messageId: message.id, phase: 'queued' }
  }

  async dismiss(input: DismissTaskSurfaceRequest): Promise<DismissTaskSurfaceResult> {
    const session = this.resolveSession(input.sessionId)
    if (session === undefined) {
      return { dismissed: false, reason: 'not-open' }
    }

    const pendingKey = `${input.sessionId}:${input.surfaceId}`
    if (this.pendingSubmissions.has(pendingKey)) {
      return { dismissed: false, reason: 'submission-pending' }
    }

    const disKey = `${input.sessionId}:${input.surfaceId}:${input.dismissalId}`
    const prevSeq = this.dismissals.get(disKey)
    if (prevSeq !== undefined) {
      return { dismissed: true, eventSeq: prevSeq }
    }

    const activeRes = await this.getActive({ sessionId: input.sessionId, surfaceId: input.surfaceId })
    if (!activeRes.active) {
      return { dismissed: false, reason: 'not-open' }
    }

    const ev = session.append('task-surface/dismissed', {
      surfaceId: input.surfaceId,
      dismissalId: input.dismissalId,
    })
    this.dismissals.set(disKey, ev.seq)

    return { dismissed: true, eventSeq: ev.seq }
  }
}
