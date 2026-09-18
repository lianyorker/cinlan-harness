/** Effective shortcuts for registered actions, with a locally focused recorder. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { KeyboardService, KeyboardWriteResult } from '@deepseek-ai/dsh-client-keyboard/client'
import type { KeybindingsKey } from './locales.ts'
import css from './KeybindingsSection.module.css'

/** Plain callbacks and the renderer-bound command snapshot. */
export interface KeybindingsSectionInjected {
  hooks: { keyboard: Pick<KeyboardService, 'getSnapshot' | 'subscribe'> }
  captureKey: KeyboardService['capture']
  setBinding: KeyboardService['setBinding']
  resetBinding: KeyboardService['resetBinding']
  resetAll: KeyboardService['resetAll']
}

/** Settings owner props, localized copy, and the injected keyboard face. */
export type KeybindingsSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.keybindings'> & InjectFace<KeybindingsSectionInjected>

const SCOPE_KEYS: Record<string, KeybindingsKey> = {
  composer: 'categoryConversation', 'composer-popup': 'categoryPopup', editor: 'categoryEditor',
  shell: 'categoryNavigation', settings: 'categorySettings', voice: 'categoryVoice', unavailable: 'categoryUnavailable',
}

/**
 * Render effective bindings and preserve failed choices for an explicit retry.
 * @param props - framework-bound keyboard preferences and commands.
 * @returns the responsive shortcuts page.
 */
export function KeybindingsSection(props: KeybindingsSectionProps): ReactNode {
  const { useKeyboard, captureKey, setBinding, resetBinding, resetAll, t, target } = props
  const snapshot = useKeyboard(value => value)
  const [search, setSearch] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<KeybindingsKey | null>(null)
  const [retry, setRetry] = useState<(() => Promise<KeyboardWriteResult>) | null>(null)
  const writable = snapshot.status === 'ready' && snapshot.writable && !saving
  useEffect(() => { if (target !== undefined) setSearch('') }, [target])

  const save = (operation: () => Promise<KeyboardWriteResult>): void => {
    if (!writable || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    setRetry(null)
    void operation().then((result) => {
      if (result.ok) setRecordingId(null)
      else {
        setError(result.reason === 'failed' ? 'saveFailed' : result.reason === 'conflict' ? 'conflictDescription'
          : result.reason === 'reserved' ? 'reserved' : result.reason === 'invalid' ? 'invalid' : 'unavailableCommand')
        if (result.reason === 'failed') setRetry(() => operation)
      }
    }, () => { setError('saveFailed'); setRetry(() => operation) }).finally(() => {
      inFlight.current = false
      setSaving(false)
    })
  }

  const record = (event: KeyboardEvent<HTMLElement>): void => {
    if (recordingId === null || !writable) return
    const native = event.nativeEvent
    const facts = {
      key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      isComposing: native.isComposing, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
      // oxlint-disable-next-line typescript/no-deprecated
      keyCode: native.keyCode, altGraph: event.getModifierState('AltGraph'),
    }
    if (facts.isComposing || facts.keyCode === 229 || facts.altGraph) return
    if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      setRecordingId(null)
      return
    }
    const result = captureKey(facts)
    if (result.kind === 'ignored') return
    if (result.kind !== 'binding') { setError(result.kind); return }
    event.preventDefault()
    event.stopPropagation()
    save(() => setBinding(recordingId, result.binding))
  }

  const query = search.trim().toLowerCase()
  const filtered = snapshot.commands.filter(command =>
    command.label.toLowerCase().includes(query) || command.id.toLowerCase().includes(query))
  const scopes = [...new Set(filtered.map(command => command.scope))]
  return <section className={css.section} data-keybindings-section aria-busy={saving} onKeyDownCapture={record}>
    <header className={css.heading}><h1>{t('title')}</h1><p>{t('description')}</p></header>
    {snapshot.status !== 'ready' || !snapshot.writable
      ? <p className={css.message} role="status">{t(snapshot.status === 'loading' ? 'loading' : snapshot.status === 'unavailable' ? 'error' : 'readOnly')}</p> : null}
    <input className={css.search} type="search" placeholder={t('search')} aria-label={t('search')} value={search} onChange={(event) => { setSearch(event.currentTarget.value) }} />
    {error !== null ? <div role="alert" className={css.actions}><span className={css.conflict}>{t(error)}</span>
      {retry !== null ? <Button className={css.button} variant="outline" disabled={!writable} onClick={() => { save(retry) }}>{t('retry')}</Button> : null}</div> : null}
    {filtered.length === 0 ? <p className={css.empty}>{t('noResults')}</p> : null}
    {scopes.map(scope => <section className={css.category} key={scope}>
      <h2 className={css.categoryTitle}>{t(SCOPE_KEYS[scope] ?? 'categoryOther')}</h2>
      {filtered.filter(command => command.scope === scope).map(command => <div key={command.id} className={css.commandRow} data-settings-anchor={'keybinding-' + command.id}>
        <div className={css.commandName}><div>{command.label}</div><div className={css.commandDesc}>{command.description}</div>
          {command.status !== 'available' ? <p className={css.commandDesc}>{t(command.status === 'unavailable' ? 'unavailableCommand' : command.status === 'conflict' ? 'conflictDescription' : command.status)}</p> : null}
        </div>
        <div className={css.binding}>{command.bindingLabels.length > 0 ? command.bindingLabels.join(' / ') : t('unbound')}</div>
        <div className={css.actions}>
          <Button className={css.button} variant="outline" disabled={!writable || !command.registered || command.status === 'unavailable'} aria-label={t('recordAction', { command: command.label })}
            onClick={() => { setRecordingId(command.id); setError(null) }}>{t(recordingId === command.id ? 'recording' : 'record')}</Button>
          {recordingId === command.id ? <Button className={css.button} variant="outline" disabled={saving} onClick={() => { setRecordingId(null) }}>{t('cancel')}</Button> : null}
          <Button className={css.button} variant="outline" disabled={!writable || !command.registered || command.status === 'unavailable' || command.bindings.length === 0}
            aria-label={t('unbindAction', { command: command.label })} onClick={() => { save(() => setBinding(command.id, null)) }}>{t('unbind')}</Button>
          <Button className={css.button} variant="outline" disabled={!writable || !command.overridden} aria-label={t('resetAction', { command: command.label })}
            onClick={() => { save(() => resetBinding(command.id)) }}>{t('reset')}</Button>
        </div>
      </div>)}
    </section>)}
    <div className={css.commandRow} data-settings-anchor="keybindings-reset">
      <div className={css.commandName}><div>{t('resetAll')}</div><div className={css.commandDesc}>{t('resetAllDescription')}</div></div>
      <Button className={css.button} variant="outline" disabled={!writable || !snapshot.hasOverrides} onClick={() => { save(resetAll) }}>{t('resetAll')}</Button>
    </div>
  </section>
}
