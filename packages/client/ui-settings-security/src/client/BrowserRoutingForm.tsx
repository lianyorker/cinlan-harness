/** Sidebar-owned link routing, independent of Browser Provider launch preferences. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import { BROWSER_ROUTING_FIELDS } from './settings-fields.ts'
import css from './CapabilitySection.module.css'

/** The sidebar fields this form may save or reset. */
export type BrowserRoutingPreferences = Pick<SidebarPrefs, (typeof BROWSER_ROUTING_FIELDS)[number]['key']>

type Props = Pick<CapabilitySectionProps, 'useBrowserRouting' | 'saveBrowserRouting' | 'resetBrowserRouting' | 't'>
interface Draft {
  base: BrowserRoutingPreferences
  changes: Partial<BrowserRoutingPreferences>
  revision: number
}

/**
 * Edit link routing without changing other sidebar preferences or starting a browser.
 * @param props - Renderer-bound sidebar settings and revision-fenced routing callbacks.
 * @returns Routing switches and explicit save, discard, and reset actions.
 */
export function BrowserRoutingForm({ useBrowserRouting, saveBrowserRouting, resetBrowserRouting, t }: Props): ReactNode {
  const snapshot = useBrowserRouting(value => value)
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'reset' | 'error'>('idle')
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const value = draft === undefined ? snapshot.value : { ...draft.base, ...draft.changes }
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const change = (key: keyof BrowserRoutingPreferences, checked: boolean): void => {
    if (!writable || pending.current || snapshot.value === undefined || snapshot.revision === undefined) return
    const base = draft?.base ?? {
      browserInterceptLinks: snapshot.value.browserInterceptLinks,
      browserInterceptHttp: snapshot.value.browserInterceptHttp,
      browserInterceptHttps: snapshot.value.browserInterceptHttps,
    }
    const { [key]: _previous, ...otherChanges }: Partial<BrowserRoutingPreferences> = draft?.changes ?? {}
    const changes: Partial<BrowserRoutingPreferences> = otherChanges
    if (checked !== base[key]) changes[key] = checked
    setDraft(Object.keys(changes).length === 0 ? undefined : { base, changes, revision: draft?.revision ?? snapshot.revision })
    setStatus('idle')
  }
  const save = async (reset = false): Promise<void> => {
    if (!writable || pending.current || snapshot.revision === undefined || (!reset && draft === undefined)) return
    pending.current = true
    setStatus('saving')
    try {
      if (reset) await resetBrowserRouting(draft?.revision ?? snapshot.revision)
      else if (draft !== undefined) await saveBrowserRouting(draft.changes, draft.revision)
    } catch (_settingsWriteRejected) {
      if (active.current) setStatus('error')
      return
    } finally {
      pending.current = false
    }
    if (active.current) { setDraft(undefined); setStatus(reset ? 'reset' : 'saved') }
  }
  return <form className={css.browserPreferences} aria-label={t('browserRoutingTitle')}
    onSubmit={(event) => { event.preventDefault(); void save() }}>
    <h2>{t('browserRoutingTitle')}</h2>
    {snapshot.status !== 'ready' && <p role="status">{t(snapshot.status === 'loading' ? 'preferencesLoading' : 'preferencesUnavailable')}</p>}
    <fieldset disabled={!writable || status === 'saving'}>
      {BROWSER_ROUTING_FIELDS.map(field => <label key={field.key} className={css.settingRow} data-settings-anchor={field.anchorId}>
        <span>{t(field.title)}<small>{t(field.description)}</small></span>
        {snapshot.status !== 'ready' || value === undefined
          ? <span>{t(snapshot.status === 'loading' ? 'statusLoading' : 'fieldUnavailable')}</span>
          : <Switch label={t(field.title)} checked={value[field.key]} disabled={!writable || status === 'saving'}
            onChange={(checked) => { change(field.key, checked) }} />}
      </label>)}
      <div className={css.browserActions}>
        <button className={css.recheckButton} type="submit" disabled={draft === undefined}>{t(status === 'saving' ? 'preferencesSaving' : 'browserRoutingSave')}</button>
        <button className={css.recheckButton} type="button" disabled={draft === undefined}
          onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('preferencesDiscard')}</button>
        <button className={css.recheckButton} type="button" onClick={() => { void save(true) }}>{t('preferencesReset')}</button>
      </div>
    </fieldset>
    {!writable && <p>{t('preferencesReadOnly')}</p>}
    {(status === 'saved' || status === 'reset') && <p role="status">{t(status === 'reset' ? 'browserRoutingReset' : 'browserRoutingSaved')}</p>}
    {status === 'error' && <p className={css.failure} role="alert">{t('browserSettingsFailed')}</p>}
  </form>
}
