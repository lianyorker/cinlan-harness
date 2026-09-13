/** Cordis-free local artifact publication and verification mechanics. */

import { createHash, randomUUID } from 'node:crypto'
import { constants as bufferConstants } from 'node:buffer'
import { constants, type BigIntStats } from 'node:fs'
import { chmod, link, lstat, mkdir, open, unlink, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  ArtifactEngagementId,
  ArtifactId,
  ArtifactProducerId,
  ArtifactScopeRef,
  ArtifactSessionId,
  ArtifactTaskId,
} from '@deepseek-ai/dsh-artifact'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import type {
  ArtifactAuthorization,
  ArtifactProvenance,
  ArtifactPublishRequest,
  ArtifactRedaction,
  ArtifactRef,
  ArtifactRetention,
} from '@deepseek-ai/dsh-artifact'

/** Stable failure codes surfaced by the local artifact provider. */
export type ArtifactErrorCode =
  | 'ARTIFACT_INVALID_INPUT'
  | 'ARTIFACT_INVALID_REF'
  | 'ARTIFACT_TOO_LARGE'
  | 'ARTIFACT_CORRUPT'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_FORBIDDEN'
  | 'ARTIFACT_READ_FAILED'
  | 'ARTIFACT_WRITE_FAILED'

/** Typed artifact failure carrying a stable machine-readable code. */
export class ArtifactError extends Error {
  constructor(
    message: string,
    readonly code: ArtifactErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ArtifactError'
  }
}

const ID_PATTERN = /^artifact:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/
const DIGEST_PATTERN = /^[0-9a-f]{64}$/
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+\-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+\-]{0,126}$/
const KINDS = new Set(['binary', 'text', 'download', 'trace', 'report', 'evidence'])
const RETENTIONS: ReadonlySet<string> = new Set(['ephemeral', 'session', 'task', 'engagement', 'pinned', 'managed'])
const REDACTIONS: ReadonlySet<string> = new Set(['none', 'redacted', 'unknown'])
const MAX_METADATA_BYTES = 16 * 1024
/** Largest artifact that this in-memory local provider can allocate safely. */
export const MAX_ARTIFACT_BYTES = Math.min(bufferConstants.MAX_LENGTH, bufferConstants.MAX_STRING_LENGTH)
const optionalFsConstants = constants as unknown as { readonly O_NOFOLLOW?: number }
/* v8 ignore next -- Windows lacks O_NOFOLLOW; stable file identity closes the replacement race there. */
const READ_ONLY_NO_FOLLOW = constants.O_RDONLY | (optionalFsConstants.O_NOFOLLOW ?? 0)

/**
 * Provider-private authorization record: the contract scope plus the
 * provenance identity the artifact was published under. Identity fields are
 * stamped at publication and cross-checked against stored provenance on load,
 * so metadata tampering stays detectable even though the public
 * {@link ArtifactAuthorization} contract carries scope fields only.
 */
interface StoredAuthorization extends ArtifactAuthorization {
  readonly producerId: ArtifactProducerId
  readonly executionHostId: ExecutionHostId
}

interface StoredArtifact extends ArtifactRef {
  readonly authorization: StoredAuthorization
}

function publicRef(record: StoredArtifact): ArtifactRef {
  const { authorization: _authorization, ...ref } = record
  return ref
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Resolve the private object path for an already validated id.
 * @param root - absolute artifact root.
 * @param id - UUID portion of an artifact id.
 * @returns the provider-private object path.
 */
export function objectPath(root: string, id: string): string {
  return join(root, 'objects', id)
}

/**
 * Resolve the private metadata path for an already validated id.
 * @param root - absolute artifact root.
 * @param id - UUID portion of an artifact id.
 * @returns the provider-private metadata path.
 */
export function metadataPath(root: string, id: string): string {
  return join(root, 'metadata', `${id}.json`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeOpaque(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ArtifactError(`Artifact ${field} is invalid.`, 'ARTIFACT_INVALID_INPUT')
  }
  return value
}

function safeSource(value: unknown): string {
  const source = safeOpaque(value, 'source')
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source)) {
    throw new ArtifactError('Artifact source is invalid.', 'ARTIFACT_INVALID_INPUT')
  }
  return source
}

function safeExecutionHostId(value: unknown): ReturnType<typeof ExecutionHostId> {
  return ExecutionHostId(safeOpaque(value, 'execution host'))
}

function isRetention(value: unknown): value is ArtifactRetention {
  return typeof value === 'string' && RETENTIONS.has(value)
}

