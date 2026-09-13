/**
 * Static Service Provider for `ctx.assessmentScope`. One strict operator-owned
 * configuration entry supplies the immutable root grant; no secret values are
 * accepted, only credential references.
 *
 * @module @deepseek-ai/dsh-assessment-scope-static
 */

import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import {
  ASSESSMENT_ACTIONS,
  ASSESSMENT_CREDENTIAL_PURPOSES,
  ASSESSMENT_EGRESS_PROTOCOLS,
  ASSESSMENT_EGRESS_PURPOSES,
  ASSESSMENT_EVIDENCE_REDACTIONS,
  ASSESSMENT_EXTERNAL_REPORTING_POLICIES,
  ASSESSMENT_TARGET_KINDS,
  AssessmentScopePolicy,
  canonicalizeAssessmentGrant,
} from '@deepseek-ai/dsh-assessment-scope'
import type {
  AssessmentAction,
  AssessmentCredentialPurpose,
  AssessmentEgressProtocol,
  AssessmentEgressPurpose,
  AssessmentEvidenceRedaction,
  AssessmentExternalReportingPolicy,
  AssessmentGrant,
  AssessmentTargetKind,
} from '@deepseek-ai/dsh-assessment-scope'
import { z as zod } from 'zod'

/** Operator-owned target config before branded-id canonicalization. */
export interface AssessmentTargetConfig {
  /** Stable target identifier referenced by exclusions, egress, credentials, and operations. */
  readonly id: string
  /** Provider-neutral category that tells an effect adapter how to interpret the value. */
  readonly kind: AssessmentTargetKind
  /** Non-blank trimmed target value; hostname values are canonicalized by the Service Definition. */
  readonly value: string
}

/** Operator-owned exact egress grant before branded-id canonicalization. */
export interface AssessmentEgressConfig {
  /** Closed outbound network protocol. */
  readonly protocol: AssessmentEgressProtocol
  /** Exact destination host without scheme, path, whitespace, or credentials. */
  readonly host: string
  /** Exact destination port from 1 through 65535. */
  readonly port: number
  /** Authorized reason for contacting the destination. */
  readonly purpose: AssessmentEgressPurpose
  /** Target whose operation may use this destination. */
  readonly targetId: string
}

/** Operator-owned credential-reference grant; it cannot carry a secret value. */
export interface AssessmentCredentialConfig {
  /** Credential reference resolved elsewhere; inline secret values are not accepted. */
  readonly ref: string
  /** Authorized reason for resolving the credential. */
  readonly purpose: AssessmentCredentialPurpose
  /** Target whose operation may resolve this credential. */
  readonly targetId: string
}

/** Strict root grant configuration supplied by one composition entry. */
export interface AssessmentRootGrantConfig {
  /** Stable identifier for the written assessment engagement. */
  readonly engagementId: string
  /** Stable identifier for this root authorization grant. */
  readonly grantId: string
  /** Non-secret opaque reference to the written authorization record. */
  readonly authorizationRef: string
  /** Inclusive grant start as a non-negative safe-integer epoch millisecond. */
  readonly notBefore: number
  /** Exclusive grant expiry as a non-negative safe-integer epoch millisecond. */
  readonly expiresAt: number
  /** Execution hosts on which operations may run. */
  readonly executionHostIds: readonly string[]
  /** Non-empty canonical target inventory for the engagement. */
  readonly targets: readonly AssessmentTargetConfig[]
  /** Target ids that remain denied even though they occur in the inventory. */
  readonly excludedTargetIds: readonly string[]
  /** Non-empty closed action classes admitted by the root grant. */
  readonly actions: readonly AssessmentAction[]
  /** Allowed actions that still require an external approval workflow. */
  readonly approvalRequiredActions: readonly AssessmentAction[]
  /** Exact target-scoped outbound destinations admitted by the grant. */
  readonly egress: readonly AssessmentEgressConfig[]
  /** Exact target-scoped credential references and purposes admitted by the grant. */
  readonly credentials: readonly AssessmentCredentialConfig[]
  /** Evidence retention, redaction, and external-reporting restrictions. */
  readonly evidence: {
    /** Latest epoch millisecond through which produced evidence may be retained. */
    readonly retainUntil: number
    /** Minimum redaction strength for retained or exported evidence. */
    readonly minimumRedaction: AssessmentEvidenceRedaction
    /** Additional disposition applied to the external-reporting action. */
    readonly externalReporting: AssessmentExternalReportingPolicy
  }
}

/** Plugin configuration containing exactly one root assessment grant. */
export interface Config {
  /** Complete strict root grant; every field is required and no secret values are accepted. */
  readonly root: AssessmentRootGrantConfig
}

