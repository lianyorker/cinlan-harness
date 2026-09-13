/**
 * Pure assessment-scope vocabulary: branded ids, immutable grants, operation
 * decisions, durable Session payloads, and the replay projection value.
 *
 * @module @deepseek-ai/dsh-assessment-scope/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'

/** Identifies one authorized assessment engagement. */
export type AssessmentEngagementId = Branded<'AssessmentEngagementId'>

/** Identifies one immutable root or delegated assessment grant. */
export type AssessmentGrantId = Branded<'AssessmentGrantId'>

/** Identifies one operator-defined target inside an assessment grant. */
export type AssessmentTargetId = Branded<'AssessmentTargetId'>

/** Identifies one policy decision before its authorized effect. */
export type AssessmentDecisionId = Branded<'AssessmentDecisionId'>

/** Opaque reference to the written authorization that established a grant. */
export type AssessmentAuthorizationRef = Branded<'AssessmentAuthorizationRef'>

/** Closed action classes governed by an assessment grant. */
export type AssessmentAction =
  | 'reconnaissance'
  | 'active-validation'
  | 'credential-use'
  | 'persistence-change'
  | 'exploit-execution'
  | 'destructive-operation'
  | 'report-download'
  | 'data-export'
  | 'external-reporting'

/** Provider-neutral target classifications. Effect adapters own normalization into these classes. */
export type AssessmentTargetKind =
  | 'hostname'
  | 'ip-address'
  | 'url-prefix'
  | 'artifact-scope'
  | 'service'

/** One canonical target declared by the written assessment scope. */
export interface AssessmentTarget {
  /** Stable target identity used by operations and delegated grants. */
  readonly id: AssessmentTargetId
  /** Target classification whose value normalization is adapter-owned. */
  readonly kind: AssessmentTargetKind
  /** Non-empty operator-owned target value. */
  readonly value: string
}

/** Closed egress protocols that an effect adapter may request. */
export type AssessmentEgressProtocol = 'http' | 'https' | 'tcp' | 'udp'

/** Why an operation needs one outbound destination. */
export type AssessmentEgressPurpose =
  | 'model-provider'
  | 'web-search'
  | 'target-access'
  | 'artifact-export'
  | 'external-reporting'

/** One exact outbound destination admitted for one target and purpose. */
export interface AssessmentEgressGrant {
  readonly protocol: AssessmentEgressProtocol
  readonly host: string
  readonly port: number
  readonly purpose: AssessmentEgressPurpose
  readonly targetId: AssessmentTargetId
}

/** Closed purposes for resolving a credential during an assessment operation. */
export type AssessmentCredentialPurpose =
  | 'model-provider'
  | 'web-search'
  | 'target-authentication'
  | 'artifact-store'
  | 'external-reporting'

/** One credential reference admitted for one purpose and target. */
export interface AssessmentCredentialGrant {
  readonly ref: CredentialRef
  readonly purpose: AssessmentCredentialPurpose
  readonly targetId: AssessmentTargetId
}

/** Redaction strength requested by an evidence-producing operation. */
export type AssessmentEvidenceRedaction = 'none' | 'secrets' | 'sensitive'

/** Whether evidence may leave the engagement reporting environment. */
export type AssessmentExternalReportingPolicy = 'deny' | 'approval-required' | 'allow'

/** Evidence retention, redaction, and reporting limits carried by a grant. */
export interface AssessmentEvidencePolicy {
  /** Latest epoch millisecond through which evidence may be retained. */
  readonly retainUntil: number
  /** Minimum redaction strength for retained or exported evidence. */
  readonly minimumRedaction: AssessmentEvidenceRedaction
  /** Additional policy for the `external-reporting` action. */
  readonly externalReporting: AssessmentExternalReportingPolicy
}

/** Canonical immutable authorization granted to one root or delegated session. */
export interface AssessmentGrant {
  readonly version: 1
  /** Security engagement value that a later provenance adapter may rebrand without parsing. */
  readonly engagementId: AssessmentEngagementId
  readonly grantId: AssessmentGrantId
  /** Present on delegated grants and absent on a root grant. */
  readonly parentGrantId?: AssessmentGrantId
  /** Non-secret written-scope reference that a later provenance adapter may rebrand as its scope reference. */
  readonly authorizationRef: AssessmentAuthorizationRef
  readonly notBefore: number
  readonly expiresAt: number
  readonly executionHostIds: readonly ExecutionHostId[]
  readonly targets: readonly AssessmentTarget[]
  readonly excludedTargetIds: readonly AssessmentTargetId[]
  readonly actions: readonly AssessmentAction[]
  readonly approvalRequiredActions: readonly AssessmentAction[]
  readonly egress: readonly AssessmentEgressGrant[]
  readonly credentials: readonly AssessmentCredentialGrant[]
  readonly evidence: AssessmentEvidencePolicy
}

/** Optional restrictions used to derive one child grant from its parent. */
export interface AssessmentChildGrantRequest {
  readonly grantId: AssessmentGrantId
  readonly notBefore?: number
  readonly expiresAt?: number
  readonly executionHostIds?: readonly ExecutionHostId[]
  readonly targetIds?: readonly AssessmentTargetId[]
  readonly excludedTargetIds?: readonly AssessmentTargetId[]
  readonly actions?: readonly AssessmentAction[]
  readonly approvalRequiredActions?: readonly AssessmentAction[]
  readonly egress?: readonly AssessmentEgressGrant[]
  readonly credentials?: readonly AssessmentCredentialGrant[]
  readonly evidence?: Partial<AssessmentEvidencePolicy>
}

