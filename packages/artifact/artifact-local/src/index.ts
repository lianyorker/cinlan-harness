/** Private local-filesystem provider for `@deepseek-ai/dsh-artifact`. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { join, resolve } from 'node:path'
import { ArtifactService } from '@deepseek-ai/dsh-artifact'
import type {
  ArtifactAuthorization,
  ArtifactDescribeRequest,
  ArtifactPublishRequest,
  ArtifactRef,
} from '@deepseek-ai/dsh-artifact'
import type { ExecutionHostService } from '@deepseek-ai/dsh-execution-host'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { ArtifactError, describeArtifactFile, MAX_ARTIFACT_BYTES, publishArtifactFile, readArtifactFile } from './store.ts'

/** Default maximum bytes admitted or returned by one local operation. */
export const DEFAULT_MAX_BYTES = 100 * 1024 * 1024
const CONFIG_KEYS = new Set(['root', 'dshHome', 'maxBytes'])

/** Local artifact provider configuration. */
export interface Config {
  /** Explicit artifact root; omitted uses `<DSH_HOME>/artifacts/v1`. */
  root?: string
  /** Harness home used when `root` is omitted. */
  dshHome?: string
  /** Maximum bytes for publication and one bounded read. */
  maxBytes?: number
}

/** Byte-read request handled by this provider beyond the service contract. */
export interface ArtifactReadRequest {
  readonly artifactId: ArtifactRef['artifactId']
  readonly authorization: ArtifactAuthorization
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

/** Verified bytes plus the public immutable reference. */
export interface ArtifactReadResult {
  readonly ref: ArtifactRef
  readonly data: Uint8Array
}

/** Local immutable artifact provider with private files and path-free refs. */
export class LocalArtifactStore extends ArtifactService {
  static inject = ['executionHost']

  static Config: z<Config> = z.object({
    root: z.string(),
    dshHome: z.string(),
    maxBytes: z.number().step(1).min(1).max(MAX_ARTIFACT_BYTES).default(DEFAULT_MAX_BYTES),
  })

  /** Absolute private object root. */
  readonly root: string
  /** Hard upper bound enforced by publish and read. */
  readonly maxBytes: number
  private readonly executionHost: ExecutionHostService

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.executionHost = ctx.executionHost
    for (const key of Object.keys(config)) {
      if (!CONFIG_KEYS.has(key)) throw new Error(`artifact-local: unsupported config key '${key}'`)
    }
    if (config.root !== undefined && config.root.trim().length === 0) {
      throw new Error('artifact-local: root must be non-empty')
    }
    if (config.dshHome !== undefined && config.dshHome.trim().length === 0) {
      throw new Error('artifact-local: dshHome must be non-empty')
    }
    const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_ARTIFACT_BYTES) {
      throw new Error(
        `artifact-local: maxBytes must be a positive safe integer no greater than ${MAX_ARTIFACT_BYTES}`,
      )
    }
    this.root = resolve(config.root ?? join(resolveDshHome(config.dshHome), 'artifacts', 'v1'))
    this.maxBytes = maxBytes
  }

  async publish(input: ArtifactPublishRequest): Promise<ArtifactRef> {
    return publishArtifactFile(this.root, input, this.maxBytes, this.executionHost.current().hostId)
  }

  async describe(input: ArtifactDescribeRequest): Promise<ArtifactRef> {
    return describeArtifactFile(this.root, input)
  }

  /**
   * Provider-specific verified byte read; the service contract exposes
   * metadata only, so consumers that need bytes depend on this class.
   * @param input - artifact id, authorization scope, byte bound, and optional cancellation.
   * @returns verified bytes and the public immutable reference.
   */
  async read(input: ArtifactReadRequest): Promise<ArtifactReadResult> {
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) {
      throw new ArtifactError('Artifact read bound is invalid.', 'ARTIFACT_INVALID_INPUT')
    }
    return readArtifactFile(this.root, {
      ...input,
      maxBytes: Math.min(input.maxBytes, this.maxBytes),
    })
  }
}

export { ArtifactError, describeArtifactFile, MAX_ARTIFACT_BYTES, publishArtifactFile, readArtifactFile } from './store.ts'
export type { ArtifactErrorCode } from './store.ts'

export default LocalArtifactStore
