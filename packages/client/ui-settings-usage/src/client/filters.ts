/** View-only filters and explicit UTC-midnight conversion. */
import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { UsageQueryRequest } from '@deepseek-ai/dsh-api-usage-controller/types'

/** Draft controls survive section remounts but never persist in Host settings. */
export interface UsageFilters {
  fromDate: string
  toDate: string
  provider: string | null
  model: string | null
}

const DAY_MS = 86_400_000

/**
 * Seed a seven-day window including the current UTC date.
 * @param now - Unix milliseconds from the page's current clock.
 * @returns date-only controls and unfiltered route choices.
 */
export function initialFilters(now: number): UsageFilters {
  const midnight = Math.floor(now / DAY_MS) * DAY_MS
  return {
    fromDate: new Date(midnight - 6 * DAY_MS).toISOString().slice(0, 10),
    toDate: new Date(midnight + DAY_MS).toISOString().slice(0, 10),
    provider: null,
    model: null,
  }
}

/**
 * Construct the section's viewing-state handle in the plugin apply lifetime.
 * @returns a store handle containing only dates and route selections.
 */
export function createUsageFiltersStore() {
  return defineStore({
    init: (): UsageFilters => initialFilters(Date.now()),
    actions: {
      setDate(state: UsageFilters, field: 'fromDate' | 'toDate', value: string) { state[field] = value },
      setRoute(state: UsageFilters, field: 'provider' | 'model', value: string | null) { state[field] = value },
    },
  })
}

function utcMidnight(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined
  const value = Date.parse(date + 'T00:00:00.000Z')
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) return undefined
  return value
}

/**
 * Validate native date input and translate to inclusive/exclusive Unix milliseconds.
 * @param filters - current drafts; neither timezone nor locale changes the interval.
 * @returns a request, or undefined for missing, impossible, or reversed dates.
 */
export function requestFromFilters(filters: UsageFilters): UsageQueryRequest | undefined {
  const from = utcMidnight(filters.fromDate)
  const to = utcMidnight(filters.toDate)
  if (from === undefined || to === undefined || from >= to) return undefined
  return {
    from, to,
    ...(filters.provider === null ? {} : { provider: filters.provider }),
    ...(filters.model === null ? {} : { model: filters.model }),
  }
}

/**
 * Compare the displayed report to the current controls before rendering or export.
 * @param a - interval echoed by the Host.
 * @param b - interval currently selected by the user.
 * @returns whether both intervals and exact route selections agree.
 */
export function sameRequest(a: UsageQueryRequest, b: UsageQueryRequest): boolean {
  return a.from === b.from && a.to === b.to && a.provider === b.provider && a.model === b.model
}
