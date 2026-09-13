/**
 * Service Definition for `ctx.assessmentScope`: canonical assessment grants,
 * deterministic operation decisions, child narrowing, and pure Session replay.
 * Effect adapters remain separate Consumers and must call the session runtime
 * before performing their backend effect.
 *
 * @module @deepseek-ai/dsh-assessment-scope
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection/types'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type {
  AssessmentAction,
  AssessmentAuthorizationRef as AssessmentAuthorizationRefValue,
  AssessmentChildGrantRequest,
  AssessmentCredentialGrant,
  AssessmentCredentialPurpose,
  AssessmentDecision,
  AssessmentDecisionCode,
  AssessmentDecisionId as AssessmentDecisionIdValue,
  AssessmentDecisionOutcome,
  AssessmentEgressGrant,
  AssessmentEgressProtocol,
  AssessmentEgressPurpose,
  AssessmentEngagementId as AssessmentEngagementIdValue,
  AssessmentEvidencePolicy,
  AssessmentEvidenceRedaction,
  AssessmentExternalReportingPolicy,
  AssessmentGrant,
  AssessmentGrantId as AssessmentGrantIdValue,
  AssessmentGrantStatus,
  AssessmentOperation,
  AssessmentScopeProjection,
  AssessmentTarget,
  AssessmentTargetId as AssessmentTargetIdValue,
  AssessmentTargetKind,
} from './types.ts'

export type * from './types.ts'
import './types.ts'

/** Closed action order used for validation and canonical serialization. */
export const ASSESSMENT_ACTIONS = Object.freeze([
  'reconnaissance',
  'active-validation',
  'credential-use',
  'persistence-change',
  'exploit-execution',
  'destructive-operation',
  'report-download',
  'data-export',
  'external-reporting',
] as const satisfies readonly AssessmentAction[])

/** Closed target-kind order used for config and durable validation. */
export const ASSESSMENT_TARGET_KINDS = Object.freeze([
  'hostname',
  'ip-address',
  'url-prefix',
  'artifact-scope',
  'service',
] as const satisfies readonly AssessmentTargetKind[])

/** Closed egress-protocol order used for config and durable validation. */
export const ASSESSMENT_EGRESS_PROTOCOLS = Object.freeze([
  'http',
  'https',
  'tcp',
  'udp',
] as const satisfies readonly AssessmentEgressProtocol[])

/** Closed egress-purpose order used for config and durable validation. */
export const ASSESSMENT_EGRESS_PURPOSES = Object.freeze([
  'model-provider',
  'web-search',
  'target-access',
  'artifact-export',
  'external-reporting',
] as const satisfies readonly AssessmentEgressPurpose[])

/** Closed credential-purpose order used for config and durable validation. */
export const ASSESSMENT_CREDENTIAL_PURPOSES = Object.freeze([
  'model-provider',
  'web-search',
  'target-authentication',
  'artifact-store',
  'external-reporting',
] as const satisfies readonly AssessmentCredentialPurpose[])

/** Closed evidence-redaction order from weakest to strongest. */
export const ASSESSMENT_EVIDENCE_REDACTIONS = Object.freeze([
  'none',
  'secrets',
  'sensitive',
] as const satisfies readonly AssessmentEvidenceRedaction[])

/** Closed external-reporting order from most restrictive to least restrictive. */
export const ASSESSMENT_EXTERNAL_REPORTING_POLICIES = Object.freeze([
  'deny',
  'approval-required',
  'allow',
] as const satisfies readonly AssessmentExternalReportingPolicy[])

/** Closed stable decision-code order used by projection wire validation. */
export const ASSESSMENT_DECISION_CODES = Object.freeze([
  'ASSESSMENT_ALLOWED',
  'ASSESSMENT_APPROVAL_REQUIRED',
  'ASSESSMENT_GRANT_MISMATCH',
  'ASSESSMENT_NOT_YET_VALID',
  'ASSESSMENT_EXPIRED',
  'ASSESSMENT_HOST_OUT_OF_SCOPE',
  'ASSESSMENT_TARGET_EXCLUDED',
  'ASSESSMENT_TARGET_OUT_OF_SCOPE',
  'ASSESSMENT_ACTION_OUT_OF_SCOPE',
  'ASSESSMENT_EGRESS_REQUIRED',
  'ASSESSMENT_EGRESS_OUT_OF_SCOPE',
  'ASSESSMENT_CREDENTIAL_REQUIRED',
  'ASSESSMENT_CREDENTIAL_OUT_OF_SCOPE',
  'ASSESSMENT_EVIDENCE_REQUIRED',
  'ASSESSMENT_EVIDENCE_RETENTION_OUT_OF_SCOPE',
  'ASSESSMENT_EVIDENCE_REDACTION_OUT_OF_SCOPE',
  'ASSESSMENT_EXTERNAL_REPORTING_DENIED',
] as const satisfies readonly AssessmentDecisionCode[])

