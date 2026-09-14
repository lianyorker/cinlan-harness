/** In-memory artifact provider for session-scoped evidence storage. */

import { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import {
  ArtifactService,
  ArtifactId,
} from '@deepseek-ai/dsh-artifact'
import type { ExecutionHostService } from '@deepseek-ai/dsh-execution-host'
import type {
  ArtifactAuthorization,
  ArtifactRef,
  ArtifactDescribeRequest,
  ArtifactPublishRequest,
} from '@deepseek-ai/dsh-artifact'

/** In-memory artifact storage for testing and session-scoped evidence. */
export default class ArtifactMemoryProvider extends ArtifactService {
  private readonly store = new Map<string, { ref: ArtifactRef; data: Uint8Array }>()
  private readonly executionHost: ExecutionHostService

  static inject = ['executionHost']

  constructor(ctx: Context) {
    super(ctx)
    this.executionHost = ctx.executionHost
  }

  async describe(request: ArtifactDescribeRequest): Promise<ArtifactRef> {
    const entry = this.store.get(request.artifactId)
    if (entry === undefined) {
      throw new Error(`artifact ${request.artifactId} not found`)
    }
    assertAuthorized(entry.ref, request.authorization)
    return entry.ref
  }

  async publish(request: ArtifactPublishRequest): Promise<ArtifactRef> {
    const artifactId = ArtifactId(randomUUID())
    const sha256 = createHash('sha256').update(request.data).digest('hex')

    const ref: ArtifactRef = {
      artifactId,
      mediaType: request.mediaType,
      kind: request.kind,
      bytes: request.data.length,
      sha256,
      createdAt: new Date().toISOString(),
      provenance: {
        ...request.provenance,
        executionHostId: this.executionHost.current().hostId,
      },
      retention: request.retention,
      redaction: request.redaction,
      ...(request.name !== undefined ? { name: request.name } : {}),
    }

    assertAuthorized(ref, request.authorization)
    this.store.set(artifactId, { ref, data: request.data })
    return ref
  }
}

function assertAuthorized(ref: ArtifactRef, authorization: ArtifactAuthorization): void {
  const fields = ['sessionId', 'taskId', 'engagementId', 'scopeRef'] as const
  for (const field of fields) {
    const value = ref.provenance[field]
    if (value !== undefined && authorization[field] !== value) {
      throw new Error(`artifact authorization denied for ${field}`)
    }
  }
}

export const name = 'artifact-memory'
export function apply(ctx: Context): void {
  ctx.plugin(ArtifactMemoryProvider)
}
