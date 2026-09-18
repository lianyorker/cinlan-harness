/** Notifications settings page shown inside the Settings shell. */

import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings, NotificationSound } from '@deepseek-ai/dsh-notifications/types'
import type { NotificationsKey } from './locales.ts'
import { hasNotificationOverrides } from './settings-actions.ts'
import type { createNotificationSettingsActions } from './settings-actions.ts'
import css from './NotificationsSection.module.css'

/** Injected preference commands and renderer-bound settings source. */
export type NotificationsSectionInjected = ReturnType<typeof createNotificationSettingsActions> & {
  /** Bare source bound to useSettings by the slot renderer. */
  hooks: { settings: Pick<SettingsScope<NotificationSettings>, 'getSnapshot' | 'subscribe'> }
  /** Send a real system notification from this user gesture. */
  testNotification: () => Promise<boolean>
}

/** Props assembled by the Settings renderer. */
export type NotificationsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.notifications'>
  & InjectFace<NotificationsSectionInjected>

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: false,
  agentCompletion: false,
  terminalBell: false,
  sound: 'system',
  suppressWhenFocused: false,
  customSoundName: '',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
}

const SOUND_KEYS: Record<NotificationSound, NotificationsKey> = {
  system: 'soundSystem',
  'two-tone': 'soundTwoTone',
  ding: 'soundDing',
  pop: 'soundPop',
  spark: 'soundSpark',
  flame: 'soundFlame',
  t: 'soundT',
  click: 'soundClick',
  custom: 'customSound',
}

function PreferenceRow({ anchor, title, description, children }: {
  anchor: string
  title: string
  description: string
  children: ReactNode
}): ReactNode {
  return <div className={css.row} data-settings-anchor={anchor}>
    <div className={css.copy}><div className={css.title}>{title}</div><div className={css.description}>{description}</div></div>
    <div className={css.control}>{children}</div>
  </div>
}

/**
 * Render persisted notification preferences and delivery feedback.
 * @param props - settings snapshot hook and commands composed by the slot renderer.
 * @returns the notification page with stable field navigation anchors.
 */