const ACTION_ORDER: Readonly<Record<AssessmentAction, number>> = Object.freeze({
  'reconnaissance': 0,
  'active-validation': 1,
  'credential-use': 2,
  'persistence-change': 3,
  'exploit-execution': 4,
  'destructive-operation': 5,
  'report-download': 6,
  'data-export': 7,
  'external-reporting': 8,
})
const REDACTION_ORDER = new Map(ASSESSMENT_EVIDENCE_REDACTIONS.map((value, index) => [value, index]))
const REPORTING_ORDER = new Map(ASSESSMENT_EXTERNAL_REPORTING_POLICIES.map((value, index) => [value, index]))

/** Error raised when a grant, operation, or provider relation violates assessment-scope rules. */
export class AssessmentScopeError extends Error {
  /**
   * @param message - Human-readable failure description.
   * @param code - Stable machine-readable failure code.
   */
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'AssessmentScopeError'
  }
}

function validId(label: string, value: string): string {
  if (value.length === 0 || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`assessment-scope: ${label} must be non-blank, trimmed, and contain no control characters`)
  }
  return value
}

/**
 * Brand a validated engagement identifier.
 * @param value - Non-blank trimmed identifier without control characters.
 * @returns Branded engagement identifier.
 */
export function AssessmentEngagementId(value: string): AssessmentEngagementIdValue {
  return validId('engagement id', value) as AssessmentEngagementIdValue
}

/**
 * Brand a validated grant identifier.
 * @param value - Non-blank trimmed identifier without control characters.
 * @returns Branded grant identifier.
 */
export function AssessmentGrantId(value: string): AssessmentGrantIdValue {
  return validId('grant id', value) as AssessmentGrantIdValue
}

/**
 * Brand a validated target identifier.
 * @param value - Non-blank trimmed identifier without control characters.
 * @returns Branded target identifier.
 */
export function AssessmentTargetId(value: string): AssessmentTargetIdValue {
  return validId('target id', value) as AssessmentTargetIdValue
}

/**
 * Brand a validated decision identifier.
 * @param value - Non-blank trimmed identifier without control characters.
 * @returns Branded decision identifier.
 */
export function AssessmentDecisionId(value: string): AssessmentDecisionIdValue {
  return validId('decision id', value) as AssessmentDecisionIdValue
}

/**
 * Brand a validated written-authorization reference.
 * @param value - Non-blank trimmed reference without control characters.
 * @returns Branded written-authorization reference.
 */
export function AssessmentAuthorizationRef(value: string): AssessmentAuthorizationRefValue {
  return validId('authorization ref', value) as AssessmentAuthorizationRefValue
}

function invalid(path: string, message: string): never {
  throw new AssessmentScopeError(`${path}: ${message}`, 'ASSESSMENT_GRANT_INVALID')
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid(path, 'expected a plain object')
  }
  const prototype = Reflect.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return invalid(path, 'expected a plain object')
  return value as Record<string, unknown>
}

function keysOnly(value: Record<string, unknown>, path: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed)
  const extra = Object.keys(value).find(key => !allowedSet.has(key))
  if (extra !== undefined) invalid(path, `unknown field ${JSON.stringify(extra)}`)
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') return invalid(path, 'expected a string')
  return value
}

function safeInteger(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return invalid(path, `expected a safe integer from ${minimum} through ${maximum}`)
  }
  return value
}

function arrayValue(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalid(path, 'expected an array')
  return value
}

function enumValue<T extends string>(value: unknown, path: string, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    return invalid(path, `expected one of ${values.join(', ')}`)
  }
  return value as T
}

function optional<T>(value: unknown, read: (present: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value)
}

function sortedUnique<T>(values: readonly T[], key: (value: T) => string, path: string): readonly T[] {
  const sorted = [...values].sort((left, right) => {
    const leftKey = key(left)
    const rightKey = key(right)
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index]
    const previous = sorted[index - 1]
    /* v8 ignore next -- loop bounds prove both indexed values exist */
    if (current === undefined || previous === undefined) invalid(path, 'internal canonicalization failure')
    if (key(current) === key(previous)) invalid(path, `duplicate entry ${JSON.stringify(key(current))}`)
  }
  return Object.freeze(sorted)
}

function normalizeHost(value: unknown, path: string): string {
  const raw = stringValue(value, path)
  if (raw.trim() !== raw || raw.length === 0) invalid(path, 'must be non-blank and trimmed')
  if (/\s|[\u0000-\u001f\u007f]/.test(raw)) invalid(path, 'must contain no whitespace or control characters')
  const normalized = raw.toLowerCase().replace(/\.$/, '')
  if (normalized.length === 0) invalid(path, 'must contain a host name')
  return normalized
}