function isRedaction(value: unknown): value is ArtifactRedaction {
  return typeof value === 'string' && REDACTIONS.has(value)
}

/** Sync a publication directory on POSIX before exposing its reference. */
async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows cannot open directory handles; filesystem metadata journaling covers the entry. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- POSIX-only directory fsync; Windows skips this branch. */
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

type ClaimedAuthorization = ArtifactAuthorization & {
  readonly producerId?: ArtifactProducerId
  readonly executionHostId?: ExecutionHostId
}

function safeScope(value: unknown, code: 'ARTIFACT_INVALID_INPUT' | 'ARTIFACT_CORRUPT'): ClaimedAuthorization {
  if (!isRecord(value)) throw new ArtifactError('Artifact authorization is invalid.', code)
  return {
    ...(value.producerId === undefined
      ? {}
      : { producerId: ArtifactProducerId(safeOpaque(value.producerId, 'producer')) }),
    ...(value.executionHostId === undefined ? {} : { executionHostId: safeExecutionHostId(value.executionHostId) }),
    ...(value.sessionId === undefined
      ? {}
      : { sessionId: ArtifactSessionId(safeOpaque(value.sessionId, 'sessionId')) }),
    ...(value.taskId === undefined ? {} : { taskId: ArtifactTaskId(safeOpaque(value.taskId, 'taskId')) }),
    ...(value.engagementId === undefined
      ? {}
      : { engagementId: ArtifactEngagementId(safeOpaque(value.engagementId, 'engagementId')) }),
    ...(value.scopeRef === undefined ? {} : { scopeRef: ArtifactScopeRef(safeOpaque(value.scopeRef, 'scope')) }),
  }
}

function storedScope(value: unknown): StoredAuthorization {
  const scope = safeScope(value, 'ARTIFACT_CORRUPT')
  if (scope.producerId === undefined || scope.executionHostId === undefined) {
    throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
  }
  return scope as StoredAuthorization
}

function sameScope(stored: StoredAuthorization, request: ClaimedAuthorization): boolean {
  return stored.sessionId === request.sessionId
    && stored.taskId === request.taskId
    && stored.engagementId === request.engagementId
    && stored.scopeRef === request.scopeRef
    && (request.producerId === undefined || request.producerId === stored.producerId)
    && (request.executionHostId === undefined || request.executionHostId === stored.executionHostId)
}

function displayName(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  const sanitized = value.slice(separator + 1).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return sanitized.length === 0 ? undefined : sanitized.slice(0, 255)
}

