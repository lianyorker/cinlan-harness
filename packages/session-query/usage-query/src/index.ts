/** Bounded, cancellable usage aggregation over live and cold Session observations. */
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { scheduler } from 'node:timers/promises'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { accountTurn, addCounts, emptyCounts, ownTurns, turnCounts } from './aggregate.ts'
import type { UsagePartialReason, UsageQueryRequest, UsageQueryResult, UsageRow } from './types.ts'
export type * from './types.ts'

/** Deployment bounds on one aggregate query. */
export interface Config {
  /** Maximum Session observations per request. */
  maxSessions: number
  /** Maximum source events admitted across observations. */
  maxEvents: number
  /** Maximum query duration, including cold I/O, in milliseconds. */
  timeoutMs: number
  /** Maximum accepted interval in days. */
  maxRangeDays: number
}

/** Stable failures suitable for translation by the Remote consumer. */
export class UsageQueryError extends Error {
  /**
   * @param code - stable query rejection category.
   * @param message - nonsecret operational description.
   */
  constructor(readonly code: 'invalid-query' | 'timeout' | 'disposed', message: string) {
    super(message)
    this.name = 'UsageQueryError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only exact known-Turn totals and explicit incomplete accounting. */
    usageQuery: UsageQueryService
  }
}

/** Concrete local Host aggregator; Session JSONL remains the only source of accounting. */
export class UsageQueryService extends Service {
  static inject = ['sessionQuery']
  static Config: Schema<Config> = Schema.object({
    maxSessions: Schema.number().step(1).min(1).default(200),
    maxEvents: Schema.number().step(1).min(1).default(200_000),
    timeoutMs: Schema.number().step(1).min(1).max(2_147_483_647).default(15_000),
    maxRangeDays: Schema.number().step(1).min(1).default(366),
  })
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<UsageQueryResult>>()

  /**
   * @param ctx - owning Host fiber with the sessionQuery service.
   * @param config - validated deployment query bounds.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'usageQuery')
    ctx.effect(() => async () => {
      this.lifetime.abort(new UsageQueryError('disposed', 'Usage query service disposed'))
      await Promise.allSettled(this.pending)
    }, 'usage query lifetime')
  }

  /**
   * Read each Session's own Turns without activating or mutating any Session.
   * A source that fails or exceeds aggregation bounds is reported as partial.
   * Cold decoding uses the sessionQuery owner's cancellable observation API;
   * its preparation may read a complete log before its event count is known.
   * @param request - exclusive-end UTC interval and exact route filters.
   * @param signal - caller cancellation, propagated through listing and cold reads.
   * @returns known exact subtotals, route groups, and explicit coverage limitations.
   * @throws on cancellation, service disposal, deadline, invalid range, or unsafe totals.
   */
  async query(request: UsageQueryRequest, signal: AbortSignal): Promise<UsageQueryResult> {
    signal.throwIfAborted()
    this.lifetime.signal.throwIfAborted()
    if (!Number.isSafeInteger(request.from) || !Number.isSafeInteger(request.to)
      || request.from < 0 || request.to <= request.from
      || request.to - request.from > this.config.maxRangeDays * 86_400_000
      || (request.provider !== undefined && (request.provider.length === 0 || request.provider.length > 256))
      || (request.model !== undefined && (request.model.length === 0 || request.model.length > 256))) {
      throw new UsageQueryError('invalid-query', 'Usage interval or route filter is invalid')
    }
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(new UsageQueryError('timeout', 'Usage query timed out')) }, this.config.timeoutMs)
    const activeSignal = AbortSignal.any([signal, this.lifetime.signal, deadline.signal])
    const operation = this.collect(request, activeSignal)
    this.pending.add(operation)
    try {
      return await operation
    } finally {
      clearTimeout(timer)
      this.pending.delete(operation)
    }
  }

  private async collect(request: UsageQueryRequest, signal: AbortSignal): Promise<UsageQueryResult> {
    const records = await this.ctx.sessionQuery.listSessions(signal)
    signal.throwIfAborted()
    const candidates = records.sort((a, b) => b.header.createdAt - a.header.createdAt || a.header.id.localeCompare(b.header.id))
    const reasons = new Set<UsagePartialReason>()
    const rows = new Map<string, UsageRow>()
    const providers = new Set<string>(), models = new Set<string>()
    let totals = emptyCounts()
    let scannedSessions = 0, skippedSessions = 0, examinedEvents = 0, unattributedTurns = 0
    if (candidates.length > this.config.maxSessions) {
      skippedSessions += candidates.length - this.config.maxSessions
      reasons.add('session-limit')
    }
    for (const record of candidates.slice(0, this.config.maxSessions)) {
      signal.throwIfAborted()
      let observation: SessionObservation
      try {
        observation = await this.ctx.sessionQuery.observeSession(record.header.id, { signal, projectionMode: 'none' })
      } catch {
        // A source read failure is counted without exposing paths or log content.
        signal.throwIfAborted()
        skippedSessions++
        reasons.add('source-error')
        continue
      }
      try {
        signal.throwIfAborted()
        scannedSessions++
        const eventCount = observation.cursor + 1
        if (eventCount > this.config.maxEvents - examinedEvents) {
          skippedSessions++
          reasons.add('event-limit')
          continue
        }
        examinedEvents += eventCount
        for (const turn of ownTurns(observation.events, observation.inheritedEventCount)) {
          signal.throwIfAborted()
          if (turn.startedAt < request.from || turn.startedAt >= request.to) continue
          const usage = accountTurn(turn)
          const routeProviders = new Set(usage?.routes?.map(route => route.provider))
          const routeModels = new Set(usage?.routes?.map(route => route.model))
          const provider = routeProviders.size === 1 ? [...routeProviders][0] : undefined
          const model = routeModels.size === 1 ? [...routeModels][0] : undefined
          if (provider !== undefined) providers.add(provider)
          if (model !== undefined) models.add(model)
          if (provider === undefined || model === undefined) unattributedTurns++
          if ((request.provider !== undefined && provider !== request.provider)
            || (request.model !== undefined && model !== request.model)) {
            if ((request.provider !== undefined && provider === undefined)
              || (request.model !== undefined && model === undefined)) reasons.add('unattributed-filter')
            continue
          }
          if (turn.inherited) reasons.add('inherited-boundary')
          if (usage === undefined) reasons.add('unknown-usage')
          const counts = turnCounts(turn, usage)
          totals = addCounts(totals, counts)
          const key = JSON.stringify([provider ?? null, model ?? null])
          rows.set(key, {
            ...(provider === undefined ? {} : { provider }), ...(model === undefined ? {} : { model }),
            ...addCounts(rows.get(key) ?? emptyCounts(), counts),
          })
          await scheduler.yield()
        }
      } finally {
        observation[Symbol.dispose]()
      }
      await scheduler.yield()
    }
    signal.throwIfAborted()
    return {
      request: { ...request }, generatedAt: Date.now(), totals,
      rows: [...rows.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => row),
      providers: [...providers].sort(), models: [...models].sort(),
      scannedSessions, skippedSessions, examinedEvents, unattributedTurns,
      partial: reasons.size > 0, reasons: [...reasons].sort(),
    }
  }
}

export default UsageQueryService
