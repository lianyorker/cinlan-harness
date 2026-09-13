/** Local browser launch preferences, persisted through the Settings-owned scope. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BrowserPreferences } from '@deepseek-ai/dsh-browser-playwright/types'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'

type Props = Pick<CapabilitySectionProps, 'useBrowserPreferences' | 'saveBrowserPreferences' | 't'>
interface Draft { value: BrowserPreferences; revision: number }

/**
 * Edit only launch preferences; saving never opens a browser or grants tool permissions.
 * @param props - Renderer-bound Settings source and revision-fenced write callback.
 * @returns The localized form or an explicit unavailable state.
 */
export function BrowserPreferencesForm({ useBrowserPreferences, saveBrowserPreferences, t }: Props): ReactNode {
  const snapshot = useBrowserPreferences(value => value)
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
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
  const save = async (): Promise<void> => {
    if (!writable || draft === undefined || pending.current) return
    pending.current = true
    setStatus('saving')
    try {
      await saveBrowserPreferences(draft.value, draft.revision)
      if (active.current) { setDraft(undefined); setStatus('saved') }
    } catch (_settingsWriteRejected) {
      if (active.current) setStatus('error')
    } finally {
      pending.current = false
    }
  }
  if (snapshot.status !== 'ready' || value === undefined) {
    return <p>{t(snapshot.status === 'loading' ? 'browserSettingsLoading' : 'browserSettingsUnavailable')}</p>
  }
  return <form className={css.browserPreferences} onSubmit={(event) => { event.preventDefault(); void save() }}>
    <fieldset disabled={!writable || status === 'saving'}>
      <label><span>{t('browserChannelLabel')}</span><select value={value.browserChannel}
        onChange={(event) => { change({ browserChannel: event.currentTarget.value as BrowserPreferences['browserChannel'] }) }}>
        <option value="chrome">{t('browserChrome')}</option>
        <option value="msedge">{t('browserEdge')}</option>
        <option value="chromium">{t('browserChromium')}</option>
      </select></label>
      <label><span>{t('browserHeadlessLabel')}</span><input type="checkbox" checked={value.headless}
        onChange={(event) => { change({ headless: event.currentTarget.checked }) }} /></label>
      <label><span>{t('browserViewportWidth')}</span><input type="number" min={1} step={1} required
        value={value.viewportWidth} onChange={(event) => { change({ viewportWidth: Number(event.currentTarget.value) }) }} /></label>
      <label><span>{t('browserViewportHeight')}</span><input type="number" min={1} step={1} required
        value={value.viewportHeight} onChange={(event) => { change({ viewportHeight: Number(event.currentTarget.value) }) }} /></label>
      <label><span>{t('browserProfileName')}</span><input type="text" value={value.profileName} required maxLength={64}
        pattern="[a-z][a-z0-9_-]{0,63}" onChange={(event) => { change({ profileName: event.currentTarget.value }) }} /></label>
      <label><span>{t('browserHomePage')}</span><input type="text" value={value.homePage} required maxLength={8192}
        onChange={(event) => { change({ homePage: event.currentTarget.value }) }} /></label>
      <label><span>{t('browserSearchEngine')}</span><select value={value.searchEngine}
        onChange={(event) => { change({ searchEngine: event.currentTarget.value as BrowserPreferences['searchEngine'] }) }}>
        <option value="google">{t('browserGoogle')}</option><option value="bing">{t('browserBing')}</option>
        <option value="duckduckgo">{t('browserDuckDuckGo')}</option>
      </select></label>
      <button className={css.recheckButton} type="submit" disabled={draft === undefined}>{t(status === 'saving' ? 'browserSettingsSaving' : 'browserSettingsSave')}</button>
      {draft !== undefined && <button className={css.recheckButton} type="button"
        onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('browserSettingsDiscard')}</button>}
    </fieldset>
    <p>{t('browserSettingsRestart')}</p>
    {!writable && <p>{t('browserSettingsReadOnly')}</p>}
    {status === 'saved' && <p role="status">{t('browserSettingsSaved')}</p>}
    {status === 'error' && <p className={css.failure} role="alert">{t('browserSettingsFailed')}</p>}
  </form>
}
