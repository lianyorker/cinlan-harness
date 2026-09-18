/** Deterministic Host-shaped reports shared by the package's behavior tests. */
import type { UsageQueryRequest, UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'

export const request: UsageQueryRequest = { from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 8) }

export function report(query: UsageQueryRequest = request, overrides: Partial<UsageQueryResult> = {}): UsageQueryResult {
  const counts = {
    turns: 3, knownTurns: 2, unknownTurns: 1, attempts: 5, retries: 2,
    tokens: { totalTokens: 150, uncachedInputTokens: 100, outputTokens: 40, cacheReadTokens: 10, reasoningTokens: 7 },
  }
  return {
    request: query, generatedAt: Date.UTC(2026, 8, 8, 12), totals: counts,
    rows: [{ ...counts, provider: 'deepseek', model: 'model-a' }],
    providers: ['deepseek', '=SUM(1,2)'], models: ['model-a', 'model-b'],
    scannedSessions: 4, skippedSessions: 1, examinedEvents: 73, unattributedTurns: 1,
    partial: true, reasons: ['unknown-usage', 'source-error'], ...overrides,
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