/** One outbound destination requested by an operation. */
export interface AssessmentOperationEgress {
  readonly protocol: AssessmentEgressProtocol
  readonly host: string
  readonly port: number
  readonly purpose: AssessmentEgressPurpose
}

/** One credential resolution requested by an operation. */
export interface AssessmentOperationCredential {
  readonly ref: CredentialRef
  readonly purpose: AssessmentCredentialPurpose
}

/** Evidence handling requested by an operation that produces or exports evidence. */
export interface AssessmentOperationEvidence {
  readonly retainUntil: number
  readonly redaction: AssessmentEvidenceRedaction
}

/** Complete normalized input to one assessment authorization decision. */
export interface AssessmentOperation {
  readonly decisionId: AssessmentDecisionId
  readonly grantId: AssessmentGrantId
  readonly at: number
  readonly action: AssessmentAction
  readonly targetId: AssessmentTargetId
  readonly executionHostId: ExecutionHostId
  readonly egress?: AssessmentOperationEgress
  readonly credential?: AssessmentOperationCredential
  readonly evidence?: AssessmentOperationEvidence
}

/** Stable machine-readable outcome classifications for assessment decisions. */
export type AssessmentDecisionCode =
  | 'ASSESSMENT_ALLOWED'
  | 'ASSESSMENT_APPROVAL_REQUIRED'
  | 'ASSESSMENT_GRANT_MISMATCH'
  | 'ASSESSMENT_NOT_YET_VALID'
  | 'ASSESSMENT_EXPIRED'
  | 'ASSESSMENT_HOST_OUT_OF_SCOPE'
  | 'ASSESSMENT_TARGET_EXCLUDED'
  | 'ASSESSMENT_TARGET_OUT_OF_SCOPE'
  | 'ASSESSMENT_ACTION_OUT_OF_SCOPE'
  | 'ASSESSMENT_EGRESS_REQUIRED'
  | 'ASSESSMENT_EGRESS_OUT_OF_SCOPE'
  | 'ASSESSMENT_CREDENTIAL_REQUIRED'
  | 'ASSESSMENT_CREDENTIAL_OUT_OF_SCOPE'
  | 'ASSESSMENT_EVIDENCE_REQUIRED'
  | 'ASSESSMENT_EVIDENCE_RETENTION_OUT_OF_SCOPE'
  | 'ASSESSMENT_EVIDENCE_REDACTION_OUT_OF_SCOPE'
  | 'ASSESSMENT_EXTERNAL_REPORTING_DENIED'

/** The policy disposition returned before an assessment effect. */
export type AssessmentDecisionOutcome = 'allow' | 'deny' | 'approval-required'

/** Deterministic policy result logged before the caller may perform its effect. */
export interface AssessmentDecision {
  readonly decisionId: AssessmentDecisionId
  readonly grantId: AssessmentGrantId
  readonly outcome: AssessmentDecisionOutcome
  readonly code: AssessmentDecisionCode
  readonly operation: AssessmentOperation
  readonly matchedTarget?: AssessmentTarget
}

/** Whether a grant is usable at one explicit epoch millisecond. */
export type AssessmentGrantStatus = 'not-yet-valid' | 'active' | 'expired'

/** Why one durable assessment grant was bound to a Session. */
export type AssessmentScopeBoundSource = 'profile' | 'delegation'

/** Durable whole-value binding for one Session's assessment authority. */
export interface AssessmentScopeBoundEvent {
  readonly version: 1
  readonly source: AssessmentScopeBoundSource
  readonly grant: AssessmentGrant
}

/** Durable operation decision recorded before the authorized effect. */
export interface AssessmentOperationDecidedEvent {
  readonly version: 1
  readonly decision: AssessmentDecision
}

/** Compact last-decision value exposed by the assessment projection. */
export interface AssessmentDecisionProjection {
  readonly decisionId: AssessmentDecisionId
  readonly outcome: AssessmentDecisionOutcome
  readonly code: AssessmentDecisionCode
  readonly action: AssessmentAction
  readonly targetId: AssessmentTargetId
  readonly at: number
}

/** Current durable assessment binding and latest decision for one Session. */
export interface AssessmentScopeProjection {
  readonly engagementId: AssessmentEngagementId
  readonly grantId: AssessmentGrantId
  readonly parentGrantId?: AssessmentGrantId
  readonly notBefore: number
  readonly expiresAt: number
  readonly executionHostIds: readonly ExecutionHostId[]
  readonly targetIds: readonly AssessmentTargetId[]
  readonly actions: readonly AssessmentAction[]
  readonly lastDecision?: AssessmentDecisionProjection
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Required, log-only whole grant bound before this Session's first model or tool effect. */
    'assessment/scope-bound': AssessmentScopeBoundEvent
    /** Required, log-only authorization decision committed before its proposed effect. */
    'assessment/operation-decided': AssessmentOperationDecidedEvent
  }
}

import type {} from '@deepseek-ai/dsh-session-projection/types'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Current assessment binding and latest decision, or `null` before binding. */
    assessmentScope: AssessmentScopeProjection | null
  }
}
