/** Session-log implementation of the durable finding Service Definition. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ArtifactAuthorization, ArtifactRef } from '@deepseek-ai/dsh-artifact'
import {
  FindingCursor,
  FindingError,
  FindingService,
  buildFindingRecordChange,
  buildFindingTransitionChange,
  canonicalJson,
  foldFindings,
  resolveFindingRecord,
  resolveFindingTransition,
} from '@deepseek-ai/dsh-finding'
import type {
  FindingChange,
  FindingOperationOptions,
  FindingProvenance,
  FindingQueryPage,
  FindingQueryRequest,
  FindingRecordRequest,
  FindingRef,
  FindingSnapshot,
  FindingTransitionRequest,
} from '@deepseek-ai/dsh-finding'
import type { Session } from '@deepseek-ai/dsh-session'

const CONFIG_KEYS = new Set([
  'maxFindingsPerSession',
  'maxTargetsPerFinding',
  'maxLocationsPerFinding',
  'maxEvidencePerFinding',
  'maxAssumptionsPerFinding',
  'maxTextBytesPerFinding',
  'defaultQueryPageSize',
  'maxQueryPageSize',
])

/** Deployment limits for one same-session finding authority. */
export interface Config {
  /** Maximum retained findings in one Session log. */
  readonly maxFindingsPerSession?: number
  /** Maximum targets retained by one finding. */
  readonly maxTargetsPerFinding?: number
  /** Maximum code or dependency locations retained by one finding. */
  readonly maxLocationsPerFinding?: number
  /** Maximum Artifact-backed evidence records retained by one finding. */
  readonly maxEvidencePerFinding?: number
  /** Maximum explicit assumptions retained by one finding. */
  readonly maxAssumptionsPerFinding?: number
  /** Maximum UTF-8 bytes of the complete serialized snapshot. */
  readonly maxTextBytesPerFinding?: number
  /** Default number of findings returned by one query page. */
  readonly defaultQueryPageSize?: number
  /** Maximum number of findings accepted for one query page. */
  readonly maxQueryPageSize?: number
}

interface ResolvedConfig {
  readonly maxFindingsPerSession: number
  readonly maxTargetsPerFinding: number
  readonly maxLocationsPerFinding: number
  readonly maxEvidencePerFinding: number
  readonly maxAssumptionsPerFinding: number
  readonly maxTextBytesPerFinding: number
  readonly defaultQueryPageSize: number
  readonly maxQueryPageSize: number
}

interface ResolvedQuery {
  readonly ids?: ReadonlySet<string>
  readonly states?: ReadonlySet<string>
  readonly severities?: ReadonlySet<string>
  readonly ruleIds?: ReadonlySet<string>
  readonly targetIds?: ReadonlySet<string>
  readonly cursor?: string
  readonly limit: number
}

const DEFAULT_CONFIG: ResolvedConfig = {
  maxFindingsPerSession: 2_000,
  maxTargetsPerFinding: 32,
  maxLocationsPerFinding: 64,
  maxEvidencePerFinding: 64,
  maxAssumptionsPerFinding: 32,
  maxTextBytesPerFinding: 65_536,
  defaultQueryPageSize: 50,
  maxQueryPageSize: 200,
}

/** Schemastery configuration for explicit deployment bounds. */
export const Config: z<Config> = z.object({
  maxFindingsPerSession: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxFindingsPerSession),
  maxTargetsPerFinding: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxTargetsPerFinding),
  maxLocationsPerFinding: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxLocationsPerFinding),
  maxEvidencePerFinding: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxEvidencePerFinding),
  maxAssumptionsPerFinding: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxAssumptionsPerFinding),
  maxTextBytesPerFinding: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxTextBytesPerFinding),
  defaultQueryPageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.defaultQueryPageSize),
  maxQueryPageSize: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_CONFIG.maxQueryPageSize),
})

