/** Group complete own-Turn accounting using the canonical token-meter fold. */
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { TurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type { UsageCounts, UsageTokens } from './types.ts'

/** One recorded Turn; an inherited prefix never qualifies for exact accounting. */
export interface RecordedUsageTurn {
  readonly startedAt: number
  readonly events: readonly SessionEvent[]
  readonly inherited: boolean
}

/**
 * Partition only the own suffix; incomplete inherited Turns remain explicitly unknown.
 * @param events - immutable observation events.
 * @param inheritedEventCount - exact prefix length owned by an ancestor.
 * @returns own Turns in event order, without copying an inherited prefix.
 */
export function* ownTurns(events: readonly SessionEvent[], inheritedEventCount: number): Generator<RecordedUsageTurn> {
  let current: { startedAt: number; events: SessionEvent[]; inherited: boolean } | undefined
  for (const [index, event] of events.entries()) {
    if (index < inheritedEventCount) continue
    if (event.type === 'turn/start') {
      if (current !== undefined) yield current
      current = { startedAt: event.time, events: [], inherited: false }
    } else if (current === undefined && inheritedEventCount > 0
      && (event.type === 'step/start' || event.type === 'assistant/message'
        || event.type === 'assistant/attempt' || event.type === 'turn/end')) {
      current = { startedAt: event.time, events: [], inherited: true }
    }
    if (current === undefined) continue
    current.events.push(event)
    if (event.type === 'turn/end') {
      yield current
      current = undefined
    }
  }
  if (current !== undefined) yield current
}

/**
 * Resolve one complete Turn through the token-meter's public accounting function.
 * @param turn - own recorded Turn, possibly incomplete.
 * @returns exact accounting or undefined for incomplete, inherited, or missing usage.
 */
export function accountTurn(turn: RecordedUsageTurn): TurnTokenUsage | undefined {
  return turn.inherited ? undefined : deriveTurnTokenUsage(turn.events)
}

/** @returns counters with no invented token zeroes. */
export function emptyCounts(): UsageCounts {
  return { turns: 0, knownTurns: 0, unknownTurns: 0, attempts: 0, retries: 0, tokens: null }
}

function sum(left: number, right: number): number {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new RangeError('Usage total exceeds the exact integer range')
  return total
}

function addTokens(left: UsageTokens | null, right: UsageTokens | null): UsageTokens | null {
  if (right === null) return left
  if (left === null) return right
  return {
    uncachedInputTokens: sum(left.uncachedInputTokens, right.uncachedInputTokens),
    outputTokens: sum(left.outputTokens, right.outputTokens),
    totalTokens: sum(left.totalTokens, right.totalTokens),
    ...(left.cacheReadTokens === undefined || right.cacheReadTokens === undefined
      ? {} : { cacheReadTokens: sum(left.cacheReadTokens, right.cacheReadTokens) }),
    ...(left.cacheWriteTokens === undefined || right.cacheWriteTokens === undefined
      ? {} : { cacheWriteTokens: sum(left.cacheWriteTokens, right.cacheWriteTokens) }),
    ...(left.reasoningTokens === undefined || right.reasoningTokens === undefined
      ? {} : { reasoningTokens: sum(left.reasoningTokens, right.reasoningTokens) }),
  }
}

/**
 * Combine exact subtotals while preserving missing optional buckets.
 * @param left - accumulated counts.
 * @param right - another disjoint collection of Turns.
 * @returns combined counters and known token subtotal.
 */
export function addCounts(left: UsageCounts, right: UsageCounts): UsageCounts {
  return {
    turns: left.turns + right.turns,
    knownTurns: left.knownTurns + right.knownTurns,
    unknownTurns: left.unknownTurns + right.unknownTurns,
    attempts: left.attempts + right.attempts,
    retries: left.retries + right.retries,
    tokens: addTokens(left.tokens, right.tokens),
  }
}

/**
 * Count durable attempt starts without treating intermediate usage samples as calls.
 * @param turn - own Turn events.
 * @param usage - canonical complete accounting, if available.
 * @returns one-Turn counters and whitelisted provider buckets.
 */
export function turnCounts(turn: RecordedUsageTurn, usage: TurnTokenUsage | undefined): UsageCounts {
  const retries = turn.events.filter(event => event.type === 'llm/retry-started').length
  return {
    turns: 1, knownTurns: usage === undefined ? 0 : 1, unknownTurns: usage === undefined ? 1 : 0,
    attempts: turn.events.filter(event => event.type === 'step/start').length + retries,
    retries,
    tokens: usage === undefined ? null : {
      uncachedInputTokens: usage.uncachedInputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
      ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
      ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    },
  }
}
