/** Read-only usage reports over each Session's own recorded Turns. */

/** Exclusive-end UTC interval and optional exact route filters. */
export interface UsageQueryRequest {
  /** Inclusive Turn-start time in Unix milliseconds. */
  readonly from: number
  /** Exclusive Turn-start time in Unix milliseconds. */
  readonly to: number
  /** Include only Turns fully attributable to this provider. */
  readonly provider?: string
  /** Include only Turns fully attributable to this model. */
  readonly model?: string
}

/** Exact totals over the known Turns; absent optional buckets remain unknown. */
export interface UsageTokens {
  /** Uncached input reported by the provider. */
  readonly uncachedInputTokens: number
  /** Provider output, including any reported reasoning subset. */
  readonly outputTokens: number
  /** Provider-authoritative prompt plus output total. */
  readonly totalTokens: number
  /** Present only when every included known Turn reports cache reads. */
  readonly cacheReadTokens?: number
  /** Present only when every included known Turn reports cache writes. */
  readonly cacheWriteTokens?: number
  /** Output subset; never add it to totalTokens. */
  readonly reasoningTokens?: number
}

/** Counters for matching Turns, including missing or incomplete accounting. */
export interface UsageCounts {
  /** Recorded Turns whose start falls in the requested interval. */
  readonly turns: number
  /** Turns with complete provider-reported accounting. */
  readonly knownTurns: number
  /** Turns for which exact token accounting is unavailable. */
  readonly unknownTurns: number
  /** Recorded model-attempt starts, including retries. */
  readonly attempts: number
  /** Recorded retry starts; scheduled retries that never start are excluded. */
  readonly retries: number
  /** Null when no Turn supplies exact accounting; zero remains a real value. */
  readonly tokens: UsageTokens | null
}

/** One exact provider/model grouping; absent identity means mixed or unattributed. */
export interface UsageRow extends UsageCounts {
  /** Present only when every attempt has one provider attribution. */
  readonly provider?: string
  /** Present only when every attempt has one model attribution. */
  readonly model?: string
}

/** Why this query cannot represent a complete exact total. */
export type UsagePartialReason = 'session-limit' | 'event-limit' | 'source-error' | 'unknown-usage' | 'unattributed-filter' | 'inherited-boundary'

/** Bounded aggregate; it contains neither conversation content nor credential values. */
export interface UsageQueryResult {
  /** Exact interval and route filters used to produce this report. */
  readonly request: UsageQueryRequest
  /** Host time after the query completed. */
  readonly generatedAt: number
  /** Aggregate over the matching rows. */
  readonly totals: UsageCounts
  /** Deterministically ordered route groups. */
  readonly rows: readonly UsageRow[]
  /** Exact attributable providers observed in the interval, before filtering. */
  readonly providers: readonly string[]
  /** Exact attributable models observed in the interval, before filtering. */
  readonly models: readonly string[]
  /** Sessions observed by the query, including cold records. */
  readonly scannedSessions: number
  /** Sessions not included because a limit or read failure prevented observation. */
  readonly skippedSessions: number
  /** Total source events admitted to aggregation, including inherited prefixes. */
  readonly examinedEvents: number
  /** Turns that cannot be attributed to one exact provider/model pair. */
  readonly unattributedTurns: number
  /** True when any reported total is a known subtotal instead of a complete total. */
  readonly partial: boolean
  /** Stable explanations for partial coverage or accounting. */
  readonly reasons: readonly UsagePartialReason[]
}
