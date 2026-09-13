/** Artifact types for security evidence and report validation. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque artifact identifier. */
export type ArtifactId = Branded<'ArtifactId'>

/**
 * Brand an opaque artifact identifier.
 * @param value - Serialized artifact identifier.
 * @returns The branded artifact identifier.
 */
export function ArtifactId(value: string): ArtifactId {
  return value as ArtifactId
}

/** Session that produced the artifact. */
export type ArtifactSessionId = Branded<'ArtifactSessionId'>

/**
 * Brand the Session identifier recorded in artifact provenance.
 * @param value - Serialized Session identifier.
 * @returns The branded artifact Session identifier.
 */
export function ArtifactSessionId(value: string): ArtifactSessionId {
  return value as ArtifactSessionId
}

/** Producer identity. */
export type ArtifactProducerId = Branded<'ArtifactProducerId'>

/**
 * Brand an artifact producer identifier.
 * @param value - Serialized producer identifier.
 * @returns The branded producer identifier.
 */
export function ArtifactProducerId(value: string): ArtifactProducerId {
  return value as ArtifactProducerId
}

/** Task identity. */
export type ArtifactTaskId = Branded<'ArtifactTaskId'>

/**
 * Brand the Worktree Task identifier recorded in artifact provenance.
 * @param value - Serialized task identifier.
 * @returns The branded artifact task identifier.
 */
export function ArtifactTaskId(value: string): ArtifactTaskId {
  return value as ArtifactTaskId
}

/** Engagement identity. */
export type ArtifactEngagementId = Branded<'ArtifactEngagementId'>

/**
 * Brand an engagement identifier.
 * @param value - Serialized engagement identifier.
 * @returns The branded engagement identifier.
 */
export function ArtifactEngagementId(value: string): ArtifactEngagementId {
  return value as ArtifactEngagementId
}

/** Scope reference. */
export type ArtifactScopeRef = Branded<'ArtifactScopeRef'>

/**
 * Brand an assessment scope reference.
 * @param value - Serialized scope reference.
 * @returns The branded artifact scope reference.
 */
export function ArtifactScopeRef(value: string): ArtifactScopeRef {
  return value as ArtifactScopeRef
}

/** Execution host that produced the artifact. */
export type ExecutionHostId = Branded<'ExecutionHostId'>

/**
 * Brand an execution host identifier.
 * @param value - Serialized execution host identifier.
 * @returns The branded execution host identifier.
 */
export function ExecutionHostId(value: string): ExecutionHostId {
  return value as ExecutionHostId
}

/** Artifact retention policy. */
export type ArtifactRetention = 'ephemeral' | 'session' | 'task' | 'engagement' | 'pinned' | 'managed'

/** Artifact redaction state. */
export type ArtifactRedaction = 'none' | 'redacted' | 'unknown'

/** Artifact provenance metadata. */
export interface ArtifactProvenance {
  readonly producerId: ArtifactProducerId
  readonly executionHostId: ExecutionHostId
  readonly sessionId?: ArtifactSessionId
  readonly taskId?: ArtifactTaskId
  readonly engagementId?: ArtifactEngagementId
  readonly scopeRef?: ArtifactScopeRef
  readonly source?: string
}

/** Complete artifact reference with metadata. */
export interface ArtifactRef {
  readonly artifactId: ArtifactId
  readonly mediaType: string
  readonly kind: string
  readonly bytes: number
  readonly sha256: string
  readonly createdAt: string
  readonly provenance: ArtifactProvenance
  readonly retention: ArtifactRetention
  readonly redaction: ArtifactRedaction
  readonly name?: string
}

/** Authorization for artifact operations. */
export interface ArtifactAuthorization {
  readonly sessionId?: ArtifactSessionId
  readonly taskId?: ArtifactTaskId
  readonly engagementId?: ArtifactEngagementId
  readonly scopeRef?: ArtifactScopeRef
}
