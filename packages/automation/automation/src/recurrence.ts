/** UTC-only recurrence expansion delegated to the maintained cron parser. */
import { CronExpressionParser } from 'cron-parser'
import type { AutomationSchedule } from './types.ts'

/** Return UTC instants strictly after the supplied durable cursor.
 * @param schedule - validated hourly, daily, or weekly UTC rule.
 * @param after - inclusive lower bound as epoch milliseconds.
 * @param count - number of future instants requested.
 * @returns increasing, minute-aligned epoch milliseconds.
 */
export function nextOccurrences(schedule: AutomationSchedule, after: number, count: number): number[] {
  const hours = schedule.kind === 'hourly' ? '*' : String(schedule.hour)
  const weekdays = schedule.kind === 'weekly' ? [...schedule.weekdays].sort().join(',') : '*'
  const expression = CronExpressionParser.parse(
    '0 ' + String(schedule.minute) + ' ' + hours + ' * * ' + weekdays,
    { currentDate: new Date(after), tz: 'UTC', strict: true },
  )
  return Array.from({ length: count }, () => expression.next().getTime())
}
