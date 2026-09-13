/** Provider-neutral durable finding Service Definition (`ctx.findings`). */

import { Context, Service } from '@deepseek-ai/cordis'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { canTransitionFinding, decodeFindingChange } from './fold.ts'
import type {
  FindingChange,
  FindingOperationOptions,
  FindingProjection,
  FindingProvenance,
  FindingQueryPage,
  FindingQueryRequest,
  FindingRecordRequest,
  FindingRef,
  FindingSnapshot,
  FindingState,
  FindingSummary,
  FindingTransitionRequest,
  FindingTransitionState,
} from './types.ts'

export type * from './types.ts'
export {
  FINDING_CHANGE_VERSION,
  FINDING_STATES,
  FindingCursor,
  FindingError,
  FindingFingerprint,
  FindingId,
  FindingRuleId,
  FindingTargetId,
} from './runtime.ts'
export {
  applyFindingChange,
  applyFindingEvent,
  assertCanonicalFindingSnapshot,
  buildFindingRecordChange,
  buildFindingTransitionChange,
  canTransitionFinding,
  canonicalFindingIdentity,
  canonicalJson,
  cloneFindingFoldState,
  decodeFindingChange,
  emptyFindingFoldState,
  findingIdFromFingerprint,
  fingerprintFindingIdentity,
  foldFindings,
  resolveFindingProvenance,
  resolveFindingRecord,
  resolveFindingTransition,
} from './fold.ts'
export type { FindingFoldState, ResolvedFindingRecord, ResolvedFindingTransition } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    findings: FindingService
  }
}

const summarySchema = zod.object({
  id: zod.string().min(1),
  revision: zod.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ruleId: zod.string().min(1),
  title: zod.string().min(1),
  state: zod.enum(['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved']),
  severity: zod.enum(['informational', 'low', 'medium', 'high', 'critical']),
  confidence: zod.enum(['low', 'medium', 'high']),
  targetIds: zod.array(zod.string().min(1)),
  evidenceCount: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  occurrences: zod.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  updatedAt: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict()

/** Persisted-cache schema for the compact findings projection. */
export const findingProjectionSchema: ZodType<FindingProjection> = zod.object({
  total: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  byState: zod.object({
    observation: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    hypothesis: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    'reproduced-vulnerability': zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    remediation: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    unresolved: zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  items: zod.array(summarySchema),
}).strict() as unknown as ZodType<FindingProjection>

/**
 * Return a fresh empty projection value.
 * @returns Compact projection with zero findings.
 */
export function emptyFindingProjection(): FindingProjection {
  return {
    total: 0,
    byState: {
      observation: 0,
      hypothesis: 0,
      'reproduced-vulnerability': 0,
      remediation: 0,
      unresolved: 0,
    },
    items: [],
  }
}

/** Convert one full snapshot to the compact projection item. */
function findingSummary(finding: FindingSnapshot): FindingSummary {
  return {
    id: finding.id,
    revision: finding.revision,
    ruleId: finding.ruleId,
    title: finding.title,
    state: finding.state,
    severity: finding.severity,
    confidence: finding.confidence,
    targetIds: finding.identity.targetIds,
    evidenceCount: finding.evidence.length,
    occurrences: finding.occurrences,
    updatedAt: finding.updatedAt,
  }
}

/** Count every projected state after one upsert. */
function stateCounts(items: readonly FindingSummary[]): Readonly<Record<FindingState, number>> {
  const counts = emptyFindingProjection().byState as Record<FindingState, number>
  for (const item of items) counts[item.state] += 1
  return counts
}

/** Validate the relationship visible from compact current state. */
function validProjectionEdge(current: FindingSummary | undefined, event: FindingChange): boolean {
  if (current === undefined) {
    return event.operation === 'record' && event.previous === null
      && event.finding.revision === 1 && event.finding.occurrences === 1
  }
  if (event.previous === null || event.previous.id !== current.id || event.previous.revision !== current.revision
    || event.finding.revision !== current.revision + 1) return false
  if (event.operation === 'record') {
    return event.finding.state === current.state && event.finding.occurrences === current.occurrences + 1
  }
  return event.finding.occurrences === current.occurrences
    && canTransitionFinding(current.state, event.finding.state as FindingTransitionState)
}

/**
 * Apply one committed event to the fail-soft compact projection.
 * @param state - Projection over all prior events.
 * @param event - Next committed Session event.
 * @returns A new projection, or the same reference for unrelated or invalid input.
 */
export function applyFindingProjection(state: FindingProjection, event: SessionEvent): FindingProjection {
  if (event.type !== 'finding/change') return state
  let change: ReturnType<typeof decodeFindingChange>
  try {
    change = decodeFindingChange(event.data)
  } catch (_invalidPersistedFindingChange) {
    return state
  }
  if (change === undefined) return state
  const current = state.items.find(item => item.id === change.finding.id)
  if (!validProjectionEdge(current, change)) return state
  const next = findingSummary(change.finding)
  const byId = new Map(state.items.map(item => [item.id, item]))
  byId.set(next.id, next)
  const items = [...byId.keys()].sort().map((id) => {
    const item = byId.get(id)
    /* v8 ignore next 2 -- the id comes from the same unmodified map. */
    if (item === undefined) throw new TypeError('projection item disappeared during ordering')
    return item
  })
  return { total: items.length, byState: stateCounts(items), items }
}

/**
 * Provider-neutral same-session finding authority. Providers validate evidence,
 * append complete `finding/change` snapshots, and make mutations durable before
 * resolving. Reads rebuild from the owning Session log.
 */
export abstract class FindingService extends Service {
  /** Register the optional projection unit with the Service provider's lifetime. */
  constructor(ctx: Context) {
    super(ctx, 'findings')
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register({
        key: 'findings',
        stateSchema: findingProjectionSchema,
        init: () => emptyFindingProjection(),
        apply: applyFindingProjection,
        wire: {
          viewSchema: findingProjectionSchema,
          view: state => state,
        },
        stateVersion: 1,
      })
    })
  }

  /**
   * Record a new finding or deterministic duplicate occurrence.
   * @param agent - Exact live Agent whose Session owns the finding.
   * @param request - Typed finding facts; id and fingerprint are derived.
   * @param source - Trusted same-process Consumer attribution.
   * @param options - Optional pre-commit cancellation.
   * @returns The durably flushed current snapshot.
   */
  abstract record(
    agent: Agent,
    request: FindingRecordRequest,
    source: FindingProvenance,
    options?: FindingOperationOptions,
  ): Promise<FindingSnapshot>

  /**
   * Apply one compare-and-set lifecycle transition.
   * @param agent - Exact live Agent whose Session owns the finding.
   * @param ref - Expected current finding revision.
   * @param request - Target state and evidence added by this transition.
   * @param source - Trusted same-process Consumer attribution.
   * @param options - Optional pre-commit cancellation.
   * @returns The durably flushed current snapshot.
   */
  abstract transition(
    agent: Agent,
    ref: FindingRef,
    request: FindingTransitionRequest,
    source: FindingProvenance,
    options?: FindingOperationOptions,
  ): Promise<FindingSnapshot>

  /**
   * Query one deterministic page from the authoritative Session log.
   * @param agent - Exact live Agent whose Session owns the findings.
   * @param request - Optional filters, cursor, and page limit.
   * @param options - Optional cancellation while waiting behind a mutation.
   * @returns Complete snapshots ordered by FindingId.
   */
  abstract query(
    agent: Agent,
    request: FindingQueryRequest,
    options?: FindingOperationOptions,
  ): Promise<FindingQueryPage>
}

export default FindingService
