/** Canonicalization, mutation construction, and strict replay for durable findings. */

import { createHash } from 'node:crypto'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { ArtifactRef } from '@deepseek-ai/dsh-artifact'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { FindingError, FindingFingerprint, FindingId, FindingRuleId, FindingTargetId } from './runtime.ts'
import type {
  FindingChange,
  FindingConfidence,
  FindingCvss,
  FindingEvidence,
  FindingEvidenceRole,
  FindingFingerprint as FindingFingerprintType,
  FindingId as FindingIdType,
  FindingIdentity,
  FindingInitialState,
  FindingLocation,
  FindingProvenance,
  FindingReachability,
  FindingRecordRequest,
  FindingRef,
  FindingRuleId as FindingRuleIdType,
  FindingSeverity,
  FindingSnapshot,
  FindingState,
  FindingTarget,
  FindingTargetId as FindingTargetIdType,
  FindingTransitionRequest,
  FindingTransitionState,
} from './types.ts'

const INITIAL_STATES: ReadonlySet<FindingInitialState> = new Set([
  'observation',
  'hypothesis',
  'reproduced-vulnerability',
])
const TRANSITION_STATES: ReadonlySet<FindingTransitionState> = new Set([
  'hypothesis',
  'reproduced-vulnerability',
  'remediation',
  'unresolved',
])
const EVIDENCE_ROLE_ORDER: Readonly<Record<FindingEvidenceRole, number>> = {
  observation: 0,
  reproduction: 1,
  'remediation-validation': 2,
  supporting: 3,
}

