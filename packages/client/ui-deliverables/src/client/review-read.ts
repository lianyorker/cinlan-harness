/** Validated, cancellable reads for a mounted review, without retaining snapshots after the view closes. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { changesDiffUrl, changesSummaryUrl, isChangesDiff, isChangesSummary, type ChangesDiff, type ChangesSummary } from '../changes.ts'

/** A settled read or a refusal that can be displayed without exposing Host diagnostics. */
export type ReviewRead<T> = T | 'missing' | 'error'

/** Read callbacks supplied to either sidebar's review body. */
export interface ReviewReader {
  /** Read a turn summary by its announcing event. */
  summary: (sessionId: SessionId, seq: number, signal: AbortSignal) => Promise<ReviewRead<ChangesSummary>>
  /** Read a file comparison by its original summary index. */
  diff: (sessionId: SessionId, seq: number, index: number, signal: AbortSignal) => Promise<ReviewRead<ChangesDiff>>
}

/**
 * Own all review requests until plugin disposal; each mounted view also supplies its cancellation signal.
 */
export class ChangesReader implements ReviewReader {
  private readonly lifetime = new AbortController()
  private generation = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()

  /** @inheritdoc */
  summary(sessionId: SessionId, seq: number, signal: AbortSignal): Promise<ReviewRead<ChangesSummary>> {
    return this.read(changesSummaryUrl(sessionId, seq), isChangesSummary, signal)
  }

  /** @inheritdoc */
  diff(sessionId: SessionId, seq: number, index: number, signal: AbortSignal): Promise<ReviewRead<ChangesDiff>> {
    return this.read(changesDiffUrl(sessionId, seq, index), isChangesDiff, signal)
  }

  /** Abandon reads owned by a replaced Host connection. */
  reset(): void {
    this.generation.abort()
    this.generation = new AbortController()
  }

  /** Cancel requests and wait until they settle. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.pending)
  }

  private async read<T>(url: string, validate: (value: unknown) => value is T, signal: AbortSignal): Promise<ReviewRead<T>> {
    const combined = AbortSignal.any([signal, this.lifetime.signal, this.generation.signal])
    const task = (async (): Promise<ReviewRead<T>> => {
      try {
        const response = await fetch(url, { signal: combined })
        if (response.status === 404) return 'missing'
        if (!response.ok) return 'error'
        const value: unknown = await response.json()
        combined.throwIfAborted()
        return validate(value) ? value : 'error'
      } catch {
        // Transport failures become retryable view state; callers ignore cancelled results.
        return 'error'
      }
    })()
    this.pending.add(task)
    try { return await task } finally { this.pending.delete(task) }
  }
}
