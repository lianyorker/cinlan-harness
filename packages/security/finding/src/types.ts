/** Pure public types for durable security findings. @module @deepseek-ai/dsh-finding/types */

import type { ArtifactRef } from '@deepseek-ai/dsh-artifact'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one finding across revisions. */
export type FindingId = Branded<'FindingId'>

/** SHA-256 digest of one canonical finding identity. */
export type FindingFingerprint = Branded<'FindingFingerprint'>

/** Stable detector or rule identifier. */
export type FindingRuleId = Branded<'FindingRuleId'>

/** Stable identity of one affected target. */
export type FindingTargetId = Branded<'FindingTargetId'>

/** Opaque cursor for deterministic finding pagination. */
export type FindingCursor = Branded<'FindingCursor'>

/** Compare-and-set identity for one exact finding revision. */
export interface FindingRef {
  /** Stable finding identity. */
  readonly id: FindingId
  /** Positive revision incremented by every durable mutation. */
  readonly revision: number
}

/** Durable finding lifecycle states adopted by the Security R&D profile. */
export type FindingState =
  | 'observation'
  | 'hypothesis'
  | 'reproduced-vulnerability'
  | 'remediation'
  | 'unresolved'

/** States accepted by the initial record operation. */
export type FindingInitialState = Extract<FindingState, 'observation' | 'hypothesis' | 'reproduced-vulnerability'>

/** States accepted as explicit transition targets. */
export type FindingTransitionState = Exclude<FindingState, 'observation'>

/** Finding impact classification. */
export type FindingSeverity = 'informational' | 'low' | 'medium' | 'high' | 'critical'

/** Confidence in the finding's current interpretation. */
export type FindingConfidence = 'low' | 'medium' | 'high'

/** Affected target recorded independently from presentation labels. */
export interface FindingTarget {
  /** Stable target identity used by deterministic deduplication. */
  readonly id: FindingTargetId
  /** Target category used by query and export consumers. */
  readonly kind: 'host' | 'service' | 'url' | 'repository' | 'package' | 'file' | 'component' | 'other'
  /** Non-empty human-readable target label. */
  readonly displayName: string
}

/** Source-code location affected by a finding. */
export interface FindingCodeLocation {
  readonly kind: 'code'
  readonly targetId: FindingTargetId
  /** Stable URI or repository-relative path suitable for SARIF. */
  readonly uri: string
  readonly startLine?: number
  readonly startColumn?: number
  readonly endLine?: number
  readonly endColumn?: number
}

/** Dependency component affected by a finding. */
export interface FindingDependencyLocation {
  readonly kind: 'dependency'
  readonly targetId: FindingTargetId
  readonly ecosystem: string
  readonly packageName: string
  readonly version?: string
  readonly manifestUri?: string
}

/** Closed location union used by identity, query, and exporters. */
export type FindingLocation = FindingCodeLocation | FindingDependencyLocation

/** Canonical facts hashed into the deterministic fingerprint. */
export interface FindingIdentity {
  readonly ruleId: FindingRuleId
  readonly targetIds: readonly FindingTargetId[]
  readonly locations: readonly FindingLocation[]
}

/** CVSS vector retained without interpreting vendor-specific extensions. */
export interface FindingCvss {
  readonly version: '3.1' | '4.0'
  readonly vector: string
  readonly score: number
}

/** Typed reachability assessment. */
export type FindingReachability =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unreachable'; readonly reason: string }
  | {
    readonly kind: 'reachable'
    readonly entrypoint: string
    readonly pathEvidence?: ArtifactRef
  }

/** Meaning assigned to one immutable evidence artifact. */
export type FindingEvidenceRole = 'observation' | 'reproduction' | 'remediation-validation' | 'supporting'

/** Immutable Artifact reference linked to a finding. */
export interface FindingEvidence {
  readonly role: FindingEvidenceRole
  readonly artifact: ArtifactRef
  readonly note?: string
}

/** Trusted same-process Consumer attribution, never accepted from model arguments. */
export interface FindingProvenance {
  readonly pluginId: string
  readonly pluginVersion: string
  readonly toolName: string
}