const safeInteger = zod.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const positiveInteger = safeInteger.min(1)
const artifactProvenanceSchema = zod.object({
  producerId: zod.string().min(1),
  executionHostId: zod.string().min(1),
  sessionId: zod.string().min(1).optional(),
  taskId: zod.string().min(1).optional(),
  engagementId: zod.string().min(1).optional(),
  scopeRef: zod.string().min(1).optional(),
  source: zod.string().min(1).optional(),
}).strict()
const artifactRefSchema = zod.object({
  artifactId: zod.string().min(1),
  mediaType: zod.string().min(1),
  kind: zod.string().min(1),
  bytes: safeInteger,
  sha256: zod.string().regex(/^[0-9a-f]{64}$/),
  createdAt: zod.string().min(1),
  provenance: artifactProvenanceSchema,
  retention: zod.enum(['ephemeral', 'session', 'task', 'engagement', 'pinned', 'managed']),
  redaction: zod.enum(['none', 'redacted', 'unknown']),
  name: zod.string().min(1).optional(),
}).strict() as unknown as ZodType<ArtifactRef>
const targetSchema = zod.object({
  id: zod.string().min(1),
  kind: zod.enum(['host', 'service', 'url', 'repository', 'package', 'file', 'component', 'other']),
  displayName: zod.string().min(1),
}).strict()
const codeLocationSchema = zod.object({
  kind: zod.literal('code'),
  targetId: zod.string().min(1),
  uri: zod.string().min(1),
  startLine: positiveInteger.optional(),
  startColumn: positiveInteger.optional(),
  endLine: positiveInteger.optional(),
  endColumn: positiveInteger.optional(),
}).strict()
const dependencyLocationSchema = zod.object({
  kind: zod.literal('dependency'),
  targetId: zod.string().min(1),
  ecosystem: zod.string().min(1),
  packageName: zod.string().min(1),
  version: zod.string().min(1).optional(),
  manifestUri: zod.string().min(1).optional(),
}).strict()
const locationSchema = zod.discriminatedUnion('kind', [codeLocationSchema, dependencyLocationSchema])
const evidenceSchema = zod.object({
  role: zod.enum(['observation', 'reproduction', 'remediation-validation', 'supporting']),
  artifact: artifactRefSchema,
  note: zod.string().min(1).optional(),
}).strict()
const provenanceSchema = zod.object({
  pluginId: zod.string().min(1),
  pluginVersion: zod.string().min(1),
  toolName: zod.string().min(1),
}).strict()
const cvssSchema = zod.object({
  version: zod.enum(['3.1', '4.0']),
  vector: zod.string().min(1),
  score: zod.number().min(0).max(10),
}).strict()
const reachabilitySchema = zod.discriminatedUnion('kind', [
  zod.object({ kind: zod.literal('unknown') }).strict(),
  zod.object({ kind: zod.literal('unreachable'), reason: zod.string().min(1) }).strict(),
  zod.object({
    kind: zod.literal('reachable'),
    entrypoint: zod.string().min(1),
    pathEvidence: artifactRefSchema.optional(),
  }).strict(),
])
const identitySchema = zod.object({
  ruleId: zod.string().min(1),
  targetIds: zod.array(zod.string().min(1)),
  locations: zod.array(locationSchema),
}).strict()
const refSchema = zod.object({ id: zod.string().min(1), revision: positiveInteger }).strict()
const snapshotSchema = zod.object({
  id: zod.string().min(1),
  revision: positiveInteger,
  fingerprint: zod.string().regex(/^[0-9a-f]{64}$/),
  identity: identitySchema,
  ruleId: zod.string().min(1),
  title: zod.string().min(1),
  summary: zod.string().min(1),
  state: zod.enum(['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'unresolved']),
  severity: zod.enum(['informational', 'low', 'medium', 'high', 'critical']),
  confidence: zod.enum(['low', 'medium', 'high']),
  targets: zod.array(targetSchema),
  locations: zod.array(locationSchema),
  cweIds: zod.array(zod.string().min(1)),
  cveIds: zod.array(zod.string().min(1)),
  cvss: cvssSchema.optional(),
  assumptions: zod.array(zod.string().min(1)),
  reachability: reachabilitySchema,
  evidence: zod.array(evidenceSchema),
  provenance: zod.array(provenanceSchema),
  fixGuidance: zod.string().min(1).optional(),
  occurrences: positiveInteger,
  createdAt: safeInteger,
  updatedAt: safeInteger,
}).strict() as unknown as ZodType<FindingSnapshot>
const changeSchema = zod.object({
  kind: zod.literal('finding/change'),
  version: zod.literal(1),
  operation: zod.enum(['record', 'transition']),
  previous: zod.union([refSchema, zod.null()]),
  finding: snapshotSchema,
}).strict() as unknown as ZodType<FindingChange>

/** Mutable accumulator owned by strict replay and the relationship invariant. */
export interface FindingFoldState {
  readonly findings: Map<FindingIdType, FindingSnapshot>
}

/** Canonical fields resolved from one record request before persistence. */
export interface ResolvedFindingRecord {
  readonly id: FindingIdType
  readonly fingerprint: FindingFingerprintType
  readonly identity: FindingIdentity
  readonly ruleId: FindingRuleIdType
  readonly title: string
  readonly summary: string
  readonly state: FindingInitialState
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
}

/** Canonical fields resolved from one transition request. */
export interface ResolvedFindingTransition {
  readonly to: FindingTransitionState
  readonly evidence: readonly FindingEvidence[]
  readonly fixGuidance?: string
}

/**
 * Return deterministic JSON with lexicographically sorted object keys.
 * @param value - JSON-compatible value without undefined members or non-finite numbers.
 * @returns Canonical JSON text.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON numbers must be finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => {
      const member = record[key]
      if (member === undefined) throw new TypeError(`canonical JSON field ${JSON.stringify(key)} is undefined`)
      return `${JSON.stringify(key)}:${canonicalJson(member)}`
    }).join(',')}}`
  }
  throw new TypeError(`canonical JSON does not support ${typeof value}`)
}

/** Return map values in the default UTF-16 order of their string keys. */
function sortedMapValues<K extends string, V>(values: ReadonlyMap<K, V>): V[] {
  const ordered: V[] = []
  for (const key of [...values.keys()].sort()) {
    const value = values.get(key)
    /* v8 ignore next 2 -- the key comes from the same unmodified map. */
    if (value === undefined) throw new TypeError('canonical map key disappeared during ordering')
    ordered.push(value)
  }
  return ordered
}

/** Normalize one required model or durable string. */
function normalizedText(value: string, field: string): string {
  const normalized = value.trim().normalize('NFC')
  if (normalized.length === 0) {
    throw new FindingError(`${field} must be non-empty`, 'FINDING_INVALID_RECORD')
  }
  return normalized
}

/** Return sorted unique normalized strings. */
function normalizedStrings(values: readonly string[], field: string, transform?: (value: string) => string): string[] {
  return [...new Set(values.map(value => transform?.(normalizedText(value, field)) ?? normalizedText(value, field)))]
    .sort()
}

/** Normalize and validate CWE identifiers. */
function normalizeCweIds(values: readonly string[]): string[] {
  return normalizedStrings(values, 'cweId', value => value.toUpperCase()).map((value) => {
    if (!/^CWE-[1-9][0-9]*$/.test(value)) {
      throw new FindingError(`invalid CWE id ${JSON.stringify(value)}`, 'FINDING_INVALID_RECORD')
    }
    return value
  })
}

/** Normalize and validate CVE identifiers. */
function normalizeCveIds(values: readonly string[]): string[] {
  return normalizedStrings(values, 'cveId', value => value.toUpperCase()).map((value) => {
    if (!/^CVE-[0-9]{4}-[0-9]{4,}$/.test(value)) {
      throw new FindingError(`invalid CVE id ${JSON.stringify(value)}`, 'FINDING_INVALID_RECORD')
    }
    return value
  })
}

/** Assert exhaustive handling of one closed union. */
/* v8 ignore next 2 -- TypeScript and durable schemas close every discriminated union before this guard. */
function assertNever(value: never): never {
  throw new TypeError(`unexpected finding discriminant ${String(value)}`)
}

/** Normalize and validate one target. */
function normalizeTarget(target: FindingTarget): FindingTarget {
  return {
    id: FindingTargetId(normalizedText(target.id, 'target.id')),
    kind: target.kind,
    displayName: normalizedText(target.displayName, 'target.displayName'),
  }
}

/** Canonicalize targets and reject conflicting duplicate ids. */
function normalizeTargets(targets: readonly FindingTarget[]): FindingTarget[] {
  if (targets.length === 0) throw new FindingError('at least one target is required', 'FINDING_INVALID_RECORD')
  const byId = new Map<FindingTargetIdType, FindingTarget>()
  for (const target of targets.map(normalizeTarget)) {
    const current = byId.get(target.id)
    if (current !== undefined && canonicalJson(current) !== canonicalJson(target)) {
      throw new FindingError(`target ${JSON.stringify(target.id)} has conflicting definitions`, 'FINDING_INVALID_RECORD')
    }
    byId.set(target.id, target)
  }
  return sortedMapValues(byId)
}

/** Normalize one code or dependency location. */
function normalizeLocation(location: FindingLocation): FindingLocation {
  switch (location.kind) {
    case 'code': {
      const startLine = location.startLine
      const startColumn = location.startColumn
      const endLine = location.endLine
      const endColumn = location.endColumn
      for (const [field, value] of Object.entries({ startLine, startColumn, endLine, endColumn })) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
          throw new FindingError(`location.${field} must be a positive safe integer`, 'FINDING_INVALID_RECORD')
        }
      }
      if ((startColumn !== undefined || endLine !== undefined || endColumn !== undefined) && startLine === undefined) {
        throw new FindingError('location.startLine is required when a region field is present', 'FINDING_INVALID_RECORD')
      }
      if (endLine !== undefined && startLine !== undefined && endLine < startLine) {
        throw new FindingError('location.endLine cannot precede startLine', 'FINDING_INVALID_RECORD')
      }
      return {
        kind: 'code',
        targetId: FindingTargetId(normalizedText(location.targetId, 'location.targetId')),
        uri: normalizedText(location.uri, 'location.uri'),
        ...startLine === undefined ? {} : { startLine },
        ...startColumn === undefined ? {} : { startColumn },
        ...endLine === undefined ? {} : { endLine },
        ...endColumn === undefined ? {} : { endColumn },
      }
    }
    case 'dependency':
      return {
        kind: 'dependency',
        targetId: FindingTargetId(normalizedText(location.targetId, 'location.targetId')),
        ecosystem: normalizedText(location.ecosystem, 'location.ecosystem'),
        packageName: normalizedText(location.packageName, 'location.packageName'),
        ...location.version === undefined ? {} : { version: normalizedText(location.version, 'location.version') },
        ...location.manifestUri === undefined
          ? {}
          : { manifestUri: normalizedText(location.manifestUri, 'location.manifestUri') },
      }
    /* v8 ignore next 2 -- FindingLocation is closed and durable values pass the discriminated schema. */
    default:
      return assertNever(location)
  }
}