/** Resolve defaults and reject direct-construction misconfiguration. */
function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`finding-session: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = Object.assign({}, DEFAULT_CONFIG, config)
  for (const [key, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`finding-session: ${key} must be a positive safe integer`)
    }
  }
  if (resolved.defaultQueryPageSize > resolved.maxQueryPageSize) {
    throw new TypeError('finding-session: defaultQueryPageSize cannot exceed maxQueryPageSize')
  }
  return resolved
}

/** Compare immutable Artifact metadata without relying on object key order. */
function sameArtifact(left: ArtifactRef, right: ArtifactRef): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

/** Reconstruct every authorization field currently present in public provenance. */
function authorizationFrom(ref: ArtifactRef): ArtifactAuthorization {
  const provenance = ref.provenance
  return {
    ...provenance.sessionId === undefined ? {} : { sessionId: provenance.sessionId },
    ...provenance.taskId === undefined ? {} : { taskId: provenance.taskId },
    ...provenance.engagementId === undefined ? {} : { engagementId: provenance.engagementId },
    ...provenance.scopeRef === undefined ? {} : { scopeRef: provenance.scopeRef },
  }
}

/** Same-session Provider with no database or process-local authoritative state. */
export class SessionFindingService extends FindingService {
  static inject = ['agents', 'sessions', 'artifacts']
  static Config = Config

  private readonly config: ResolvedConfig
  private readonly queues = new WeakMap<Session, Promise<void>>()

  /** @param ctx - Owning Cordis context. @param config - Deployment limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.config = resolveConfig(config)
  }

  /** Record one new identity or duplicate occurrence and flush it durably. */
  async record(
    agent: Agent,
    request: FindingRecordRequest,
    source: FindingProvenance,
    options: FindingOperationOptions = {},
  ): Promise<FindingSnapshot> {
    return this.exclusive(agent.session, async () => {
      this.assertLive(agent)
      options.signal?.throwIfAborted()
      const current = this.current(agent.session)
      const record = resolveFindingRecord(request)
      this.assertRequestBounds(record)
      const existing = current.get(record.id)
      if (existing === undefined && current.size >= this.config.maxFindingsPerSession) {
        throw new FindingError('maximum findings per Session reached', 'FINDING_LIMIT_EXCEEDED')
      }
      await this.validateArtifacts(record.evidence, record.reachability, options.signal)
      const change = buildFindingRecordChange(existing, record, source, Date.now())
      this.assertSnapshotBounds(change.finding)
      return this.commit(agent.session, change)
    })
  }

  /** Apply one exact lifecycle transition and flush it durably. */
  async transition(
    agent: Agent,
    ref: FindingRef,
    request: FindingTransitionRequest,
    source: FindingProvenance,
    options: FindingOperationOptions = {},
  ): Promise<FindingSnapshot> {
    return this.exclusive(agent.session, async () => {
      this.assertLive(agent)
      options.signal?.throwIfAborted()
      const current = this.current(agent.session).get(ref.id)
      if (current === undefined) throw new FindingError(`finding ${JSON.stringify(ref.id)} was not found`, 'FINDING_NOT_FOUND')
      if (current.revision !== ref.revision) {
        throw new FindingError(
          `stale finding revision ${ref.revision}; current revision is ${current.revision}`,
          'FINDING_STALE_REVISION',
        )
      }
      const transition = resolveFindingTransition(request)
      if (transition.evidence.length > this.config.maxEvidencePerFinding) {
        throw new FindingError('transition evidence exceeds the configured limit', 'FINDING_LIMIT_EXCEEDED')
      }
      await this.validateArtifacts(transition.evidence, undefined, options.signal)
      const change = buildFindingTransitionChange(current, transition, source, Date.now())
      this.assertSnapshotBounds(change.finding)
      return this.commit(agent.session, change)
    })
  }

  /** Query one deterministic page rebuilt from the authoritative Session log. */
  async query(
    agent: Agent,
    request: FindingQueryRequest,
    options: FindingOperationOptions = {},
  ): Promise<FindingQueryPage> {
    return this.exclusive(agent.session, () => {
      this.assertLive(agent)
      options.signal?.throwIfAborted()
      const query = this.resolveQuery(request)
      const current = this.current(agent.session)
      const matches = [...current.values()]
        .filter(finding => this.matches(finding, query))
        .filter(finding => query.cursor === undefined || finding.id > query.cursor)
      const items = matches.slice(0, query.limit)
      const last = items.at(-1)
      return {
        items,
        ...last === undefined || matches.length <= query.limit
          ? {}
          : { nextCursor: FindingCursor(last.id) },
      }
    })
  }

  /** Serialize reads and writes that address the same live Session. */
  private exclusive<T>(session: Session, operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(session) ?? Promise.resolve()
    const run = previous.then(operation)
    const settled = run.then(() => undefined, () => undefined)
    this.queues.set(session, settled)
    return run.finally(() => {
      if (this.queues.get(session) === settled) this.queues.delete(session)
    })
  }

  /** Reject a structurally matching but non-live Agent object. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new FindingError(`agent ${JSON.stringify(agent.id)} is not live`, 'FINDING_AGENT_NOT_LIVE')
    }
  }

  /** Rebuild the complete current map from the Session log. */
  private current(session: Session): Map<FindingSnapshot['id'], FindingSnapshot> {
    try {
      return new Map(foldFindings(session.snapshotEvents()).map(finding => [finding.id, finding]))
    } catch (cause) {
      throw new FindingError('the Session finding log is invalid', 'FINDING_LOG_INVALID', { cause })
    }
  }

  /** Validate request-level collection limits before Artifact I/O. */
  private assertRequestBounds(record: Pick<FindingSnapshot, 'targets' | 'locations' | 'evidence' | 'assumptions'>): void {
    const bounds: readonly [string, number, number][] = [
      ['targets', record.targets.length, this.config.maxTargetsPerFinding],
      ['locations', record.locations.length, this.config.maxLocationsPerFinding],
      ['evidence', record.evidence.length, this.config.maxEvidencePerFinding],
      ['assumptions', record.assumptions.length, this.config.maxAssumptionsPerFinding],
    ]
    const exceeded = bounds.find(([, count, limit]) => count > limit)
    if (exceeded !== undefined) {
      throw new FindingError(`${exceeded[0]} exceed the configured limit ${exceeded[2]}`, 'FINDING_LIMIT_EXCEEDED')
    }
  }

  /** Apply collection and complete serialized-byte bounds to the retained value. */
  private assertSnapshotBounds(snapshot: FindingSnapshot): void {
    this.assertRequestBounds(snapshot)
    const bytes = Buffer.byteLength(canonicalJson(snapshot), 'utf8')
    if (bytes > this.config.maxTextBytesPerFinding) {
      throw new FindingError(
        `complete finding snapshot is ${bytes} bytes; limit is ${this.config.maxTextBytesPerFinding}`,
        'FINDING_LIMIT_EXCEEDED',
      )
    }
  }

  /** Verify every newly supplied ArtifactRef through the public Artifact Service. */
  private async validateArtifacts(
    evidence: readonly { readonly artifact: ArtifactRef }[],
    reachability: FindingSnapshot['reachability'] | undefined,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const refs = [
      ...evidence.map(item => item.artifact),
      ...reachability?.kind === 'reachable' && reachability.pathEvidence !== undefined
        ? [reachability.pathEvidence]
        : [],
    ]
    const unique = new Map<string, ArtifactRef>()
    for (const ref of refs) {
      const current = unique.get(ref.artifactId)
      if (current !== undefined && !sameArtifact(current, ref)) {
        throw new FindingError(
          `artifact ${JSON.stringify(ref.artifactId)} has conflicting references`,
          'FINDING_ARTIFACT_MISMATCH',
        )
      }
      unique.set(ref.artifactId, ref)
    }
    for (const ref of unique.values()) {
      signal?.throwIfAborted()
      let canonical: ArtifactRef
      try {
        canonical = await this.ctx.artifacts.describe({
          artifactId: ref.artifactId,
          authorization: authorizationFrom(ref),
        })
      } catch (cause) {
        throw new FindingError(
          `artifact ${JSON.stringify(ref.artifactId)} cannot be verified from public provenance`,
          'FINDING_ARTIFACT_UNVERIFIED',
          { cause },
        )
      }
      if (!sameArtifact(canonical, ref)) {
        throw new FindingError(
          `artifact ${JSON.stringify(ref.artifactId)} metadata does not match its canonical reference`,
          'FINDING_ARTIFACT_MISMATCH',
        )
      }
      signal?.throwIfAborted()
    }
  }

  /** Resolve query defaults and validate complete filter arrays. */
  private resolveQuery(request: FindingQueryRequest): ResolvedQuery {
    const limit = request.limit ?? this.config.defaultQueryPageSize
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > this.config.maxQueryPageSize) {
      throw new FindingError(
        `query limit must be between 1 and ${this.config.maxQueryPageSize}`,
        'FINDING_LIMIT_EXCEEDED',
      )
    }
    const arrays = [request.ids, request.states, request.severities, request.ruleIds, request.targetIds]
    if (arrays.some(values => values !== undefined && values.length > this.config.maxFindingsPerSession)) {
      throw new FindingError('query filter array exceeds the configured Session limit', 'FINDING_LIMIT_EXCEEDED')
    }
    const cursor = request.cursor
    if (cursor !== undefined && !/^finding-[0-9a-f]{64}$/.test(cursor)) {
      throw new FindingError('query cursor is invalid', 'FINDING_CURSOR_INVALID')
    }
    return {
      ...request.ids === undefined ? {} : { ids: new Set(request.ids) },
      ...request.states === undefined ? {} : { states: new Set(request.states) },
      ...request.severities === undefined ? {} : { severities: new Set(request.severities) },
      ...request.ruleIds === undefined ? {} : { ruleIds: new Set(request.ruleIds) },
      ...request.targetIds === undefined ? {} : { targetIds: new Set(request.targetIds) },
      ...cursor === undefined ? {} : { cursor },
      limit,
    }
  }

  /** Apply all resolved query filters to one snapshot. */
  private matches(finding: FindingSnapshot, query: ResolvedQuery): boolean {
    const targetIds = query.targetIds
    return (query.ids === undefined || query.ids.has(finding.id))
      && (query.states === undefined || query.states.has(finding.state))
      && (query.severities === undefined || query.severities.has(finding.severity))
      && (query.ruleIds === undefined || query.ruleIds.has(finding.ruleId))
      && (targetIds === undefined || finding.identity.targetIds.some(id => targetIds.has(id)))
  }

  /** Append one accepted change and wait for every durability listener. */
  private async commit(session: Session, change: FindingChange): Promise<FindingSnapshot> {
    const event = session.append('finding/change', change)
    const committedRef = { id: event.data.finding.id, revision: event.data.finding.revision }
    try {
      const participated = await this.ctx.sessions.flush(session)
      if (!participated) throw new Error('no session/flush durability listener participated')
    } catch (cause) {
      throw new FindingError(
        `finding ${JSON.stringify(committedRef.id)} revision ${committedRef.revision} committed in memory; durable persistence is uncertain`,
        'FINDING_PERSISTENCE_UNCERTAIN',
        { cause, committedRef },
      )
    }
    return event.data.finding
  }
}

export default SessionFindingService
