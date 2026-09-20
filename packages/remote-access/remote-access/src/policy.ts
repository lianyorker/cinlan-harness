/** Paired-device allowlist for existing Session operations and scoped Remote events. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TypertGatewayAccessPolicy, TypertRemoteEventFrame, TypertRemoteEventInvocation } from '@deepseek-ai/dsh-api-gateway'
import type { PairingGrant, PairingScope } from './types.ts'

const projectionKeys = new Set(['sessionListMetadata', 'imageLimits', 'modelSelection', 'title'])
const notifications = new Set(['api-session/added', 'api-session/removed', 'api-session/status', 'api-session/activity', 'api-session/error'])

/** Device policy tied to one immutable grant revision. */
export class PairedSessionPolicy implements TypertGatewayAccessPolicy {
  private readonly sessions: ReadonlySet<string>
  private readonly scopes: ReadonlySet<PairingScope>

  /** @param grant - validated grant committed by the local Desktop pairing owner. */
  constructor(grant: PairingGrant, readonly maxQueuedEvents: number, readonly maxQueuedEventBytes: number) {
    this.sessions = new Set(grant.sessionIds)
    this.scopes = new Set(grant.scopes)
  }

  authorizeInvocation(endpoint: string, payload: unknown): void {
    this.require('session:read')
    const envelope = object(payload)
    exact(envelope, ['args'])
    const args = object(envelope.args)
    if (endpoint === '$events') { empty(args); return }
    if (endpoint === '$events/result') {
      if (!this.scopes.has('questions:answer') && !this.scopes.has('approvals:decide')) denied()
      return
    }
    if (endpoint === 'session/list') { exact(args, ['_request']); empty(object(args._request)); return }
    if (endpoint === 'session/control') { empty(args); return }
    exact(args, ['request'])
    const request = object(args.request)
    if (endpoint === 'session/follow' || endpoint === 'session/page') {
      fields(request, endpoint === 'session/follow' ? ['address', 'maxMessages', 'assistantStream'] : ['address', 'throughSeq', 'beforeSeq', 'maxMessages'])
      const address = object(request.address)
      exact(address, ['kind', 'sessionId'])
      if (address.kind !== 'session') denied()
      this.session(address.sessionId)
      return
    }
    if (endpoint === 'session/prompt') {
      fields(request, ['requestId', 'sessionId', 'mode', 'content', 'clientTimeZone'])
      if (typeof request.requestId !== 'string' || request.requestId.length === 0 || (request.mode !== 'queue' && request.mode !== 'steer')) denied()
      this.require('session:send'); this.session(request.sessionId)
      if (!Array.isArray(request.content) || request.content.length === 0 || request.content.some((part) => {
        const entry = object(part)
        return entry.type !== 'text' || typeof entry.text !== 'string' || Object.keys(entry).some(key => key !== 'type' && key !== 'text')
      })) denied()
      return
    }
    if (endpoint === 'session/cancel') { exact(request, ['sessionId']); this.require('session:stop'); this.session(request.sessionId); return }
    denied()
  }

  projectResult(endpoint: string, _payload: unknown, value: unknown): unknown {
    if (endpoint !== 'session/list') return value
    const result = object(value)
    if (!Array.isArray(result.items)) denied()
    return { items: result.items.filter(item => this.hasSession(object(item).sessionId)).map(item => this.summary(object(item))) }
  }

  projectStreamItem(endpoint: string, _payload: unknown, value: unknown): unknown {
    const frame = object(value)
    if (endpoint === '$events') {
      if (frame.type === 'ready') return { ...frame, host: { home: '' } }
      if (frame.type === 'emit' && frame.event === 'api-session/added') {
        const args = frame.args as unknown[]
        return { ...frame, args: [this.summary(object(args[0]))] }
      }
      return value
    }
    if (endpoint === 'session/follow' && frame.type === 'snapshot') return { ...frame, projections: projectValues(frame.projections) }
    if (endpoint !== 'session/control') return value
    if (frame.type === 'baseline') {
      const baseline = object(frame.value)
      return { type: 'baseline', value: {
        queues: this.mapSessions(baseline.queues), jobs: this.mapSessions(baseline.jobs),
        projections: Object.fromEntries(Object.entries(this.mapSessions(baseline.projections))
          .map(([id, projection]) => [id, projectValues(projection)])),
      } }
    }
    if (!this.hasSession(frame.sessionId)) return undefined
    if (frame.type === 'projection' && !projectionKeys.has(String(frame.key))) return undefined
    return frame
  }

  permitsEvent(event: TypertRemoteEventFrame | TypertRemoteEventInvocation): boolean {
    if ('context' in event) {
      const scope = event.event === 'approval/request' ? 'approvals:decide' : event.event === 'user-questions/request' ? 'questions:answer' : undefined
      if (scope === undefined || !this.scopes.has(scope)) return false
      // Gateway receives the original Agent object from the scoped Host event owner.
      const agent = event.context.subject as Agent
      return this.hasSession(agent.session.id)
    }
    if (!notifications.has(event.event)) return false
    return this.hasSession(event.event === 'api-session/added' ? object(event.args[0]).sessionId : event.args[0])
  }

  private require(scope: PairingScope): void { if (!this.scopes.has(scope)) denied() }
  private hasSession(value: unknown): value is string { return typeof value === 'string' && this.sessions.has(value) }
  private session(value: unknown): void { if (!this.hasSession(value)) denied() }
  private mapSessions(value: unknown): Record<string, unknown> {
    return Object.fromEntries(Object.entries(object(value)).filter(([id]) => this.sessions.has(id)))
  }
  private summary(value: Record<string, unknown>): Record<string, unknown> {
    const result = { ...value }
    if (result.parentSessionId !== undefined && !this.hasSession(result.parentSessionId)) delete result.parentSessionId
    if (result.projections !== undefined) result.projections = projectValues(result.projections)
    return result
  }
}

function projectValues(value: unknown): unknown {
  const projection = object(value)
  return { ...projection, values: Object.fromEntries(Object.entries(object(projection.values)).filter(([key]) => projectionKeys.has(key))) }
}
function denied(): never { throw new Error('Paired device operation is not authorized') }
function object(value: unknown): Record<string, unknown> { if (value === null || typeof value !== 'object' || Array.isArray(value)) denied(); return value as Record<string, unknown> }
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) denied()
}
function empty(value: Record<string, unknown>): void { exact(value, []) }
function fields(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) denied()
}