/** Canonicalize and deduplicate locations. */
function normalizeLocations(locations: readonly FindingLocation[]): FindingLocation[] {
  const values = new Map<string, FindingLocation>()
  for (const location of locations.map(normalizeLocation)) values.set(canonicalJson(location), location)
  return sortedMapValues(values)
}

/** Normalize one Artifact-backed evidence entry. */
function normalizeEvidenceEntry(evidence: FindingEvidence): FindingEvidence {
  return {
    role: evidence.role,
    artifact: evidence.artifact,
    ...evidence.note === undefined ? {} : { note: normalizedText(evidence.note, 'evidence.note') },
  }
}

/** Canonicalize evidence and reject one key with conflicting metadata. */
function normalizeEvidence(evidence: readonly FindingEvidence[]): FindingEvidence[] {
  const values = new Map<string, FindingEvidence>()
  for (const entry of evidence.map(normalizeEvidenceEntry)) {
    const key = `${String(EVIDENCE_ROLE_ORDER[entry.role]).padStart(2, '0')}:${entry.artifact.artifactId}`
    const current = values.get(key)
    if (current !== undefined && canonicalJson(current) !== canonicalJson(entry)) {
      throw new FindingError(`evidence ${JSON.stringify(key)} has conflicting metadata`, 'FINDING_INVALID_RECORD')
    }
    values.set(key, entry)
  }
  return sortedMapValues(values)
}

