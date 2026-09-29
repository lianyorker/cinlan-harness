/**
 * Configuration and result contracts for the history recall tools.
 * @module @deepseek-ai/dsh-tool-recall/types
 */

import z from '@deepseek-ai/schemastery'

/** Default character budget for a single history_read page. */
export const DEFAULT_READ_BUDGET_CHARS = 8000

/** Default search match limit for history_search. */
export const DEFAULT_SEARCH_LIMIT = 25

/** Tool configuration for the history recall package. */
export interface Config {
  /** Maximum characters returned by one history_read call before paginating. Defaults to 8000. */
  readBudgetChars?: number
  /** Maximum matches returned by one history_search call. Defaults to 25. */
  searchLimit?: number
}

/** Schemastery configuration schema. */
export const Config: z<Config> = z.object({
  readBudgetChars: z.number().step(1).min(50).default(DEFAULT_READ_BUDGET_CHARS),
  searchLimit: z.number().step(1).min(1).max(200).default(DEFAULT_SEARCH_LIMIT),
})

/** Arguments for history_read. */
export interface HistoryReadArgs {
  /** Checkpoint ID, e.g. "c42" or "42". */
  checkpoint: string
  /** 0-based offset into the sequence of messages in this checkpoint span. */
  offset?: number
}

/** Result of a successful history_read invocation. */
export interface HistoryReadResult {
  /** Checkpoint identifier read. */
  checkpoint: string
  /** Formatted transcript text for this page. */
  transcript: string
  /** Next offset for pagination, or undefined if the entire span was read. */
  nextOffset?: number
  /** Total surface messages available in this checkpoint span. */
  totalMessages: number
}

/** Arguments for history_search. */
export interface HistorySearchArgs {
  /** Case-insensitive query substring to search for. */
  query: string
  /** Optional specific checkpoint ID to restrict the search to. */
  checkpoint?: string
  /** Optional result count cap. */
  limit?: number
}

/** One match returned by history_search. */
export interface HistorySearchMatch {
  /** Checkpoint ID containing the match. */
  checkpoint: string
  /** Matching transcript line snippet. */
  snippet: string
}

/** Result of a history_search invocation. */
export interface HistorySearchResult {
  /** Matching snippets with their owning checkpoint IDs. */
  matches: HistorySearchMatch[]
  /** Number of checkpoints inspected. */
  scanned: number
  /** Total matching occurrences found. */
  matched: number
  /** Whether the reported matches were truncated by limit. */
  truncated: boolean
  /** Helpful hint when zero matches were found. */
  hint?: string
}
