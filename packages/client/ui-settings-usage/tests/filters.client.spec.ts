import { describe, expect, it } from 'vitest'
import { createUsageFiltersStore, initialFilters, requestFromFilters, sameRequest } from '../src/client/filters.ts'

const filters = { fromDate: '2026-03-08', toDate: '2026-03-09', provider: null, model: null }

describe('UTC Usage filters', () => {
  it('uses UTC midnights across a local daylight-saving boundary', () => {
    expect(requestFromFilters(filters)).toEqual({ from: Date.UTC(2026, 2, 8), to: Date.UTC(2026, 2, 9) })
    expect(initialFilters(Date.parse('2026-03-08T23:59:00-07:00'))).toEqual({
      fromDate: '2026-03-03', toDate: '2026-03-10', provider: null, model: null,
    })
  })

  it.each(['', '2026-02-30', '2026-13-01', '03/08/2026', '2026-03-09', '2026-03-10'])(
    'rejects invalid or non-increasing start date %s', (fromDate) => {
      expect(requestFromFilters({ ...filters, fromDate })).toBeUndefined()
    },
  )

  it('preserves exact arbitrary routes and separates unknown selections from empty labels', () => {
    const query = requestFromFilters({ ...filters, provider: '', model: '=1+1' })!
    expect(query).toMatchObject({ provider: '', model: '=1+1' })
    expect(sameRequest(query, { ...query })).toBe(true)
    expect(sameRequest(query, { ...query, model: 'other' })).toBe(false)
  })

  it('owns filters per store instance without holding a report or persisting them', () => {
    const handle = createUsageFiltersStore()
    const first = handle.create()
    const second = handle.create()
    first.actions.setDate('fromDate', '2026-01-01')
    first.actions.setDate('toDate', '2026-02-01')
    first.actions.setRoute('provider', 'provider-a')
    first.actions.setRoute('model', 'model-a')
    expect(requestFromFilters(first.getSnapshot())).toEqual({
      from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 1, 1), provider: 'provider-a', model: 'model-a',
    })
    expect(second.getSnapshot().provider).toBeNull()
    expect(handle.spec.persist).toBeUndefined()
  })
})
