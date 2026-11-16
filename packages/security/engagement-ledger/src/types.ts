/**
 * Engagement ledger domain types: pipeline stages, campaigns, assets, steps,
 * and the next-step projection shared by the service and its tools.
 *
 * @module @cinlan/engagement-ledger/types
 */

/** Ordered engagement stages. Progress is coarse bookkeeping, not a gate. */
export const LEDGER_STAGES = [
  'recon',
  'fingerprint',
  'match',
  'verify',
  'exploit',
  'lateral',
  'report',
] as const

export type LedgerStage = typeof LEDGER_STAGES[number]

/** Closed asset status vocabulary written by the model. */
export type LedgerAssetStatus = 'new' | 'fingerprinted' | 'verified' | 'exploited' | 'blocked'

/** Cloud identity of a cloud-scoped asset; `host` carries the cloud account id. */
export interface LedgerAssetCloud {
  provider: 'aws' | 'azure' | 'gcp' | 'aliyun' | 'tencent' | 'huawei'
  accountId: string
}

/** One observed asset inside an authorized engagement. */
export interface LedgerAsset {
  host: string
  port: number | null
  fingerprint: string
  status: string
  kbHits: string[]
  /** Finding ids recorded against this asset; repeated upserts accumulate. */
  findings: string[]
  /** Credential reference names discovered on or used for this asset. */
  credentialRefs: string[]
  /** Cloud identity present when the asset scopes a cloud account. */
  cloud?: LedgerAssetCloud
  note: string
  firstSeenAt: string
  lastSeenAt: string
}

/** One recorded execution step inside a campaign. */
export interface LedgerStep {
  id: string
  stage: LedgerStage
  action: string
  result: string
  at: string
}

/** One playbook/PoC attempt against an asset. */
export interface LedgerAttempt {
  id: string
  asset: string
  kb: string
  payload: string
  outcome: string
  at: string
}

/** A persistent engagement ledger owned by the operator. */
export interface LedgerCampaign {
  id: string
  name: string
  stage: LedgerStage
  /** Target values snapshotted from the grant at creation; enforcement re-reads the live grant. */
  scope: { targets: string[]; excluded: string[] }
  /** Grant id this campaign was created under. */
  grantId: string
  assets: LedgerAsset[]
  steps: LedgerStep[]
  attempts: LedgerAttempt[]
  note: string
  objective: string
  done: boolean
  doneNote: string
  rounds: number
  lastProgress: number
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

/** One suggested follow-up action inside {@link LedgerNextStep}. */
export interface LedgerSuggestion {
  kind: 'recon' | 'match' | 'verify' | 'fingerprint' | 'pivot'
  text: string
  asset?: string
  hits?: string[]
}

/** Next-step projection returned by `campaign_next`. */
export interface LedgerNextStep {
  campaignId: string
  objective: string
  done: boolean
  doneCriteria: string[]
  progress: number
  stalled: boolean
  rounds: number
  stage: LedgerStage
  nextStage: LedgerStage
  assets: number
  pending: number
  steps: number
  attempts: number
  instructions: string[]
  nextActions: LedgerSuggestion[]
  suggestions: LedgerSuggestion[]
}
