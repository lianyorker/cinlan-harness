/** Browser-safe Security Research status returned by the Host Remote. */

/** Security Research components that the current Host composition can provide. */
export interface SecurityResearchComponents {
  readonly assessmentScope: boolean
  readonly findings: boolean
  readonly artifacts: boolean
  readonly vulnerabilityKnowledgeBase: boolean
  readonly securitySkills: boolean
  readonly workflowPrompt: boolean
  readonly findingTools: boolean
}

/** Current root assessment scope without targets, credentials, or authorization references. */
export interface SecurityResearchScopeStatus {
  readonly present: boolean
  readonly state: 'missing' | 'empty' | 'configured' | 'not-yet-valid' | 'expired'
  readonly targetCount: number
  readonly actionCount: number
  readonly executionHostCount: number
  readonly egressCount: number
  readonly credentialCount: number
  readonly minimumRedaction?: 'none' | 'secrets' | 'sensitive'
  readonly externalReporting?: 'deny' | 'approval-required' | 'allow'
}

/** Security Research Agent preset visibility and trust. */
export interface SecurityResearchPresetStatus {
  readonly present: boolean
  readonly trust?: 'system' | 'user'
  readonly broken?: 'preset-invalid'
}

/** Point-in-time Security Research status used by Settings. */
export interface SecurityResearchSnapshot {
  readonly status: 'configured' | 'not-configured' | 'attention'
  readonly preset: SecurityResearchPresetStatus
  readonly scope: SecurityResearchScopeStatus
  readonly components: SecurityResearchComponents
  readonly skillCount: number
  readonly skillsComplete: boolean
}

/** Session identity and output format for a user-triggered report export. */
export interface SecurityResearchReportRequest {
  readonly sessionId: import('@deepseek-ai/dsh-session/types').SessionId
  readonly format: 'json' | 'markdown' | 'sarif'
}
/** Report bytes include verbatim Finding metadata and Artifact references, not Artifact contents. */
export interface SecurityResearchReportValue {
  readonly fileName: string
  readonly mediaType: 'application/json' | 'text/markdown' | 'application/sarif+json'
  readonly bytes: number
  readonly base64: string
  readonly findingCount: number
}
/** User-editable assessment scope settings payload; credential fields remain references. */
export interface SecurityResearchScopeSettings {
  readonly root: {
    readonly engagementId: string
    readonly grantId: string
    readonly authorizationRef: string
    readonly notBefore: number
    readonly expiresAt: number
    readonly executionHostIds: readonly string[]
    readonly targets: readonly { readonly id: string; readonly kind: string; readonly value: string }[]
    readonly excludedTargetIds: readonly string[]
    readonly actions: readonly string[]
    readonly approvalRequiredActions: readonly string[]
    readonly egress: readonly {
      readonly protocol: string
      readonly host: string
      readonly port: number
      readonly purpose: string
      readonly targetId: string
    }[]
    readonly credentials: readonly { readonly ref: string; readonly purpose: string; readonly targetId: string }[]
    readonly evidence: { readonly retainUntil: number; readonly minimumRedaction: string; readonly externalReporting: string }
  }
}


declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The complete report exceeded a configured limit. */
    'security-research/report-limit': Record<string, never>
    /** Concurrent Session mutation or non-advancing pagination prevented a complete snapshot. */
    'security-research/report-changed': Record<string, never>
    /** No durable Session checkpoint completed. */
    'security-research/report-storage': Record<string, never>
    /** Requested report Session is not live. */
    'security-research/session-not-live': { readonly sessionId: import('@deepseek-ai/dsh-session/types').SessionId }
    /** Report export requires a live Session assessment scope binding. */
    'security-research/scope-required': { readonly sessionId: import('@deepseek-ai/dsh-session/types').SessionId }
    /** Report export was refused by the assessment scope decision. */
    'security-research/export-not-authorized': { readonly sessionId: import('@deepseek-ai/dsh-session/types').SessionId; readonly code: string }
  }
}
