/** Artifact service definition for evidence and report storage. */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ArtifactAuthorization,
  ArtifactId,
  ArtifactRef,
} from './types.ts'

export type {
  ArtifactAuthorization,
  ArtifactProvenance,
  ArtifactRedaction,
  ArtifactRef,
  ArtifactRetention,
} from './types.ts'

export {
  ArtifactEngagementId,
  ArtifactId,
  ArtifactProducerId,
  ArtifactScopeRef,
  ArtifactSessionId,
  ArtifactTaskId,
  ExecutionHostId,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    artifacts: ArtifactService
  }
}

/** Request to describe an artifact. */
export interface ArtifactDescribeRequest {
  readonly artifactId: ArtifactId
  readonly authorization: ArtifactAuthorization
}

/** Request to publish an artifact. */
export interface ArtifactPublishRequest {
  readonly data: Uint8Array
  readonly mediaType: string
  readonly kind: string
  readonly name?: string
  readonly provenance: Omit<ArtifactRef['provenance'], 'executionHostId'>
  readonly authorization: ArtifactAuthorization
  readonly retention: ArtifactRef['retention']
  readonly redaction: ArtifactRef['redaction']
}

/**
 * Artifact service: typed metadata store for evidence, reports, and recordings.
 * Providers implement session-scoped in-memory or durable storage.
 */
export abstract class ArtifactService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
  }

  /**
   * Describe one artifact by its identity.
   * @param request - artifact id and authorization.
   * @returns canonical artifact reference.
   * @throws when artifact does not exist or authorization is insufficient.
   */
  abstract describe(request: ArtifactDescribeRequest): Promise<ArtifactRef>

  /**
   * Publish one artifact with its metadata.
   * @param request - artifact data, metadata, and authorization.
   * @returns published artifact reference.
   */
  abstract publish(request: ArtifactPublishRequest): Promise<ArtifactRef>
}

export default ArtifactService