/**
 * Normalize one trusted Consumer attribution.
 * @param source - Consumer attribution supplied at a typed same-process call.
 * @returns Canonical provenance fields.
 */
export function resolveFindingProvenance(source: FindingProvenance): FindingProvenance {
  return {
    pluginId: normalizedText(source.pluginId, 'provenance.pluginId'),
    pluginVersion: normalizedText(source.pluginVersion, 'provenance.pluginVersion'),
    toolName: normalizedText(source.toolName, 'provenance.toolName'),
  }
}

/** Canonicalize a provenance union. */
function normalizeProvenance(values: readonly FindingProvenance[]): FindingProvenance[] {
  const entries = new Map<string, FindingProvenance>()
  for (const source of values.map(resolveFindingProvenance)) entries.set(canonicalJson(source), source)
  return sortedMapValues(entries)
}

/** Normalize a CVSS declaration. */
function normalizeCvss(cvss: FindingCvss): FindingCvss {
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- parser-boundary callers can supply invalid tags.
  if ((cvss.version !== '3.1' && cvss.version !== '4.0')
    || !Number.isFinite(cvss.score) || cvss.score < 0 || cvss.score > 10) {
    throw new FindingError('cvss version or score is invalid', 'FINDING_INVALID_RECORD')
  }
  return { version: cvss.version, vector: normalizedText(cvss.vector, 'cvss.vector'), score: cvss.score }
}

/** Normalize typed reachability. */
function normalizeReachability(reachability: FindingReachability): FindingReachability {
  switch (reachability.kind) {
    case 'unknown':
      return { kind: 'unknown' }
    case 'unreachable':
      return { kind: 'unreachable', reason: normalizedText(reachability.reason, 'reachability.reason') }
    case 'reachable':
      return {
        kind: 'reachable',
        entrypoint: normalizedText(reachability.entrypoint, 'reachability.entrypoint'),
        ...reachability.pathEvidence === undefined ? {} : { pathEvidence: reachability.pathEvidence },
      }
    /* v8 ignore next 2 -- FindingReachability is closed and durable values pass the discriminated schema. */
    default:
      return assertNever(reachability)
  }
}

/**
 * Build the canonical identity retained beside its digest.
 * @param ruleId - Stable detector rule id.
 * @param targetIds - Affected target ids.
 * @param locations - Canonical identity locations.
 * @returns NFC-normalized, sorted, deduplicated identity fields.
 */
export function canonicalFindingIdentity(
  ruleId: FindingRuleIdType,
  targetIds: readonly FindingTargetIdType[],
  locations: readonly FindingLocation[],
): FindingIdentity {
  return {
    ruleId: FindingRuleId(normalizedText(ruleId, 'ruleId')),
    targetIds: normalizedStrings(targetIds, 'targetId').map(FindingTargetId),
    locations: normalizeLocations(locations),
  }
}

/**
 * Hash one canonical identity as lowercase SHA-256.
 * @param identity - Identity fields to canonicalize and hash.
 * @returns Branded lowercase SHA-256 fingerprint.
 */
export function fingerprintFindingIdentity(identity: FindingIdentity): FindingFingerprintType {
  const canonical = canonicalFindingIdentity(identity.ruleId, identity.targetIds, identity.locations)
  return FindingFingerprint(createHash('sha256').update(canonicalJson(canonical), 'utf8').digest('hex'))
}

/**
 * Derive the stable finding id from the complete fingerprint.
 * @param fingerprint - Complete canonical identity fingerprint.
 * @returns Stable branded finding id.
 */