/** Full durable finding state written by every mutation. */
export interface FindingSnapshot extends FindingRef {
  readonly fingerprint: FindingFingerprint
  readonly identity: FindingIdentity
  readonly ruleId: FindingRuleId
  readonly title: string
  readonly summary: string
  readonly state: FindingState
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly targets: readonly FindingTarget[]
  readonly locations: readonly FindingLocation[]
  readonly cweIds: readonly string[]
  readonly cveIds: readonly string[]
  readonly cvss?: FindingCvss
  readonly assumptions: readonly string[]
  readonly reachability: FindingReachability
  readonly evidence: readonly FindingEvidence[]
  readonly provenance: readonly FindingProvenance[]
  readonly fixGuidance?: string
  readonly occurrences: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Input for a deterministic record or duplicate occurrence. */
export interface FindingRecordRequest {
  readonly ruleId: FindingRuleId
  readonly title: string
  readonly summary: string
  readonly state: FindingInitialState
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly targets: readonly FindingTarget[]
  readonly locations: readonly FindingLocation[]
  readonly cweIds?: readonly string[]
  readonly cveIds?: readonly string[]
  readonly cvss?: FindingCvss
  readonly assumptions?: readonly string[]
  readonly reachability: FindingReachability
  readonly evidence?: readonly FindingEvidence[]
}

/** Evidence and remediation fields attached to one explicit state transition. */
export interface FindingTransitionRequest {
  readonly to: FindingTransitionState
  readonly evidence?: readonly FindingEvidence[]
  readonly fixGuidance?: string
}

/** Cancellation accepted before a finding event commits. */
export interface FindingOperationOptions {
  readonly signal?: AbortSignal
}

/** Stable filters and pagination for one same-session query. */
export interface FindingQueryRequest {
  readonly ids?: readonly FindingId[]
  readonly states?: readonly FindingState[]
  readonly severities?: readonly FindingSeverity[]
  readonly ruleIds?: readonly FindingRuleId[]
  readonly targetIds?: readonly FindingTargetId[]
  readonly cursor?: FindingCursor
  readonly limit?: number
}

/** One deterministic page of complete finding snapshots. */
export interface FindingQueryPage {
  readonly items: readonly FindingSnapshot[]
  readonly nextCursor?: FindingCursor
}

/** Compact read-side item persisted by the session-projection capability. */
export interface FindingSummary extends FindingRef {
  readonly ruleId: FindingRuleId
  readonly title: string
  readonly state: FindingState
  readonly severity: FindingSeverity
  readonly confidence: FindingConfidence
  readonly targetIds: readonly FindingTargetId[]
  readonly evidenceCount: number
  readonly occurrences: number
  readonly updatedAt: number
}

/** Complete compact projection for one Session. */
export interface FindingProjection {
  readonly total: number
  readonly byState: Readonly<Record<FindingState, number>>
  readonly items: readonly FindingSummary[]
}

/** Durable finding mutation verbs. */
export type FindingOperation = 'record' | 'transition'

/** Required-on-read full-snapshot event payload. */
export interface FindingChange {
  readonly kind: 'finding/change'
  readonly version: 1
  readonly operation: FindingOperation
  readonly previous: FindingRef | null
  readonly finding: FindingSnapshot
}

/** Stable failure codes returned by the finding capability. */
export type FindingErrorCode =
  | 'FINDING_AGENT_NOT_LIVE'
  | 'FINDING_ARTIFACT_MISMATCH'
  | 'FINDING_ARTIFACT_UNVERIFIED'
  | 'FINDING_CURSOR_INVALID'
  | 'FINDING_FINGERPRINT_COLLISION'
  | 'FINDING_INVALID_RECORD'
  | 'FINDING_INVALID_TRANSITION'
  | 'FINDING_LIMIT_EXCEEDED'
  | 'FINDING_LOG_INVALID'
  | 'FINDING_NOT_FOUND'
  | 'FINDING_PERSISTENCE_UNCERTAIN'
  | 'FINDING_RESULT_LIMIT_EXCEEDED'
  | 'FINDING_STALE_REVISION'
  | 'FINDING_SCOPE_DENIED'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Complete post-mutation state for one durable security finding. */
    'finding/change': FindingChange
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Compact deterministic view of every current finding in one Session. */
    findings: FindingProjection
  }
}