function canonicalTarget(value: unknown, path: string): AssessmentTarget {
  const input = record(value, path)
  keysOnly(input, path, ['id', 'kind', 'value'])
  const kind = enumValue(input['kind'], `${path}.kind`, ASSESSMENT_TARGET_KINDS)
  const rawValue = stringValue(input['value'], `${path}.value`)
  if (rawValue.trim() !== rawValue || rawValue.length === 0) invalid(`${path}.value`, 'must be non-blank and trimmed')
  const targetValue = kind === 'hostname' ? normalizeHost(rawValue, `${path}.value`) : rawValue
  return Object.freeze({
    id: AssessmentTargetId(stringValue(input['id'], `${path}.id`)),
    kind,
    value: targetValue,
  })
}

function egressKey(value: AssessmentEgressGrant): string {
  return `${value.targetId}\u0000${value.protocol}\u0000${value.host}\u0000${String(value.port).padStart(5, '0')}\u0000${value.purpose}`
}

function canonicalEgress(value: unknown, path: string): AssessmentEgressGrant {
  const input = record(value, path)
  keysOnly(input, path, ['protocol', 'host', 'port', 'purpose', 'targetId'])
  return Object.freeze({
    protocol: enumValue(input['protocol'], `${path}.protocol`, ASSESSMENT_EGRESS_PROTOCOLS),
    host: normalizeHost(input['host'], `${path}.host`),
    port: safeInteger(input['port'], `${path}.port`, 1, 65_535),
    purpose: enumValue(input['purpose'], `${path}.purpose`, ASSESSMENT_EGRESS_PURPOSES),
    targetId: AssessmentTargetId(stringValue(input['targetId'], `${path}.targetId`)),
  })
}

function credentialKey(value: AssessmentCredentialGrant): string {
  return `${value.targetId}\u0000${value.ref}\u0000${value.purpose}`
}

function canonicalCredential(value: unknown, path: string): AssessmentCredentialGrant {
  const input = record(value, path)
  keysOnly(input, path, ['ref', 'purpose', 'targetId'])
  return Object.freeze({
    ref: credentialRef(stringValue(input['ref'], `${path}.ref`)),
    purpose: enumValue(input['purpose'], `${path}.purpose`, ASSESSMENT_CREDENTIAL_PURPOSES),
    targetId: AssessmentTargetId(stringValue(input['targetId'], `${path}.targetId`)),
  })
}

function canonicalEvidence(value: unknown, path: string): AssessmentEvidencePolicy {
  const input = record(value, path)
  keysOnly(input, path, ['retainUntil', 'minimumRedaction', 'externalReporting'])
  return Object.freeze({
    retainUntil: safeInteger(input['retainUntil'], `${path}.retainUntil`),
    minimumRedaction: enumValue(
      input['minimumRedaction'],
      `${path}.minimumRedaction`,
      ASSESSMENT_EVIDENCE_REDACTIONS,
    ),
    externalReporting: enumValue(
      input['externalReporting'],
      `${path}.externalReporting`,
      ASSESSMENT_EXTERNAL_REPORTING_POLICIES,
    ),
  })
}

function canonicalIdArray<T extends string>(
  value: unknown,
  path: string,
  read: (entry: string) => T,
): readonly T[] {
  return sortedUnique(
    arrayValue(value, path).map((entry, index) => read(stringValue(entry, `${path}[${index}]`))),
    entry => entry,
    path,
  )
}

function canonicalActions(value: unknown, path: string): readonly AssessmentAction[] {
  const entries = arrayValue(value, path).map((entry, index) => (
    enumValue(entry, `${path}[${index}]`, ASSESSMENT_ACTIONS)
  ))
  const unique = sortedUnique(entries, entry => entry, path)
  return Object.freeze([...unique].sort((left, right) => (
    ACTION_ORDER[left] - ACTION_ORDER[right]
  )))
}

/**
 * Validate, normalize, detach, sort, and deeply freeze one grant from config or durable JSON.
 * @param value - Candidate grant at a parser, durable, worker, process, or wire boundary.
 * @returns Canonical immutable grant.
 */