const id = zod.string().min(1).refine(value => value.trim() === value, 'must be trimmed')
const safeEpoch = zod.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const targetSchema = zod.strictObject({
  id,
  kind: zod.enum(ASSESSMENT_TARGET_KINDS),
  value: id,
})
const egressSchema = zod.strictObject({
  protocol: zod.enum(ASSESSMENT_EGRESS_PROTOCOLS),
  host: id,
  port: zod.number().int().min(1).max(65_535),
  purpose: zod.enum(ASSESSMENT_EGRESS_PURPOSES),
  targetId: id,
})
const credentialSchema = zod.strictObject({
  ref: id,
  purpose: zod.enum(ASSESSMENT_CREDENTIAL_PURPOSES),
  targetId: id,
})
const rootSchema = zod.strictObject({
  engagementId: id,
  grantId: id,
  authorizationRef: id,
  notBefore: safeEpoch,
  expiresAt: safeEpoch,
  executionHostIds: zod.array(id),
  targets: zod.array(targetSchema),
  excludedTargetIds: zod.array(id),
  actions: zod.array(zod.enum(ASSESSMENT_ACTIONS)),
  approvalRequiredActions: zod.array(zod.enum(ASSESSMENT_ACTIONS)),
  egress: zod.array(egressSchema),
  credentials: zod.array(credentialSchema),
  evidence: zod.strictObject({
    retainUntil: safeEpoch,
    minimumRedaction: zod.enum(ASSESSMENT_EVIDENCE_REDACTIONS),
    externalReporting: zod.enum(ASSESSMENT_EXTERNAL_REPORTING_POLICIES),
  }),
})
const configSchema = zod.strictObject({ root: rootSchema })

const targetConfigSchema = schema.object({
  id: schema.string().required(),
  kind: schema.union([...ASSESSMENT_TARGET_KINDS]).required(),
  value: schema.string().required(),
})
const egressConfigSchema = schema.object({
  protocol: schema.union([...ASSESSMENT_EGRESS_PROTOCOLS]).required(),
  host: schema.string().required(),
  port: schema.number().step(1).min(1).max(65_535).required(),
  purpose: schema.union([...ASSESSMENT_EGRESS_PURPOSES]).required(),
  targetId: schema.string().required(),
})
const credentialConfigSchema = schema.object({
  ref: schema.string().required(),
  purpose: schema.union([...ASSESSMENT_CREDENTIAL_PURPOSES]).required(),
  targetId: schema.string().required(),
})

/** Structured Loader schema; strict recursive validation still runs in the constructor. */
export const Config = schema.object({
  root: schema.object({
    engagementId: schema.string().required(),
    grantId: schema.string().required(),
    authorizationRef: schema.string().required(),
    notBefore: schema.number().step(1).min(0).required(),
    expiresAt: schema.number().step(1).min(0).required(),
    executionHostIds: schema.array(schema.string()).required(),
    targets: schema.array(targetConfigSchema).required(),
    excludedTargetIds: schema.array(schema.string()).required(),
    actions: schema.array(schema.union([...ASSESSMENT_ACTIONS])).required(),
    approvalRequiredActions: schema.array(schema.union([...ASSESSMENT_ACTIONS])).required(),
    egress: schema.array(egressConfigSchema).required(),
    credentials: schema.array(credentialConfigSchema).required(),
    evidence: schema.object({
      retainUntil: schema.number().step(1).min(0).required(),
      minimumRedaction: schema.union([...ASSESSMENT_EVIDENCE_REDACTIONS]).required(),
      externalReporting: schema.union([...ASSESSMENT_EXTERNAL_REPORTING_POLICIES]).required(),
    }).required(),
  }).required(),
}) as unknown as Schema<Config>

/**
 * Strictly validate config and materialize its canonical immutable root grant.
 * @param input - Raw composition config.
 * @returns Canonical root grant with branded ids and no secret material.
 */
export function resolveAssessmentScopeConfig(input: unknown): AssessmentGrant {
  const parsed = configSchema.parse(input)
  return canonicalizeAssessmentGrant({
    version: 1,
    ...parsed.root,
  })
}

/** Static provider backed by one validated operator-owned root grant. */
export class StaticAssessmentScopePolicy extends AssessmentScopePolicy {
  static Config = Config

  private readonly rootGrantValue: AssessmentGrant

  /**
   * @param ctx - Cordis context that owns the provider service.
   * @param config - Strict root grant configuration.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.rootGrantValue = resolveAssessmentScopeConfig(config)
  }

  /** Canonical immutable root grant. */
  override get rootGrant(): AssessmentGrant {
    return this.rootGrantValue
  }
}

export default StaticAssessmentScopePolicy