export function findingIdFromFingerprint(fingerprint: FindingFingerprintType): FindingIdType {
  return FindingId(`finding-${fingerprint}`)
}

/**
 * Resolve one caller record into canonical deterministic fields.
 * @param request - Typed finding facts supplied by a Consumer.
 * @returns Validated fields ready for mutation construction.
 */
export function resolveFindingRecord(request: FindingRecordRequest): ResolvedFindingRecord {
  if (!INITIAL_STATES.has(request.state)) {
    throw new FindingError(`state ${JSON.stringify(request.state)} cannot be recorded initially`, 'FINDING_INVALID_RECORD')
  }
  const targets = normalizeTargets(request.targets)
  const locations = normalizeLocations(request.locations)
  const targetIds = targets.map(target => target.id)
  const targetSet = new Set(targetIds)
  const missing = locations.find(location => !targetSet.has(location.targetId))
  if (missing !== undefined) {
    throw new FindingError(`location target ${JSON.stringify(missing.targetId)} is not declared`, 'FINDING_INVALID_RECORD')
  }
  const ruleId = FindingRuleId(normalizedText(request.ruleId, 'ruleId'))
  const identity = canonicalFindingIdentity(ruleId, targetIds, locations)
  const fingerprint = fingerprintFindingIdentity(identity)
  const evidence = normalizeEvidence(request.evidence ?? [])
  if (request.state === 'reproduced-vulnerability' && !evidence.some(entry => entry.role === 'reproduction')) {
    throw new FindingError('reproduced-vulnerability requires reproduction evidence', 'FINDING_INVALID_RECORD')
  }
  return {
    id: findingIdFromFingerprint(fingerprint),
    fingerprint,
    identity,
    ruleId,
    title: normalizedText(request.title, 'title'),
    summary: normalizedText(request.summary, 'summary'),
    state: request.state,
    severity: request.severity,
    confidence: request.confidence,
    targets,
    locations,
    cweIds: normalizeCweIds(request.cweIds ?? []),
    cveIds: normalizeCveIds(request.cveIds ?? []),
    ...request.cvss === undefined ? {} : { cvss: normalizeCvss(request.cvss) },
    assumptions: normalizedStrings(request.assumptions ?? [], 'assumption'),
    reachability: normalizeReachability(request.reachability),
    evidence,
  }
}

/**
 * Resolve one caller transition into canonical fields.
 * @param request - Requested lifecycle state and added evidence.
 * @returns Validated fields ready for transition construction.
 */
export function resolveFindingTransition(request: FindingTransitionRequest): ResolvedFindingTransition {
  if (!TRANSITION_STATES.has(request.to)) {
    throw new FindingError(`state ${JSON.stringify(request.to)} is not a transition target`, 'FINDING_INVALID_TRANSITION')
  }
  return {
    to: request.to,
    evidence: normalizeEvidence(request.evidence ?? []),
    ...request.fixGuidance === undefined
      ? {}
      : { fixGuidance: normalizedText(request.fixGuidance, 'fixGuidance') },
  }
}

/** Require one safe mutation timestamp. */
function mutationTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new FindingError('mutation time must be a non-negative safe integer', 'FINDING_INVALID_RECORD')
  }
  return now
}

/** Return a canonical set union. */
function unionByCanonical<T>(left: readonly T[], right: readonly T[]): T[] {
  const values = new Map<string, T>()
  for (const value of [...left, ...right]) values.set(canonicalJson(value), value)
  return sortedMapValues(values)
}

/** Validate state-specific evidence and remediation requirements. */
function assertFindingPrerequisites(snapshot: FindingSnapshot): void {
  const reproduced = snapshot.evidence.some(entry => entry.role === 'reproduction')
  if ((snapshot.state === 'reproduced-vulnerability' || snapshot.state === 'remediation') && !reproduced) {
    throw new Error(`${snapshot.state} requires reproduction evidence`)
  }
  if (snapshot.state === 'remediation') {
    if (snapshot.fixGuidance === undefined
      || !snapshot.evidence.some(entry => entry.role === 'remediation-validation')) {
      throw new Error('remediation requires fix guidance and remediation-validation evidence')
    }
  } else if (snapshot.fixGuidance !== undefined) {
    throw new Error('fixGuidance is valid only in remediation state')
  }
}

/**
 * Assert that a snapshot is the exact canonical representation of its facts.
 * @param snapshot - Snapshot decoded from or prepared for durable storage.
 */