export function canonicalizeAssessmentGrant(value: unknown): AssessmentGrant {
  const input = record(value, 'assessment grant')
  keysOnly(input, 'assessment grant', [
    'version',
    'engagementId',
    'grantId',
    'parentGrantId',
    'authorizationRef',
    'notBefore',
    'expiresAt',
    'executionHostIds',
    'targets',
    'excludedTargetIds',
    'actions',
    'approvalRequiredActions',
    'egress',
    'credentials',
    'evidence',
  ])
  if (input['version'] !== 1) invalid('assessment grant.version', 'expected 1')

  const grantId = AssessmentGrantId(stringValue(input['grantId'], 'assessment grant.grantId'))
  const parentGrantId = optional(input['parentGrantId'], present => (
    AssessmentGrantId(stringValue(present, 'assessment grant.parentGrantId'))
  ))
  if (parentGrantId === grantId) invalid('assessment grant.parentGrantId', 'must differ from grantId')

  const notBefore = safeInteger(input['notBefore'], 'assessment grant.notBefore')
  const expiresAt = safeInteger(input['expiresAt'], 'assessment grant.expiresAt')
  if (notBefore >= expiresAt) invalid('assessment grant', 'notBefore must be smaller than expiresAt')

  const executionHostIds = canonicalIdArray(
    input['executionHostIds'],
    'assessment grant.executionHostIds',
    ExecutionHostId,
  )
  const targets = sortedUnique(
    arrayValue(input['targets'], 'assessment grant.targets').map((entry, index) => (
      canonicalTarget(entry, `assessment grant.targets[${index}]`)
    )),
    target => target.id,
    'assessment grant.targets',
  )
  const targetIds = new Set(targets.map(target => target.id))
  const excludedTargetIds = canonicalIdArray(
    input['excludedTargetIds'],
    'assessment grant.excludedTargetIds',
    AssessmentTargetId,
  )
  for (const id of excludedTargetIds) {
    if (!targetIds.has(id)) invalid('assessment grant.excludedTargetIds', `unknown target ${JSON.stringify(id)}`)
  }

  const actions = canonicalActions(input['actions'], 'assessment grant.actions')
  const approvalRequiredActions = canonicalActions(
    input['approvalRequiredActions'],
    'assessment grant.approvalRequiredActions',
  )
  const actionSet = new Set(actions)
  for (const action of approvalRequiredActions) {
    if (!actionSet.has(action)) {
      invalid('assessment grant.approvalRequiredActions', `action ${JSON.stringify(action)} is not allowed`)
    }
  }

  const egress = sortedUnique(
    arrayValue(input['egress'], 'assessment grant.egress').map((entry, index) => (
      canonicalEgress(entry, `assessment grant.egress[${index}]`)
    )),
    egressKey,
    'assessment grant.egress',
  )
  for (const entry of egress) {
    if (!targetIds.has(entry.targetId)) invalid('assessment grant.egress', `unknown target ${JSON.stringify(entry.targetId)}`)
  }

  const credentials = sortedUnique(
    arrayValue(input['credentials'], 'assessment grant.credentials').map((entry, index) => (
      canonicalCredential(entry, `assessment grant.credentials[${index}]`)
    )),
    credentialKey,
    'assessment grant.credentials',
  )
  for (const entry of credentials) {
    if (!targetIds.has(entry.targetId)) {
      invalid('assessment grant.credentials', `unknown target ${JSON.stringify(entry.targetId)}`)
    }
  }

  return Object.freeze({
    version: 1,
    engagementId: AssessmentEngagementId(stringValue(input['engagementId'], 'assessment grant.engagementId')),
    grantId,
    ...(parentGrantId === undefined ? {} : { parentGrantId }),
    authorizationRef: AssessmentAuthorizationRef(
      stringValue(input['authorizationRef'], 'assessment grant.authorizationRef'),
    ),
    notBefore,
    expiresAt,
    executionHostIds,
    targets,
    excludedTargetIds,
    actions,
    approvalRequiredActions,
    egress,
    credentials,
    evidence: canonicalEvidence(input['evidence'], 'assessment grant.evidence'),
  })
}

function setContains<T>(parent: readonly T[], child: readonly T[], key: (entry: T) => string): boolean {
  const available = new Set(parent.map(key))
  return child.every(entry => available.has(key(entry)))
}

function subsetViolation(parent: AssessmentGrant, child: AssessmentGrant): string | undefined {
  if (child.engagementId !== parent.engagementId) return 'engagementId differs'
  if (child.authorizationRef !== parent.authorizationRef) return 'authorizationRef differs'
  if (child.notBefore < parent.notBefore) return 'notBefore starts before the parent'
  if (child.expiresAt > parent.expiresAt) return 'expiresAt extends past the parent'
  if (!setContains(parent.executionHostIds, child.executionHostIds, value => value)) return 'executionHostIds expand the parent'
  if (!setContains(parent.targets, child.targets, target => `${target.id}\u0000${target.kind}\u0000${target.value}`)) {
    return 'targets expand or redefine the parent'
  }
  const childTargetIds = new Set(child.targets.map(target => target.id))
  const childExcluded = new Set(child.excludedTargetIds)
  for (const excluded of parent.excludedTargetIds) {
    if (childTargetIds.has(excluded) && !childExcluded.has(excluded)) return 'excludedTargetIds remove a parent exclusion'
  }
  if (!setContains(parent.actions, child.actions, value => value)) return 'actions expand the parent'
  const childActions = new Set(child.actions)
  const childApprovals = new Set(child.approvalRequiredActions)
  for (const action of parent.approvalRequiredActions) {
    if (childActions.has(action) && !childApprovals.has(action)) return 'approvalRequiredActions relax the parent'
  }
  if (!setContains(parent.egress, child.egress, egressKey)) return 'egress expands the parent'
  if (!setContains(parent.credentials, child.credentials, credentialKey)) return 'credentials expand the parent'
  /* v8 ignore next -- canonical grants contain only declared redaction values */
  if ((REDACTION_ORDER.get(child.evidence.minimumRedaction) ?? -1)
    < (REDACTION_ORDER.get(parent.evidence.minimumRedaction) ?? -1)) return 'minimumRedaction weakens the parent'
  if (child.evidence.retainUntil > parent.evidence.retainUntil) return 'retainUntil extends past the parent'
  /* v8 ignore next -- canonical grants contain only declared reporting values */
  if ((REPORTING_ORDER.get(child.evidence.externalReporting) ?? -1)
    > (REPORTING_ORDER.get(parent.evidence.externalReporting) ?? -1)) return 'externalReporting relaxes the parent'
  return undefined
}