function validateInput(input: ArtifactPublishRequest, maxBytes: number, executionHostId: ExecutionHostId): {
  authorization: StoredAuthorization
  provenance: ArtifactProvenance
  mediaType: string
  kind: string
  retention: ArtifactRetention
  redaction: ArtifactRedaction
  name: string | undefined
} {
  if (!(input.data instanceof Uint8Array)) throw new ArtifactError('Artifact bytes are invalid.', 'ARTIFACT_INVALID_INPUT')
  if (input.data.byteLength > maxBytes) throw new ArtifactError('Artifact exceeds the configured byte limit.', 'ARTIFACT_TOO_LARGE')
  if (typeof input.mediaType !== 'string' || !MEDIA_TYPE_PATTERN.test(input.mediaType)) {
    throw new ArtifactError('Artifact media type is invalid.', 'ARTIFACT_INVALID_INPUT')
  }
  const kind = safeOpaque(input.kind, 'kind')
  if (!KINDS.has(kind) && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(kind)) {
    throw new ArtifactError('Artifact kind is invalid.', 'ARTIFACT_INVALID_INPUT')
  }
  const claimed = safeScope(input.authorization, 'ARTIFACT_INVALID_INPUT')
  if (claimed.executionHostId !== undefined && claimed.executionHostId !== executionHostId) {
    throw new ArtifactError('Artifact authorization names a different execution host.', 'ARTIFACT_INVALID_INPUT')
  }
  if (!isRecord(input.provenance)) throw new ArtifactError('Artifact provenance is invalid.', 'ARTIFACT_INVALID_INPUT')
  const provenanceInput: Record<string, unknown> = input.provenance
  if (provenanceInput.executionHostId !== undefined
    && safeExecutionHostId(provenanceInput.executionHostId) !== executionHostId) {
    throw new ArtifactError('Artifact provenance does not match its authorization scope.', 'ARTIFACT_INVALID_INPUT')
  }
  const provenance: ArtifactProvenance = {
    producerId: ArtifactProducerId(safeOpaque(provenanceInput.producerId, 'producer')),
    executionHostId,
    ...(provenanceInput.sessionId === undefined
      ? {}
      : { sessionId: ArtifactSessionId(safeOpaque(provenanceInput.sessionId, 'sessionId')) }),
    ...(provenanceInput.taskId === undefined
      ? {}
      : { taskId: ArtifactTaskId(safeOpaque(provenanceInput.taskId, 'taskId')) }),
    ...(provenanceInput.engagementId === undefined
      ? {}
      : { engagementId: ArtifactEngagementId(safeOpaque(provenanceInput.engagementId, 'engagementId')) }),
    ...(provenanceInput.scopeRef === undefined
      ? {}
      : { scopeRef: ArtifactScopeRef(safeOpaque(provenanceInput.scopeRef, 'scope')) }),
    ...(provenanceInput.source === undefined ? {} : { source: safeSource(provenanceInput.source) }),
  }
  if ((claimed.producerId !== undefined && claimed.producerId !== provenance.producerId)
    || provenance.sessionId !== claimed.sessionId || provenance.taskId !== claimed.taskId
    || provenance.engagementId !== claimed.engagementId || provenance.scopeRef !== claimed.scopeRef) {
    throw new ArtifactError('Artifact provenance does not match its authorization scope.', 'ARTIFACT_INVALID_INPUT')
  }
  const authorization: StoredAuthorization = {
    producerId: provenance.producerId,
    executionHostId,
    ...(claimed.sessionId === undefined ? {} : { sessionId: claimed.sessionId }),
    ...(claimed.taskId === undefined ? {} : { taskId: claimed.taskId }),
    ...(claimed.engagementId === undefined ? {} : { engagementId: claimed.engagementId }),
    ...(claimed.scopeRef === undefined ? {} : { scopeRef: claimed.scopeRef }),
  }
  const retention = input.retention ?? 'managed'
  if (!isRetention(retention)) throw new ArtifactError('Artifact retention is invalid.', 'ARTIFACT_INVALID_INPUT')
  const redaction = input.redaction ?? 'unknown'
  if (!isRedaction(redaction)) throw new ArtifactError('Artifact redaction state is invalid.', 'ARTIFACT_INVALID_INPUT')
  return { authorization, provenance, mediaType: input.mediaType, kind, retention, redaction, name: displayName(input.name) }
}

function parseId(value: unknown): string {
  if (typeof value !== 'string') throw new ArtifactError('Artifact reference is invalid.', 'ARTIFACT_INVALID_REF')
  const match = ID_PATTERN.exec(value)
  if (match?.[1] === undefined) throw new ArtifactError('Artifact reference is invalid.', 'ARTIFACT_INVALID_REF')
  return match[1]
}

function parseStored(value: unknown): StoredArtifact {
  if (!isRecord(value)) throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
  const artifactId = parseId(value.artifactId)
  const bytes = value.bytes
  const createdAt = typeof value.createdAt === 'string' ? Date.parse(value.createdAt) : Number.NaN
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0
    || typeof value.mediaType !== 'string' || !MEDIA_TYPE_PATTERN.test(value.mediaType)
    || typeof value.kind !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value.kind)
    || typeof value.sha256 !== 'string' || !DIGEST_PATTERN.test(value.sha256)
    || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== value.createdAt
    || !isRetention(value.retention) || !isRedaction(value.redaction)
    || (value.name !== undefined && typeof value.name !== 'string')) {
    throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
  }
  const authorization = storedScope(value.authorization)
  const provenance = value.provenance
  if (!isRecord(provenance)) throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
  const parsedProvenance: ArtifactProvenance = {
    producerId: ArtifactProducerId(safeOpaque(provenance.producerId, 'producer')),
    executionHostId: safeExecutionHostId(provenance.executionHostId),
    ...(provenance.sessionId === undefined
      ? {}
      : { sessionId: ArtifactSessionId(safeOpaque(provenance.sessionId, 'session')) }),
    ...(provenance.taskId === undefined
      ? {}
      : { taskId: ArtifactTaskId(safeOpaque(provenance.taskId, 'task')) }),
    ...(provenance.engagementId === undefined
      ? {}
      : { engagementId: ArtifactEngagementId(safeOpaque(provenance.engagementId, 'engagement')) }),
    ...(provenance.scopeRef === undefined
      ? {}
      : { scopeRef: ArtifactScopeRef(safeOpaque(provenance.scopeRef, 'scope')) }),
    ...(provenance.source === undefined ? {} : { source: safeSource(provenance.source) }),
  }
  const name = value.name === undefined ? undefined : displayName(value.name)
  const ref: ArtifactRef = {
    artifactId: ArtifactId(`artifact:${artifactId}`),
    mediaType: value.mediaType,
    kind: value.kind,
    bytes,
    sha256: value.sha256,
    createdAt: value.createdAt,
    provenance: parsedProvenance,
    retention: value.retention,
    redaction: value.redaction,
    ...(name === undefined ? {} : { name }),
  }
  if (ref.provenance.producerId !== authorization.producerId || ref.provenance.executionHostId !== authorization.executionHostId
    || ref.provenance.sessionId !== authorization.sessionId || ref.provenance.taskId !== authorization.taskId
    || ref.provenance.engagementId !== authorization.engagementId || ref.provenance.scopeRef !== authorization.scopeRef) {
    throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
  }
  return { ...ref, authorization }
}