export function assertCanonicalFindingSnapshot(snapshot: FindingSnapshot): void {
  const normalizedTargets = normalizeTargets(snapshot.targets)
  const normalizedLocations = normalizeLocations(snapshot.locations)
  const identity = canonicalFindingIdentity(snapshot.ruleId, normalizedTargets.map(target => target.id), normalizedLocations)
  const fingerprint = fingerprintFindingIdentity(identity)
  const comparisons: readonly [string, unknown, unknown][] = [
    ['identity', snapshot.identity, identity],
    ['targets', snapshot.targets, normalizedTargets],
    ['locations', snapshot.locations, normalizedLocations],
    ['cweIds', snapshot.cweIds, normalizeCweIds(snapshot.cweIds)],
    ['cveIds', snapshot.cveIds, normalizeCveIds(snapshot.cveIds)],
    ['assumptions', snapshot.assumptions, normalizedStrings(snapshot.assumptions, 'assumption')],
    ['reachability', snapshot.reachability, normalizeReachability(snapshot.reachability)],
    ['evidence', snapshot.evidence, normalizeEvidence(snapshot.evidence)],
    ['provenance', snapshot.provenance, normalizeProvenance(snapshot.provenance)],
  ]
  for (const [field, actual, expected] of comparisons) {
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`finding ${field} is not canonical`)
  }
  if (snapshot.ruleId !== identity.ruleId || snapshot.fingerprint !== fingerprint
    || snapshot.id !== findingIdFromFingerprint(fingerprint)) {
    throw new Error('finding id, fingerprint, identity, and ruleId disagree')
  }
  if (snapshot.title !== normalizedText(snapshot.title, 'title')
    || snapshot.summary !== normalizedText(snapshot.summary, 'summary')
    || (snapshot.fixGuidance !== undefined
      && snapshot.fixGuidance !== normalizedText(snapshot.fixGuidance, 'fixGuidance'))) {
    throw new Error('finding text fields are not canonical')
  }
  if (snapshot.cvss !== undefined && canonicalJson(snapshot.cvss) !== canonicalJson(normalizeCvss(snapshot.cvss))) {
    throw new Error('finding cvss is not canonical')
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1
    || !Number.isSafeInteger(snapshot.occurrences) || snapshot.occurrences < 1
    || !Number.isSafeInteger(snapshot.createdAt) || snapshot.createdAt < 0
    || !Number.isSafeInteger(snapshot.updatedAt) || snapshot.updatedAt < snapshot.createdAt) {
    throw new Error('finding revisions, occurrences, or timestamps are invalid')
  }
  assertFindingPrerequisites(snapshot)
}

/**
 * Build a new record or deterministic duplicate-occurrence change.
 * @param current - Current canonical snapshot for the same deterministic id.
 * @param record - Canonical record fields.
 * @param source - Trusted Consumer attribution.
 * @param now - Non-negative safe-integer mutation time.
 * @returns Complete durable finding change.
 */
export function buildFindingRecordChange(
  current: FindingSnapshot | undefined,
  record: ResolvedFindingRecord,
  source: FindingProvenance,
  now: number,
): FindingChange {
  const updatedAt = mutationTime(now)
  const provenance = normalizeProvenance([resolveFindingProvenance(source)])
  if (current === undefined) {
    const finding: FindingSnapshot = {
      id: record.id,
      revision: 1,
      fingerprint: record.fingerprint,
      identity: record.identity,
      ruleId: record.ruleId,
      title: record.title,
      summary: record.summary,
      state: record.state,
      severity: record.severity,
      confidence: record.confidence,
      targets: record.targets,
      locations: record.locations,
      cweIds: record.cweIds,
      cveIds: record.cveIds,
      ...record.cvss === undefined ? {} : { cvss: record.cvss },
      assumptions: record.assumptions,
      reachability: record.reachability,
      evidence: record.evidence,
      provenance,
      occurrences: 1,
      createdAt: updatedAt,
      updatedAt,
    }
    assertCanonicalFindingSnapshot(finding)
    return { kind: 'finding/change', version: 1, operation: 'record', previous: null, finding }
  }
  if (current.fingerprint !== record.fingerprint || canonicalJson(current.identity) !== canonicalJson(record.identity)) {
    throw new FindingError('deterministic finding fingerprint collision', 'FINDING_FINGERPRINT_COLLISION')
  }
  if (current.revision === Number.MAX_SAFE_INTEGER || current.occurrences === Number.MAX_SAFE_INTEGER) {
    throw new FindingError('finding revision or occurrence count is exhausted', 'FINDING_LIMIT_EXCEEDED')
  }
  const finding: FindingSnapshot = {
    ...current,
    revision: current.revision + 1,
    evidence: normalizeEvidence(unionByCanonical(current.evidence, record.evidence)),
    provenance: normalizeProvenance(unionByCanonical(current.provenance, provenance)),
    occurrences: current.occurrences + 1,
    updatedAt: Math.max(updatedAt, current.updatedAt),
  }
  assertCanonicalFindingSnapshot(finding)
  return {
    kind: 'finding/change',
    version: 1,
    operation: 'record',
    previous: { id: current.id, revision: current.revision },
    finding,
  }
}