/**
 * Test whether every child permission is contained by a parent grant.
 * @param parent - Candidate authority ceiling.
 * @param child - Candidate equal or narrower grant.
 * @returns Whether the child does not expand any policy dimension.
 */
export function isAssessmentGrantSubset(parent: AssessmentGrant, child: AssessmentGrant): boolean {
  return subsetViolation(parent, child) === undefined
}

function resolveChildIdArray<T extends string>(
  supplied: readonly T[] | undefined,
  inherited: readonly T[],
  label: string,
): readonly T[] {
  return sortedUnique(supplied ?? inherited, entry => entry, label)
}

/**
 * Resolve optional child restrictions, validate every subset dimension, and freeze the child grant.
 * @param parentValue - Parent grant whose authority is the hard ceiling.
 * @param request - Child id plus optional equal-or-narrower restrictions.
 * @returns Canonical immutable child grant.
 */
export function deriveAssessmentChildGrant(
  parentValue: AssessmentGrant,
  request: AssessmentChildGrantRequest,
): AssessmentGrant {
  const parent = canonicalizeAssessmentGrant(parentValue)
  const grantId = AssessmentGrantId(request.grantId)
  if (grantId === parent.grantId) {
    throw new AssessmentScopeError('assessment child grant id must differ from its parent', 'ASSESSMENT_GRANT_NOT_SUBSET')
  }
  const executionHostIds = resolveChildIdArray(
    request.executionHostIds,
    parent.executionHostIds,
    'assessment child executionHostIds',
  )
  const targetIds = resolveChildIdArray(
    request.targetIds,
    parent.targets.map(target => target.id),
    'assessment child targetIds',
  )
  const selectedTargets = new Set(targetIds)
  const targets = parent.targets.filter(target => selectedTargets.has(target.id))
  if (targets.length !== targetIds.length) {
    throw new AssessmentScopeError('assessment child targetIds expand the parent', 'ASSESSMENT_GRANT_NOT_SUBSET')
  }
  const excludedTargetIds = resolveChildIdArray(
    request.excludedTargetIds,
    parent.excludedTargetIds.filter(id => selectedTargets.has(id)),
    'assessment child excludedTargetIds',
  )
  const actions = request.actions === undefined
    ? parent.actions
    : canonicalActions(request.actions, 'assessment child actions')
  const approvalRequiredActions = request.approvalRequiredActions === undefined
    ? parent.approvalRequiredActions.filter(action => actions.includes(action))
    : canonicalActions(request.approvalRequiredActions, 'assessment child approvalRequiredActions')
  const egress = request.egress ?? parent.egress.filter(entry => selectedTargets.has(entry.targetId))
  const credentials = request.credentials ?? parent.credentials.filter(entry => selectedTargets.has(entry.targetId))
  const evidence: AssessmentEvidencePolicy = {
    retainUntil: request.evidence?.retainUntil ?? parent.evidence.retainUntil,
    minimumRedaction: request.evidence?.minimumRedaction ?? parent.evidence.minimumRedaction,
    externalReporting: request.evidence?.externalReporting ?? parent.evidence.externalReporting,
  }
  const child = canonicalizeAssessmentGrant({
    version: 1,
    engagementId: parent.engagementId,
    grantId,
    parentGrantId: parent.grantId,
    authorizationRef: parent.authorizationRef,
    notBefore: request.notBefore ?? parent.notBefore,
    expiresAt: request.expiresAt ?? parent.expiresAt,
    executionHostIds,
    targets,
    excludedTargetIds,
    actions,
    approvalRequiredActions,
    egress,
    credentials,
    evidence,
  })
  const violation = subsetViolation(parent, child)
  if (violation !== undefined) {
    throw new AssessmentScopeError(`assessment child grant expands its parent: ${violation}`, 'ASSESSMENT_GRANT_NOT_SUBSET')
  }
  return child
}