export function NotificationsSection(props: NotificationsSectionProps): ReactNode {
  const { t, useSettings, writePreference, writeQuietHours, selectCustomSound, resetPreferences, testNotification } = props
  const snapshot = useSettings(state => state)
  const value = snapshot.value ?? DEFAULT_SETTINGS
  const [saving, setSaving] = useState(false)
  const [failedWrite, setFailedWrite] = useState<(() => Promise<boolean>) | null>(null)
  const [quietDraft, setQuietDraft] = useState<{ start: string; end: string; revision: number | undefined } | null>(null)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'unavailable'>('idle')
  const fileInput = useRef<HTMLInputElement>(null)
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const disabled = !writable || saving
  const dependentDisabled = disabled || !value.enabled
  const quietDisabled = dependentDisabled || !value.quietHoursEnabled
  const quietStart = quietDraft?.start ?? value.quietHoursStart
  const quietEnd = quietDraft?.end ?? value.quietHoursEnd

  const save = (operation: () => Promise<boolean>, retry = operation): void => {
    setSaving(true)
    setFailedWrite(null)
    void operation().then((saved) => {
      if (!saved) setFailedWrite(() => retry)
    }, () => { setFailedWrite(() => retry) }).finally(() => { setSaving(false) })
  }

  const editQuietTime = (field: 'start' | 'end', time: string): void => {
    setFailedWrite(null)
    setQuietDraft(draft => ({
      ...(draft ?? { start: value.quietHoursStart, end: value.quietHoursEnd, revision: snapshot.revision }),
      [field]: time,
    }))
  }

  const selectCustom = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    save(() => selectCustomSound(file))
    event.currentTarget.value = ''
  }

  const sendTest = (): void => {
    setTestState('sending')
    void testNotification().then((sent) => {
      setTestState(sent ? 'sent' : 'unavailable')
    }, () => { setTestState('unavailable') })
  }

  return <section className={css.section} aria-labelledby="notifications-title" aria-busy={saving}>
    <header className={css.header}><h1 id="notifications-title">{t('title')}</h1><p>{t('description')}</p></header>
    {snapshot.status !== 'ready' || !snapshot.writable
      ? <p className={css.feedback} role="status">{t(snapshot.status === 'loading' ? 'loading' : snapshot.status === 'unavailable' ? 'settingsUnavailable' : 'readOnly')}</p>
      : null}
    <section className={css.group} aria-labelledby="notifications-desktop-title">
      <h2 id="notifications-desktop-title">{t('desktopGroup')}</h2>
      <PreferenceRow anchor="notifications-enabled" title={t('enabled')} description={t('enabledDescription')}>
        <Switch checked={value.enabled} disabled={disabled} label={t('enabled')} onChange={(next) => { save(() => writePreference('enabled', next)) }} />
      </PreferenceRow>
      <PreferenceRow anchor="notifications-agent-completion" title={t('agentCompletion')} description={t('agentCompletionDescription')}>
        <Switch checked={value.agentCompletion} disabled={dependentDisabled} label={t('agentCompletion')} onChange={(next) => { save(() => writePreference('agentCompletion', next)) }} />
      </PreferenceRow>
      <PreferenceRow anchor="notifications-terminal-bell" title={t('terminalBell')} description={t('terminalBellDescription')}>
        <Switch checked={value.terminalBell} disabled={dependentDisabled} label={t('terminalBell')} onChange={(next) => { save(() => writePreference('terminalBell', next)) }} />
      </PreferenceRow>
      <PreferenceRow anchor="notifications-focus-suppression" title={t('focusSuppression')} description={t('focusSuppressionDescription')}>
        <Switch checked={value.suppressWhenFocused} disabled={dependentDisabled} label={t('focusSuppression')} onChange={(next) => { save(() => writePreference('suppressWhenFocused', next)) }} />
      </PreferenceRow>
      <PreferenceRow anchor="notifications-test" title={t('testTitle')} description={t('testDescription')}>
        <Button variant="outline" disabled={dependentDisabled || testState === 'sending'} onClick={sendTest}>{t('sendTest')}</Button>
      </PreferenceRow>
      {testState === 'sent' ? <p className={css.feedback} role="status">{t('testSent')}</p> : null}
      {testState === 'unavailable' ? <p className={css.error} role="alert">{t('testUnavailable')}</p> : null}
    </section>
    <section className={css.group} aria-labelledby="notifications-quiet-title">
      <h2 id="notifications-quiet-title">{t('quietHoursGroup')}</h2>
      <PreferenceRow anchor="notifications-quiet-hours" title={t('quietHoursEnabled')} description={t('quietHoursDescription')}>
        <Switch checked={value.quietHoursEnabled} disabled={dependentDisabled} label={t('quietHoursEnabled')} onChange={(next) => {
          setQuietDraft(null)
          save(() => writePreference('quietHoursEnabled', next))
        }} />
      </PreferenceRow>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (quietDraft === null || quietDisabled) return
        const { start, end, revision } = quietDraft
        setQuietDraft(null)
        save(() => writeQuietHours(start, end, revision), () => writeQuietHours(start, end))
      }}>
        <PreferenceRow anchor="notifications-quiet-start" title={t('quietHoursStart')} description={t('quietHoursStartDescription')}>
          <Input type="time" step={60} required className={css.time ?? ''} value={quietStart} disabled={quietDisabled} aria-label={t('quietHoursStart')}
            onChange={(event) => { editQuietTime('start', event.currentTarget.value) }} />
        </PreferenceRow>
        <PreferenceRow anchor="notifications-quiet-end" title={t('quietHoursEnd')} description={t('quietHoursEndDescription')}>
          <Input type="time" step={60} required className={css.time ?? ''} value={quietEnd} disabled={quietDisabled} aria-label={t('quietHoursEnd')}
            onChange={(event) => { editQuietTime('end', event.currentTarget.value) }} />
        </PreferenceRow>
        <div className={css.scheduleActions}>
          <Button type="submit" variant="outline" disabled={quietDisabled || quietDraft === null || quietStart === '' || quietEnd === ''}>{t('saveQuietHours')}</Button>
        </div>
      </form>
    </section>
    <section className={css.group} aria-labelledby="notifications-sounds-title">
      <h2 id="notifications-sounds-title">{t('soundsGroup')}</h2>
      <PreferenceRow anchor="notifications-sound" title={t('sound')} description={t('soundDescription')}>
        <select className={css.select} value={value.sound} disabled={dependentDisabled} aria-label={t('sound')} onChange={(event) => {
          const sound = event.currentTarget.value as NotificationSound
          if (sound === 'custom') { fileInput.current?.click(); return }
          save(() => writePreference('sound', sound))
        }}>
          {(Object.keys(SOUND_KEYS) as NotificationSound[]).map(sound => <option key={sound} value={sound}>{t(SOUND_KEYS[sound])}</option>)}
        </select>
      </PreferenceRow>
      <PreferenceRow anchor="notifications-custom-sound" title={t('customSound')} description={t('customSoundDescription')}>
        {value.sound === 'custom' && value.customSoundName !== '' ? <span className={css.fileName}>{value.customSoundName}</span> : null}
        <Button variant="outline" disabled={dependentDisabled} onClick={() => { fileInput.current?.click() }}>{t('soundCustom')}</Button>
        <input ref={fileInput} className={css.file} type="file" accept="audio/*" disabled={dependentDisabled} aria-label={t('soundCustom')} onChange={selectCustom} />
      </PreferenceRow>
    </section>
    <div className={css.footer}>
      <PreferenceRow anchor="notifications-reset" title={t('resetTitle')} description={t('resetDescription')}>
        <Button variant="outline" disabled={disabled || !hasNotificationOverrides(snapshot.user)} onClick={() => {
          setQuietDraft(null)
          save(resetPreferences)
        }}>{t('reset')}</Button>
      </PreferenceRow>
      {failedWrite !== null ? <div className={css.failure} role="alert">
        <p className={css.error}>{t('saveFailed')}</p>
        <Button variant="outline" disabled={disabled} onClick={() => { save(failedWrite) }}>{t('retry')}</Button>
      </div> : null}
    </div>
  </section>
}
