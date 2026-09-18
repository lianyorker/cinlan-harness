/** UTC recurrence controls; calendar interpretation remains with the Host runtime. */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AutomationSchedule } from '@deepseek-ai/dsh-automation/types'
import { changeFrequency } from './presentation.ts'
import css from './AutomationSettings.module.css'

type Props = PropsLocale<'settings.automation'> & {
  schedule: AutomationSchedule
  onChange: (schedule: AutomationSchedule) => void
}

/**
 * Render UTC frequency, minute, hour, and Sunday-zero weekday controls.
 * @param props - parent-owned draft fields and localized labels.
 * @returns controls that never schedule work by themselves.
 */
export function ScheduleFields({ schedule, onChange, t }: Props): ReactNode {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
  return <>
    <div className={css.field}>
      <label htmlFor="automation-frequency">{t('schedule')}</label>
      <select id="automation-frequency" className={css.select} value={schedule.kind}
        onChange={(event) => { onChange(changeFrequency(schedule, event.currentTarget.value as AutomationSchedule['kind'])) }}>
        <option value="hourly">{t('hourly')}</option><option value="daily">{t('daily')}</option><option value="weekly">{t('weekly')}</option>
      </select>
    </div>
    <div className={css.grid}>
      {schedule.kind !== 'hourly' && <div className={css.field}>
        <label htmlFor="automation-hour">{t('hour')}</label>
        <Input id="automation-hour" className={clsx(css.input)} type="number" min={0} max={23} step={1} required
          value={Number.isNaN(schedule.hour) ? '' : schedule.hour}
          onChange={(event) => { onChange({ ...schedule, hour: event.currentTarget.valueAsNumber }) }} />
      </div>}
      <div className={css.field}>
        <label htmlFor="automation-minute">{t('minute')}</label>
        <Input id="automation-minute" className={clsx(css.input)} type="number" min={0} max={59} step={1} required
          value={Number.isNaN(schedule.minute) ? '' : schedule.minute}
          onChange={(event) => { onChange({ ...schedule, minute: event.currentTarget.valueAsNumber }) }} />
      </div>
    </div>
    {schedule.kind === 'weekly' && <fieldset className={css.fields}>
      <legend className={css.label}>{t('weekdays')}</legend>
      <div className={css.days}>{days.map((day, index) => <label key={day} className={css.day}>
        <input type="checkbox" checked={schedule.weekdays.includes(index)} onChange={(event) => {
          onChange({ ...schedule, weekdays: event.currentTarget.checked
            ? [...schedule.weekdays, index].sort((a, b) => a - b) : schedule.weekdays.filter(value => value !== index) })
        }} />{t(day)}
      </label>)}</div>
    </fieldset>}
    <p className={css.help}>{t('utc')}</p>
  </>
}