/**
 * Classify a canonical grant at an explicit time without consulting process-global clocks.
 * @param grant - Grant to classify.
 * @param at - Non-negative safe-integer epoch millisecond.
 * @returns Whether the grant is early, active, or expired.
 */
export function assessmentGrantStatus(grant: AssessmentGrant, at: number): AssessmentGrantStatus {
  safeInteger(at, 'assessment operation.at')
  if (at < grant.notBefore) return 'not-yet-valid'
  if (at >= grant.expiresAt) return 'expired'
  return 'active'
}

function canonicalOperation(value: unknown): AssessmentOperation {
  const input = record(value, 'assessment operation')
  keysOnly(input, 'assessment operation', [
    'decisionId',
    'grantId',
    'at',
    'action',
    'targetId',
    'executionHostId',
    'egress',
    'credential',
    'evidence',
  ])
  const targetId = AssessmentTargetId(stringValue(input['targetId'], 'assessment operation.targetId'))
  const egress = optional(input['egress'], (present) => {
    const entry = record(present, 'assessment operation.egress')
    keysOnly(entry, 'assessment operation.egress', ['protocol', 'host', 'port', 'purpose'])
    return Object.freeze({
      protocol: enumValue(entry['protocol'], 'assessment operation.egress.protocol', ASSESSMENT_EGRESS_PROTOCOLS),
      host: normalizeHost(entry['host'], 'assessment operation.egress.host'),
      port: safeInteger(entry['port'], 'assessment operation.egress.port', 1, 65_535),
      purpose: enumValue(entry['purpose'], 'assessment operation.egress.purpose', ASSESSMENT_EGRESS_PURPOSES),
    })
  })
  const credential = optional(input['credential'], (present) => {
    const entry = record(present, 'assessment operation.credential')
    keysOnly(entry, 'assessment operation.credential', ['ref', 'purpose'])
    return Object.freeze({
      ref: credentialRef(stringValue(entry['ref'], 'assessment operation.credential.ref')),
      purpose: enumValue(
        entry['purpose'],
        'assessment operation.credential.purpose',
        ASSESSMENT_CREDENTIAL_PURPOSES,
      ),
    })
  })
  const evidence = optional(input['evidence'], (present) => {
    const entry = record(present, 'assessment operation.evidence')
    keysOnly(entry, 'assessment operation.evidence', ['retainUntil', 'redaction'])
    return Object.freeze({
      retainUntil: safeInteger(entry['retainUntil'], 'assessment operation.evidence.retainUntil'),
      redaction: enumValue(
        entry['redaction'],
        'assessment operation.evidence.redaction',
        ASSESSMENT_EVIDENCE_REDACTIONS,
      ),
    })
  })
  return Object.freeze({
    decisionId: AssessmentDecisionId(stringValue(input['decisionId'], 'assessment operation.decisionId')),
    grantId: AssessmentGrantId(stringValue(input['grantId'], 'assessment operation.grantId')),
    at: safeInteger(input['at'], 'assessment operation.at'),
    action: enumValue(input['action'], 'assessment operation.action', ASSESSMENT_ACTIONS),
    targetId,
    executionHostId: ExecutionHostId(stringValue(input['executionHostId'], 'assessment operation.executionHostId')),
    ...(egress === undefined ? {} : { egress }),
    ...(credential === undefined ? {} : { credential }),
    ...(evidence === undefined ? {} : { evidence }),
  })
}

/**
 * Validate, normalize, detach, and deeply freeze an operation from a durable or process boundary.
 * @param value - Candidate normalized operation.
 * @returns Canonical immutable operation.
 */
export function canonicalizeAssessmentOperation(value: unknown): AssessmentOperation {
  return canonicalOperation(value)
}

function makeDecision(
  operation: AssessmentOperation,
  outcome: AssessmentDecisionOutcome,
  code: AssessmentDecisionCode,
  target?: AssessmentTarget,
): AssessmentDecision {
  return Object.freeze({
    decisionId: operation.decisionId,
    grantId: operation.grantId,
    outcome,
    code,
    operation,
    ...(target === undefined ? {} : { matchedTarget: target }),
  })
}

/**
 * Produce the deterministic policy result for one canonical operation.
 * @param grantValue - Grant being exercised.
 * @param operationValue - Complete operation with explicit decision id and time.
 * @returns Frozen allow, deny, or approval-required result with a stable code.
 */
