/** UTC calendar behavior is independent of the Host's display timezone. */
import { describe, expect, it } from 'vitest'
import { nextOccurrences } from '../src/recurrence.ts'
import { scheduleSchema } from '../src/schema.ts'

describe('UTC automation recurrence', () => {
  it('advances hourly beyond an exact cursor and across the year boundary', () => {
    const dates = nextOccurrences({ kind: 'hourly', minute: 30 }, Date.parse('2025-12-31T23:30:00Z'), 2)
    expect(dates.map(value => new Date(value).toISOString())).toEqual(['2026-01-01T00:30:00.000Z', '2026-01-01T01:30:00.000Z'])
  })
  it('keeps daily UTC time across leap day', () => {
    const dates = nextOccurrences({ kind: 'daily', hour: 9, minute: 0 }, Date.parse('2028-02-28T09:00:00Z'), 2)
    expect(dates.map(value => new Date(value).toISOString())).toEqual(['2028-02-29T09:00:00.000Z', '2028-03-01T09:00:00.000Z'])
  })
  it('uses selected weekdays and does not backfill past occurrences', () => {
    const dates = nextOccurrences({ kind: 'weekly', weekdays: [1, 5], hour: 9, minute: 15 }, Date.parse('2026-09-18T09:15:00Z'), 2)
    expect(dates.map(value => new Date(value).toISOString())).toEqual(['2026-09-21T09:15:00.000Z', '2026-09-25T09:15:00.000Z'])
  })
  it('retains distinct UTC slots when local display skips or repeats an hour', () => {
    const spring = nextOccurrences({ kind: 'hourly', minute: 30 }, Date.parse('2025-03-09T06:00:00Z'), 2)
    const fall = nextOccurrences({ kind: 'hourly', minute: 30 }, Date.parse('2025-11-02T05:00:00Z'), 2)
    expect(spring.map(value => new Date(value).toISOString())).toEqual(['2025-03-09T06:30:00.000Z', '2025-03-09T07:30:00.000Z'])
    expect(fall.map(value => new Date(value).toISOString())).toEqual(['2025-11-02T05:30:00.000Z', '2025-11-02T06:30:00.000Z'])
    const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    expect(spring.map(value => clock.format(value))).toEqual(['01:30', '03:30'])
    expect(fall.map(value => clock.format(value))).toEqual(['01:30', '01:30'])
  })
  it('rejects unsupported timezone and recurrence syntax rather than ignoring it', () => {
    expect(scheduleSchema.safeParse({ kind: 'hourly', minute: 0, timezone: 'Asia/Shanghai' }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'weekly', hour: 9, minute: 0, weekdays: [] }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'weekly', hour: 9, minute: 0, weekdays: [1, 1] }).success).toBe(false)
    expect(scheduleSchema.safeParse({ kind: 'hourly', minute: 60 }).success).toBe(false)
    expect(scheduleSchema.safeParse({ cron: '* * * * *' }).success).toBe(false)
  })
})