async function commitNewFile(target: string, data: Uint8Array | string): Promise<void> {
  const directory = dirname(target)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  /* v8 ignore next -- Windows permissions come from the configured root DACL, not synthetic POSIX mode bits. */
  if (process.platform !== 'win32') {
    /* v8 ignore next -- POSIX CI owns the owner-only mode assertion; Windows skips this call. */
    await chmod(directory, 0o700)
  }
  const temporary = `${target}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(typeof data === 'string' ? data : Buffer.from(data))
    await handle.sync()
    await handle.close()
    handle = undefined
    await link(temporary, target)
    await syncDirectory(dirname(target))
    await unlink(temporary)
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {})
    await unlink(temporary).catch(() => {})
    throw error
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

async function openRegularFile(path: string, corruptMessage: string): Promise<FileHandle> {
  const observed = await lstat(path, { bigint: true })
  if (!observed.isFile()) throw new ArtifactError(corruptMessage, 'ARTIFACT_CORRUPT')
  let handle: FileHandle | undefined
  try {
    handle = await open(path, READ_ONLY_NO_FOLLOW)
    const opened = await handle.stat({ bigint: true })
    if (!opened.isFile() || !sameFile(observed, opened)) {
      throw new ArtifactError(corruptMessage, 'ARTIFACT_CORRUPT')
    }
    return handle
  } catch (error) {
    await handle?.close().catch(() => {})
    if ((error as NodeJS.ErrnoException | null)?.code === 'ELOOP') {
      throw new ArtifactError(corruptMessage, 'ARTIFACT_CORRUPT')
    }
    throw error
  }
}

async function readHandleBounded(
  handle: FileHandle,
  maxBytes: number,
  corrupt: () => ArtifactError,
  tooLarge: () => ArtifactError,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted()
  const size = (await handle.stat()).size
  if (!Number.isSafeInteger(size) || size < 0) {
    throw corrupt()
  }
  if (size > maxBytes || size > MAX_ARTIFACT_BYTES) throw tooLarge()
  const data = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    signal?.throwIfAborted()
    const result = await handle.read(data, offset, size - offset, offset)
    if (result.bytesRead === 0) throw corrupt()
    offset += result.bytesRead
  }
  signal?.throwIfAborted()
  const extra = Buffer.alloc(1)
  const result = await handle.read(extra, 0, 1, offset)
  if (result.bytesRead !== 0) throw tooLarge()
  return data
}

async function readMetadata(root: string, id: string): Promise<StoredArtifact> {
  let handle: FileHandle | undefined
  try {
    const path = metadataPath(root, id)
    handle = await openRegularFile(path, 'Artifact metadata is unavailable.')
    try {
      const data = await readHandleBounded(
        handle,
        MAX_METADATA_BYTES,
        () => new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT'),
        () => new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT'),
      )
      const record = parseStored(JSON.parse(data.toString('utf8')))
      if (record.artifactId !== `artifact:${id}`) {
        throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT')
      }
      return record
    } catch (error) {
      if (error instanceof ArtifactError && error.code === 'ARTIFACT_CORRUPT') throw error
      throw new ArtifactError('Stored artifact metadata is corrupt.', 'ARTIFACT_CORRUPT', { cause: error })
    }
  } catch (error) {
    if (error instanceof ArtifactError) throw error
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') throw new ArtifactError('Artifact was not found.', 'ARTIFACT_NOT_FOUND')
    throw new ArtifactError('Artifact metadata could not be read.', 'ARTIFACT_READ_FAILED', { cause: error })
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function readBounded(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  let handle: FileHandle | undefined
  try {
    handle = await openRegularFile(path, 'Artifact object is corrupt.')
    const data = await readHandleBounded(
      handle,
      maxBytes,
      () => new ArtifactError('Artifact object is corrupt.', 'ARTIFACT_CORRUPT'),
      () => new ArtifactError('Artifact exceeds the requested read bound.', 'ARTIFACT_TOO_LARGE'),
      signal,
    )
    return new Uint8Array(data)
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof ArtifactError) throw error
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') throw new ArtifactError('Artifact was not found.', 'ARTIFACT_NOT_FOUND')
    throw new ArtifactError('Artifact bytes could not be read.', 'ARTIFACT_READ_FAILED', { cause: error })
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Validate and atomically publish local artifact files.
 * @param root - absolute artifact root.
 * @param input - bytes and metadata to publish.
 * @param maxBytes - inclusive publication limit.
 * @returns the immutable public reference after both object and metadata commits.
 */
export async function publishArtifactFile(root: string, input: ArtifactPublishRequest, maxBytes: number, executionHostId: ExecutionHostId): Promise<ArtifactRef> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > MAX_ARTIFACT_BYTES) {
    throw new ArtifactError('Artifact publication limit is invalid.', 'ARTIFACT_INVALID_INPUT')
  }
  const validated = validateInput(input, maxBytes, executionHostId)
  const data = new Uint8Array(input.data)
  const id = randomUUID()
  const ref: ArtifactRef = {
    artifactId: ArtifactId(`artifact:${id}`),
    mediaType: validated.mediaType,
    kind: validated.kind,
    bytes: data.byteLength,
    sha256: digest(data),
    createdAt: new Date().toISOString(),
    provenance: validated.provenance,
    retention: validated.retention,
    redaction: validated.redaction,
    ...(validated.name === undefined ? {} : { name: validated.name }),
  }
  const record: StoredArtifact = { ...ref, authorization: validated.authorization }
  try {
    await commitNewFile(objectPath(root, id), data)
    try {
      await commitNewFile(metadataPath(root, id), `${JSON.stringify(record)}\n`)
    } catch (error) {
      await unlink(objectPath(root, id)).catch(() => {})
      throw error
    }
  } catch (error) {
    throw new ArtifactError('Artifact publication failed.', 'ARTIFACT_WRITE_FAILED', { cause: error })
  }
  return ref
}

/**
 * Load and authorize immutable metadata from local storage.
 * @param root - absolute artifact root.
 * @param input - artifact id and complete authorization scope.
 * @returns the public immutable reference.
 */
export async function describeArtifactFile(root: string, input: { artifactId: ArtifactRef['artifactId']; authorization: ArtifactAuthorization }): Promise<ArtifactRef> {
  const id = parseId(input.artifactId)
  const record = await readMetadata(root, id)
  if (!sameScope(record.authorization, safeScope(input.authorization, 'ARTIFACT_INVALID_INPUT'))) {
    throw new ArtifactError('Artifact access is not authorized.', 'ARTIFACT_FORBIDDEN')
  }
  return publicRef(record)
}

/**
 * Load, authorize, bound, and digest-check immutable local bytes.
 * @param root - absolute artifact root.
 * @param input - artifact id, scope, byte bound, and optional cancellation.
 * @returns verified bytes and the public immutable reference.
 */
export async function readArtifactFile(root: string, input: { artifactId: ArtifactRef['artifactId']; authorization: ArtifactAuthorization; maxBytes: number; signal?: AbortSignal }): Promise<{ ref: ArtifactRef; data: Uint8Array }> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 0) throw new ArtifactError('Artifact read bound is invalid.', 'ARTIFACT_INVALID_INPUT')
  const id = parseId(input.artifactId)
  const record = await readMetadata(root, id)
  if (!sameScope(record.authorization, safeScope(input.authorization, 'ARTIFACT_INVALID_INPUT'))) {
    throw new ArtifactError('Artifact access is not authorized.', 'ARTIFACT_FORBIDDEN')
  }
  const data = await readBounded(objectPath(root, id), input.maxBytes, input.signal)
  if (data.byteLength !== record.bytes || digest(data) !== record.sha256) throw new ArtifactError('Artifact failed integrity verification.', 'ARTIFACT_CORRUPT')
  return { ref: publicRef(record), data }
}