export function authorizeAssessmentOperation(
  grantValue: AssessmentGrant,
  operationValue: AssessmentOperation,
): AssessmentDecision {
  const grant = canonicalizeAssessmentGrant(grantValue)
  const operation = canonicalOperation(operationValue)
  if (operation.grantId !== grant.grantId) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_GRANT_MISMATCH')
  }
  const status = assessmentGrantStatus(grant, operation.at)
  if (status === 'not-yet-valid') return makeDecision(operation, 'deny', 'ASSESSMENT_NOT_YET_VALID')
  if (status === 'expired') return makeDecision(operation, 'deny', 'ASSESSMENT_EXPIRED')
  if (!grant.executionHostIds.includes(operation.executionHostId)) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_HOST_OUT_OF_SCOPE')
  }
  const target = grant.targets.find(candidate => candidate.id === operation.targetId)
  if (target === undefined) return makeDecision(operation, 'deny', 'ASSESSMENT_TARGET_OUT_OF_SCOPE')
  if (grant.excludedTargetIds.includes(operation.targetId)) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_TARGET_EXCLUDED', target)
  }
  if (!grant.actions.includes(operation.action)) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_ACTION_OUT_OF_SCOPE', target)
  }
  if ((operation.action === 'data-export' || operation.action === 'external-reporting')
    && operation.egress === undefined) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_EGRESS_REQUIRED', target)
  }
  if (operation.egress !== undefined) {
    const requested = egressKey({ ...operation.egress, targetId: operation.targetId })
    if (!grant.egress.some(entry => egressKey(entry) === requested)) {
      return makeDecision(operation, 'deny', 'ASSESSMENT_EGRESS_OUT_OF_SCOPE', target)
    }
  }
  if ((operation.action === 'data-export' || operation.action === 'external-reporting' || operation.action === 'report-download')
    && operation.evidence === undefined) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_EVIDENCE_REQUIRED', target)
  }
  if (operation.action === 'credential-use' && operation.credential === undefined) {
    return makeDecision(operation, 'deny', 'ASSESSMENT_CREDENTIAL_REQUIRED', target)
  }
  if (operation.credential !== undefined) {
    const requested = credentialKey({ ...operation.credential, targetId: operation.targetId })
    if (!grant.credentials.some(entry => credentialKey(entry) === requested)) {
      return makeDecision(operation, 'deny', 'ASSESSMENT_CREDENTIAL_OUT_OF_SCOPE', target)
    }
  }
  if (operation.evidence !== undefined) {
    if (operation.evidence.retainUntil > grant.evidence.retainUntil) {
      return makeDecision(operation, 'deny', 'ASSESSMENT_EVIDENCE_RETENTION_OUT_OF_SCOPE', target)
    }
    /* v8 ignore next -- canonical operations and grants contain declared redaction values */
    if ((REDACTION_ORDER.get(operation.evidence.redaction) ?? -1)
      < (REDACTION_ORDER.get(grant.evidence.minimumRedaction) ?? -1)) {
      return makeDecision(operation, 'deny', 'ASSESSMENT_EVIDENCE_REDACTION_OUT_OF_SCOPE', target)
    }
  }
  if (operation.action === 'external-reporting') {
    if (grant.evidence.externalReporting === 'deny') {
      return makeDecision(operation, 'deny', 'ASSESSMENT_EXTERNAL_REPORTING_DENIED', target)
    }
    if (grant.evidence.externalReporting === 'approval-required') {
      return makeDecision(operation, 'approval-required', 'ASSESSMENT_APPROVAL_REQUIRED', target)
    }
  }
  if (grant.approvalRequiredActions.includes(operation.action)) {
    return makeDecision(operation, 'approval-required', 'ASSESSMENT_APPROVAL_REQUIRED', target)
  }
  return makeDecision(operation, 'allow', 'ASSESSMENT_ALLOWED', target)
}

function projectionFromGrant(grant: AssessmentGrant): AssessmentScopeProjection {
  return Object.freeze({
    engagementId: grant.engagementId,
    grantId: grant.grantId,
    ...(grant.parentGrantId === undefined ? {} : { parentGrantId: grant.parentGrantId }),
    notBefore: grant.notBefore,
    expiresAt: grant.expiresAt,
    executionHostIds: Object.freeze([...grant.executionHostIds]),
    targetIds: Object.freeze(grant.targets.map(target => target.id)),
    actions: Object.freeze([...grant.actions]),
  })
}

/** Wire schema for the assessment-scope projection. */
export const assessmentScopeProjectionSchema: ZodType<AssessmentScopeProjection | null> = zod.union([
  zod.object({
    engagementId: zod.string().min(1),
    grantId: zod.string().min(1),
    parentGrantId: zod.string().min(1).optional(),
    notBefore: zod.number().int().nonnegative(),
    expiresAt: zod.number().int().nonnegative(),
    executionHostIds: zod.array(zod.string().min(1)),
    targetIds: zod.array(zod.string().min(1)),
    actions: zod.array(zod.enum(ASSESSMENT_ACTIONS)),
    lastDecision: zod.object({
      decisionId: zod.string().min(1),
      outcome: zod.enum(['allow', 'deny', 'approval-required']),
      code: zod.enum(ASSESSMENT_DECISION_CODES),
      action: zod.enum(ASSESSMENT_ACTIONS),
      targetId: zod.string().min(1),
      at: zod.number().int().nonnegative(),
    }).optional(),
  }),
  zod.null(),
]) as ZodType<AssessmentScopeProjection | null>