/**
 * Whether one explicit lifecycle transition is permitted.
 * @param from - Current lifecycle state.
 * @param to - Requested lifecycle state.
 * @returns Whether the closed state graph contains the edge.
 */
export function canTransitionFinding(from: FindingState, to: FindingTransitionState): boolean {
  switch (from) {
    case 'observation':
      return to === 'hypothesis' || to === 'reproduced-vulnerability' || to === 'unresolved'
    case 'hypothesis':
      return to === 'reproduced-vulnerability' || to === 'unresolved'
    case 'reproduced-vulnerability':
      return to === 'remediation' || to === 'unresolved'
    case 'remediation':
    case 'unresolved':
      return false
    /* v8 ignore next 2 -- FindingState is closed and callers cannot construct another state. */
    default:
      return assertNever(from)
  }
}

/**
 * Build one CAS-protected lifecycle transition change.
 * @param current - Current canonical snapshot at the expected revision.
 * @param transition - Canonical transition fields.
 * @param source - Trusted Consumer attribution.
 * @param now - Non-negative safe-integer mutation time.
 * @returns Complete durable finding change.
 */
export function buildFindingTransitionChange(
  current: FindingSnapshot,
  transition: ResolvedFindingTransition,
  source: FindingProvenance,
  now: number,
): FindingChange {
  if (!canTransitionFinding(current.state, transition.to)) {
    throw new FindingError(
      `cannot transition finding ${JSON.stringify(current.id)} from ${current.state} to ${transition.to}`,
      'FINDING_INVALID_TRANSITION',
    )
  }
  if (transition.to !== 'remediation' && transition.fixGuidance !== undefined) {
    throw new FindingError('fixGuidance is valid only when entering remediation', 'FINDING_INVALID_TRANSITION')
  }
  if (transition.to === 'remediation' && transition.fixGuidance === undefined) {
    throw new FindingError('fixGuidance is required when entering remediation', 'FINDING_INVALID_TRANSITION')
  }
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    throw new FindingError('finding revision is exhausted', 'FINDING_LIMIT_EXCEEDED')
  }
  const finding: FindingSnapshot = {
    ...current,
    revision: current.revision + 1,
    state: transition.to,
    evidence: normalizeEvidence(unionByCanonical(current.evidence, transition.evidence)),
    provenance: normalizeProvenance(unionByCanonical(current.provenance, [resolveFindingProvenance(source)])),
    ...transition.fixGuidance === undefined ? {} : { fixGuidance: transition.fixGuidance },
    updatedAt: Math.max(mutationTime(now), current.updatedAt),
  }
  assertCanonicalFindingSnapshot(finding)
  return {
    kind: 'finding/change',
    version: 1,
    operation: 'transition',
    previous: { id: current.id, revision: current.revision },
    finding,
  }
}

/**
 * Decode a value that declares itself as a finding change.
 * @param value - Durable or parser-boundary value.
 * @returns A canonical finding change, or undefined for an unrelated value.
 */
export function decodeFindingChange(value: unknown): FindingChange | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || (value as Record<string, unknown>)['kind'] !== 'finding/change') return undefined
  const parsed = changeSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    /* v8 ignore next 2 -- every failed Zod parse contains at least one issue. */
    if (issue === undefined) throw new Error('malformed finding change has no validation issue')
    throw new Error(`malformed finding change at ${issue.path.join('.')}: ${issue.message}`)
  }
  assertCanonicalFindingSnapshot(parsed.data.finding)
  return parsed.data
}

/**
 * Build an empty strict replay accumulator.
 * @returns Mutable state with no current findings.
 */
export function emptyFindingFoldState(): FindingFoldState {
  return { findings: new Map() }
}

