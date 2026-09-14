/** Notifications settings page shown inside the Settings shell. */

import { IconAlarmClockOutline16, IconQueueOutline14, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings, NotificationSound } from '@deepseek-ai/dsh-notifications/types'
import type { NotificationsKey } from './locales.ts'
import css from './NotificationsSection.module.css'
import type { NotificationRuntimeFace } from './runtime.ts'

/** Injected browser capabilities for the settings section. */
export interface NotificationsSectionInjected {
  /** Settings namespace scope (plain prop 鈥?needs both read and write faces). */
  settings: SettingsScope<NotificationSettings>
  /** Notification delivery runtime. */
  runtime: NotificationRuntimeFace
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

/** Render one two-line preference row with a right-aligned control. */
function PreferenceRow({ title, description, children }: {
  title: string
  description: string
  children: ReactNode
}): ReactNode {
  return <div className={css.row}>
    <div className={css.copy}><div className={css.title}>{title}</div><div className={css.description}>{description}</div></div>
    <div className={css.control}>{children}</div>
  </div>
}

/** Render the Notifications Settings section. */
export function NotificationsSection(props: NotificationsSectionProps): ReactNode {
  const { t, settings, runtime } = props
  const snapshot = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
    () => settings.getSnapshot(),
  )
  const value = snapshot.value ?? DEFAULT_SETTINGS
  const [saving, setSaving] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'sent' | 'unavailable'>('idle')
  const fileInput = useRef<HTMLInputElement>(null)
  const writable = snapshot.status === 'ready' && snapshot.writable

  const write = (field: string, next: unknown): void => {
    setSaving(true)
    void settings.set(field, next).finally(() => { setSaving(false) })
  }

  const selectCustom = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    const name = file.name
    runtime.registerCustomSound(name, file)
    setSaving(true)
    void settings.mutate([
      { op: 'set', path: ['sound'], value: 'custom' },
      { op: 'set', path: ['customSoundName'], value: name },
    ]).finally(() => { setSaving(false) })
    event.currentTarget.value = ''
  }

  const sendTest = (): void => {
    setTestState('idle')
    void runtime.test().then((sent) => { setTestState(sent ? 'sent' : 'unavailable') })
  }

  return <section className={css.section} aria-labelledby="notifications-title">
    <header className={css.header}><h2 id="notifications-title">{t('title')}</h2><p>{t('description')}</p></header>
    <div className={css.card}>
      <PreferenceRow title={t('enabled')} description={t('enabledDescription')}>
        <Switch checked={value.enabled} disabled={!writable || saving} label={t('enabled')} onChange={(next) => { write('enabled', next) }} />
      </PreferenceRow>
      <PreferenceRow title={t('agentCompletion')} description={t('agentCompletionDescription')}>
        <Switch checked={value.agentCompletion} disabled={!writable || saving || !value.enabled} label={t('agentCompletion')} onChange={(next) => { write('agentCompletion', next) }} />
      </PreferenceRow>
      <PreferenceRow title={t('terminalBell')} description={t('terminalBellDescription')}>
        <Switch checked={value.terminalBell} disabled={!writable || saving || !value.enabled} label={t('terminalBell')} onChange={(next) => { write('terminalBell', next) }} />
      </PreferenceRow>
      <div className={css.separator} />
      <div className={css.selectRow}>
        <div className={css.copy}><div className={css.title}><IconAlarmClockOutline16 size={16} />{t('sound')}</div><div className={css.description}>{t('soundDescription')}</div></div>
        <select className={css.select} value={value.sound} disabled={!writable || saving || !value.enabled} aria-label={t('sound')} onChange={(event) => {
          const sound = event.currentTarget.value as NotificationSound
          if (sound === 'custom') { fileInput.current?.click(); return }
          write('sound', sound)
        }}>
          {(Object.keys(SOUND_KEYS) as NotificationSound[]).filter(sound => sound !== 'custom' || value.sound === 'custom').map(sound => <option key={sound} value={sound}>{t(SOUND_KEYS[sound])}</option>)}
        </select>
        <input ref={fileInput} className={css.file} type="file" accept="audio/*" aria-label={t('soundCustom')} onChange={selectCustom} />
      </div>
      <div className={css.separator} />
      <PreferenceRow title={t('focusSuppression')} description={t('focusSuppressionDescription')}>
        <Switch checked={value.suppressWhenFocused} disabled={!writable || saving || !value.enabled} label={t('focusSuppression')} onChange={(next) => { write('suppressWhenFocused', next) }} />
      </PreferenceRow>
      <button type="button" className={css.testButton} disabled={!value.enabled || !writable || saving} onClick={sendTest}>
        <IconQueueOutline14 size={16} />{t('sendTest')}
      </button>
      {testState === 'sent' ? <p className={css.feedback} role="status">{t('testBody')}</p> : null}
      {testState === 'unavailable' ? <p className={css.feedback} role="alert">{t('unsupported')}</p> : null}
    </div>
  </section>
}