/**
 * Apply one Session event to the assessment projection.
 * @param state - Projection after all preceding events.
 * @param event - Next committed Session event.
 * @returns Next whole projection value, or the same reference for unrelated events.
 */
export function applyAssessmentScopeProjection(
  state: AssessmentScopeProjection | null,
  event: SessionEvent,
): AssessmentScopeProjection | null {
  if (event.type === 'assessment/scope-bound') return projectionFromGrant(event.data.grant)
  if (event.type !== 'assessment/operation-decided') return state
  if (state === null) {
    throw new AssessmentScopeError(
      'assessment operation decision precedes the Session scope binding',
      'ASSESSMENT_PROJECTION_INVALID',
    )
  }
  const decision = event.data.decision
  if (decision.grantId !== state.grantId) {
    throw new AssessmentScopeError(
      'assessment operation decision references a different grant than the Session binding',
      'ASSESSMENT_PROJECTION_INVALID',
    )
  }
  return Object.freeze({
    ...state,
    lastDecision: Object.freeze({
      decisionId: decision.decisionId,
      outcome: decision.outcome,
      code: decision.code,
      action: decision.operation.action,
      targetId: decision.operation.targetId,
      at: decision.operation.at,
    }),
  })
}

/**
 * Replay a complete Session log into the assessment projection.
 * @param events - Session log or prefix in sequence order.
 * @returns Current binding and latest decision, or `null` before binding.
 */
export function foldAssessmentScopeProjection(events: readonly SessionEvent[]): AssessmentScopeProjection | null {
  let state: AssessmentScopeProjection | null = null
  for (const event of events) state = applyAssessmentScopeProjection(state, event)
  return state
}

/** Pure projection unit registered by the lifecycle Consumer when the registry is present. */
export const assessmentScopeProjection = {
  key: 'assessmentScope' as const,
  stateSchema: assessmentScopeProjectionSchema,
  init: () => null as AssessmentScopeProjection | null,
  apply: applyAssessmentScopeProjection,
  wire: {
    viewSchema: assessmentScopeProjectionSchema,
    view: (state: AssessmentScopeProjection | null) => state,
  },
  stateVersion: 1,
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    assessmentScope: AssessmentScopePolicy
  }
}

/**
 * Provider-neutral assessment policy. Providers supply one root grant while
 * this definition owns child narrowing, restore checks, and decisions.
 */
export abstract class AssessmentScopePolicy extends Service {
  constructor(ctx: Context) {
    super(ctx, 'assessmentScope')
  }

  /** Canonical immutable root grant supplied by the active provider. */
  abstract get rootGrant(): AssessmentGrant

  /**
   * Restore a durable grant only when it remains inside the provider's current root authority.
   * @param value - Durable grant snapshot.
   * @returns Canonical immutable grant accepted by the current provider.
   */
  restore(value: AssessmentGrant): AssessmentGrant {
    const grant = canonicalizeAssessmentGrant(value)
    const root = this.rootGrant
    if (grant.parentGrantId === undefined && grant.grantId !== root.grantId) {
      throw new AssessmentScopeError(
        'assessment root grant id differs from the active provider root',
        'ASSESSMENT_GRANT_ROOT_MISMATCH',
      )
    }
    const violation = subsetViolation(root, grant)
    if (violation !== undefined) {
      throw new AssessmentScopeError(
        `assessment durable grant exceeds the active provider root: ${violation}`,
        'ASSESSMENT_GRANT_NOT_SUBSET',
      )
    }
    return grant
  }

  /**
   * Derive one equal-or-narrower child grant.
   * @param parent - Parent grant.
   * @param request - Child id and optional restrictions.
   * @returns Canonical immutable child grant.
   */
  deriveChild(parent: AssessmentGrant, request: AssessmentChildGrantRequest): AssessmentGrant {
    return deriveAssessmentChildGrant(this.restore(parent), request)
  }

  /**
   * Classify one grant at an explicit time.
   * @param grant - Grant to classify.
   * @param at - Epoch millisecond supplied by the caller.
   * @returns Time-window status.
   */
  status(grant: AssessmentGrant, at: number): AssessmentGrantStatus {
    return assessmentGrantStatus(this.restore(grant), at)
  }

  /**
   * Decide one operation without performing its effect.
   * @param grant - Session-bound grant.
   * @param operation - Complete normalized operation.
   * @returns Deterministic frozen policy decision.
   */
  authorize(grant: AssessmentGrant, operation: AssessmentOperation): AssessmentDecision {
    return authorizeAssessmentOperation(this.restore(grant), operation)
  }
}

export default AssessmentScopePolicy