/**
 * Copy strict fold state before staging one candidate event.
 * @param state - Current strict replay accumulator.
 * @returns A shallow copy with an independent findings map.
 */
export function cloneFindingFoldState(state: FindingFoldState): FindingFoldState {
  return { findings: new Map(state.findings) }
}

/** Require one change to reference the exact current revision. */
function requireCurrent(previous: FindingRef | null, current: FindingSnapshot, operation: string): void {
  if (previous === null || previous.id !== current.id || previous.revision !== current.revision) {
    throw new Error(`finding ${operation} previous ref does not match the current revision`)
  }
}

/** Require every current canonical member to survive a union. */
function requireSuperset<T>(current: readonly T[], next: readonly T[], field: string): void {
  const values = new Set(next.map(canonicalJson))
  if (current.some(value => !values.has(canonicalJson(value)))) {
    throw new Error(`finding ${field} cannot remove current members`)
  }
}

/** Compare fields that record and transition operations cannot edit. */
function preservedDefinition(snapshot: FindingSnapshot): unknown {
  return {
    id: snapshot.id,
    fingerprint: snapshot.fingerprint,
    identity: snapshot.identity,
    ruleId: snapshot.ruleId,
    title: snapshot.title,
    summary: snapshot.summary,
    severity: snapshot.severity,
    confidence: snapshot.confidence,
    targets: snapshot.targets,
    locations: snapshot.locations,
    cweIds: snapshot.cweIds,
    cveIds: snapshot.cveIds,
    ...snapshot.cvss === undefined ? {} : { cvss: snapshot.cvss },
    assumptions: snapshot.assumptions,
    reachability: snapshot.reachability,
    createdAt: snapshot.createdAt,
  }
}

/**
 * Apply one decoded finding change to a mutable strict accumulator.
 * @param state - Mutable strict replay accumulator.
 * @param change - Canonical change to validate and apply.
 */
export function applyFindingChange(state: FindingFoldState, change: FindingChange): void {
  assertCanonicalFindingSnapshot(change.finding)
  const next = change.finding
  const current = state.findings.get(next.id)
  if (current === undefined) {
    if (change.operation !== 'record' || change.previous !== null || next.revision !== 1
      || next.occurrences !== 1 || next.createdAt !== next.updatedAt || !INITIAL_STATES.has(next.state as FindingInitialState)) {
      throw new Error('new finding requires a revision-one initial record with one occurrence')
    }
    state.findings.set(next.id, next)
    return
  }
  requireCurrent(change.previous, current, change.operation)
  if (next.revision !== current.revision + 1 || next.updatedAt < current.updatedAt
    || canonicalJson(preservedDefinition(next)) !== canonicalJson(preservedDefinition(current))) {
    throw new Error(`finding ${change.operation} must advance one revision and preserve its definition`)
  }
  requireSuperset(current.evidence, next.evidence, 'evidence')
  requireSuperset(current.provenance, next.provenance, 'provenance')
  if (change.operation === 'record') {
    if (next.state !== current.state || next.occurrences !== current.occurrences + 1
      || next.fixGuidance !== current.fixGuidance) {
      throw new Error('duplicate finding record may only add evidence, provenance, and one occurrence')
    }
  } else {
    if (!canTransitionFinding(current.state, next.state as FindingTransitionState)
      || next.occurrences !== current.occurrences) {
      throw new Error('finding transition has an invalid state edge or mutable field')
    }
  }
  state.findings.set(next.id, next)
}

/**
 * Apply one Session event to the strict finding fold.
 * @param state - Mutable strict replay accumulator.
 * @param event - Next Session event in sequence order.
 */
export function applyFindingEvent(state: FindingFoldState, event: SessionEvent): void {
  if (event.type !== 'finding/change') return
  const change = decodeFindingChange(event.data)
  /* v8 ignore next -- the declared event payload always names its own kind. */
  if (change === undefined) throw new Error(`finding change at session event ${event.seq} has an invalid kind`)
  applyFindingChange(state, change)
}

/**
 * Fold all current finding snapshots from one contiguous Session log.
 * @param events - Authoritative Session events in sequence order.
 * @returns Current snapshots in deterministic finding-id order.
 */
export function foldFindings(events: readonly SessionEvent[]): readonly FindingSnapshot[] {
  const state = emptyFindingFoldState()
  for (const event of events) applyFindingEvent(state, event)
  return sortedMapValues(state.findings)
}
