/** Local browser launch preferences, persisted through the Settings-owned scope. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserPreferences } from '@deepseek-ai/dsh-browser-playwright/types'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'
import { BROWSER_FIELDS } from './settings-fields.ts'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'

type Props = Pick<CapabilitySectionProps, 'useBrowserPreferences' | 'saveBrowserPreferences' | 'resetBrowserPreferences' | 't'>
interface Draft { value: BrowserPreferences; revision: number }

/**
 * Edit only launch preferences; saving never opens a browser or grants tool permissions.
 * @param props - Renderer-bound Settings source and revision-fenced write callback.
 * @returns The localized form or an explicit unavailable state.
 */
export function BrowserPreferencesForm({ useBrowserPreferences, saveBrowserPreferences, resetBrowserPreferences, t }: Props): ReactNode {
  const snapshot = useBrowserPreferences(value => value)
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'reset' | 'error'>('idle')
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const value = draft?.value ?? snapshot.value
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const change = (patch: Partial<BrowserPreferences>): void => {
    if (!writable || value === undefined || snapshot.revision === undefined) return
    setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? snapshot.revision })
    setStatus('idle')
  }
  const save = async (reset = false): Promise<void> => {
    if (!writable || pending.current || snapshot.revision === undefined || (!reset && draft === undefined)) return
    pending.current = true
    setStatus('saving')
    try {
      if (reset) await resetBrowserPreferences(draft?.revision ?? snapshot.revision)
      else if (draft !== undefined) await saveBrowserPreferences(draft.value, draft.revision)
      if (active.current) { setDraft(undefined); setStatus(reset ? 'reset' : 'saved') }
    } catch (_settingsWriteRejected) {
      if (active.current) setStatus('error')
    } finally {
      pending.current = false
    }
  }
  return <form className={css.browserPreferences} onSubmit={(event) => { event.preventDefault(); void save() }}>
    {snapshot.status !== 'ready' && <p role="status">{t(snapshot.status === 'loading' ? 'browserSettingsLoading' : 'browserSettingsUnavailable')}</p>}
    <fieldset disabled={!writable || status === 'saving'}>
      {BROWSER_FIELDS.map(field => <label key={field.key} className={css.settingRow} data-settings-anchor={field.anchorId}>
        <span>{t(field.title)}<small>{t(field.description)}</small></span>
        {snapshot.status !== 'ready' || value === undefined
          ? <span>{t(snapshot.status === 'loading' ? 'statusLoading' : 'fieldUnavailable')}</span>
          : field.key === 'browserChannel' ? <select aria-label={t(field.title)} value={value.browserChannel}
            onChange={(event) => { change({ browserChannel: event.currentTarget.value as BrowserPreferences['browserChannel'] }) }}>
            <option value="chrome">{t('browserChrome')}</option><option value="msedge">{t('browserEdge')}</option><option value="chromium">{t('browserChromium')}</option>
          </select>
            : field.key === 'searchEngine' ? <select aria-label={t(field.title)} value={value.searchEngine}
              onChange={(event) => { change({ searchEngine: event.currentTarget.value as BrowserPreferences['searchEngine'] }) }}>
              <option value="google">{t('browserGoogle')}</option><option value="bing">{t('browserBing')}</option><option value="duckduckgo">{t('browserDuckDuckGo')}</option>
            </select>
              : field.key === 'headless' ? <Switch label={t(field.title)} checked={value.headless}
                disabled={!writable || status === 'saving'} onChange={(headless) => { change({ headless }) }} />
                : field.key === 'viewportWidth' || field.key === 'viewportHeight'
                  ? <input type="number" aria-label={t(field.title)} min={1} step={1} required value={value[field.key]}
                    onChange={(event) => { change({ [field.key]: Number(event.currentTarget.value) }) }} />
                  : <input type="text" aria-label={t(field.title)} value={value[field.key]} required maxLength={field.key === 'profileName' ? 64 : 8192}
                    {...field.key === 'profileName' ? { pattern: '[a-z][a-z0-9_-]{0,63}' } : {}}
                    onChange={(event) => { change({ [field.key]: event.currentTarget.value }) }} />}
      </label>)}
      <div className={css.browserActions}>
        <button className={css.recheckButton} type="submit" disabled={draft === undefined}>{t(status === 'saving' ? 'browserSettingsSaving' : 'browserSettingsSave')}</button>
        <button className={css.recheckButton} type="button" disabled={draft === undefined}
          onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('browserSettingsDiscard')}</button>
        <button className={css.recheckButton} type="button" onClick={() => { void save(true) }}>{t('preferencesReset')}</button>
      </div>
    </fieldset>
    <p>{t('browserSettingsRestart')}</p>
    {!writable && <p>{t('browserSettingsReadOnly')}</p>}
    {(status === 'saved' || status === 'reset') && <p role="status">{t(status === 'reset' ? 'browserSettingsReset' : 'browserSettingsSaved')}</p>}
    {status === 'error' && <p className={css.failure} role="alert">{t('browserSettingsFailed')}</p>}
  </form>
}
