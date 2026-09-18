/** Editable preferences for integrated sidebar terminals, gated by the actual host capability. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SidebarPrefs, BetterSidebarService } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import css from './TerminalSettingsSection.module.css'

/** The existing sidebar fields controlled by this page. */
export const TERMINAL_FIELDS = [
  'terminalShell', 'terminalShellArgs', 'terminalFontFamily', 'terminalFontSize',
  'terminalScrollback', 'terminalCursorStyle', 'terminalCursorBlink',
] as const

/** Public search targets remain present even when terminal execution is unavailable. */
export const TERMINAL_ITEMS = [
  ['shell', 'shell', 'shellDescription'],
  ['shell-arguments', 'args', 'argsDescription'],
  ['font-family', 'font', 'fontDescription'],
  ['font-size', 'fontSize', 'fontSizeDescription'],
  ['scrollback', 'scrollback', 'scrollbackDescription'],
  ['cursor-style', 'cursorStyle', 'cursorDescription'],
  ['cursor-blink', 'cursorBlink', 'cursorBlinkDescription'],
] as const

/** Durable preference subset owned by the sidebar Host schema. */
export type TerminalPreferences = Pick<SidebarPrefs, typeof TERMINAL_FIELDS[number]>
/** Actual integrated terminal availability, supplied by the sidebar service. */
export type TerminalCapability = Awaited<ReturnType<BetterSidebarService['getTerminalCapability']>>

/** Renderer-bound settings source and explicit user operations. */
export interface TerminalSettingsInjected {
  hooks: { preferences: SettingsScope<SidebarPrefs> }
  checkCapability: () => Promise<TerminalCapability>
  save: (changes: Partial<TerminalPreferences>, revision: number) => Promise<boolean>
  reset: (revision: number) => Promise<boolean>
}

/** Composed settings section props. */
export type TerminalSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.terminal'>
  & InjectFace<TerminalSettingsInjected>

type Draft = { changes: Partial<TerminalPreferences>; revision: number }

/**
 * Render the native terminal preferences form with confirmed writes and resets.
 * @param props - framework-bound settings source, locale and mutation callbacks.
 * @returns a capability-gated form; absence never presents enabled preferences.
 */
export function TerminalSettingsSection({ usePreferences, checkCapability, save, reset, t }: TerminalSettingsProps): ReactNode {
  const snapshot = usePreferences(value => value)
  const [capability, setCapability] = useState<TerminalCapability>()
  const [checkFailed, setCheckFailed] = useState(false)
  const [checkRevision, setCheckRevision] = useState(0)
  const [draft, setDraft] = useState<Draft>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'reset' | 'error'>('idle')
  const [resetRevision, setResetRevision] = useState<number>()
  const pending = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setCapability(undefined)
    setCheckFailed(false)
    void checkCapability().then((value) => { if (active) setCapability(value) }, () => { if (active) setCheckFailed(true) })
    return () => { active = false }
  }, [checkCapability, checkRevision])

  const value = snapshot.value === undefined ? undefined : { ...snapshot.value, ...draft?.changes }
  const available = capability?.status === 'available'
  const unavailableKey = capability?.status === 'unavailable'
    ? ({ 'unsupported-scheme': 'unavailable', 'missing-dependencies': 'dependencyUnavailable', 'probe-failed': 'checkFailed' } as const)[capability.reason]
    : 'unavailable'
  const writable = available && snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const hasOverrides = snapshot.user !== null && typeof snapshot.user === 'object'
    && TERMINAL_FIELDS.some(field => Object.hasOwn(snapshot.user as object, field))
  const change = <K extends keyof TerminalPreferences>(field: K, fieldValue: TerminalPreferences[K]): (void) => {
    if (!writable || snapshot.revision === undefined || pending.current) return
    setDraft({ changes: { ...draft?.changes, [field]: fieldValue }, revision: draft?.revision ?? snapshot.revision })
    setStatus('idle')
  }
  const commit = async (operation: () => Promise<boolean>, restored: boolean): Promise<void> => {
    if (!writable || pending.current) return
    pending.current = true
    setStatus('saving')
    try {
      const changed = await operation()
      if (mounted.current) {
        setDraft(undefined)
        setResetRevision(undefined)
        setStatus(changed ? restored ? 'reset' : 'saved' : 'idle')
      }
    } catch (_rejectedSettingsMutation) {
      if (mounted.current) {
        setDraft(undefined)
        setResetRevision(undefined)
        setStatus('error')
      }
    } finally {
      pending.current = false
    }
  }
  const row = (anchor: string, label: ReactNode, detail: string, control: ReactNode): ReactNode =>
    <div className={css.row} data-settings-anchor={anchor} tabIndex={-1}>
      <div className={css.copy}>{label}<p>{detail}</p></div><div className={css.control}>{control}</div>
    </div>

  return <section className={css.section}>
    <header className={css.heading}><span className={css.scope}>{t('scope')}</span><h2>{t('title')}</h2><p>{t('description')}</p></header>
    {!available && <div role="status" className={css.notice}>
      <p>{t(checkFailed ? 'checkFailed' : capability === undefined ? 'loading' : unavailableKey)}</p>
      {(checkFailed || capability !== undefined) && <button type="button" onClick={() => { setCheckRevision(v => v + 1) }}>{t('retry')}</button>}
    </div>}
    {available && (snapshot.status !== 'ready' || value === undefined) && <p role="status">{t(snapshot.status === 'loading' ? 'loading' : 'unavailable')}</p>}
    {(!available || snapshot.status !== 'ready' || value === undefined) && TERMINAL_ITEMS.map(([anchor, label, detail]) =>
      <div key={anchor} className={css.row} data-settings-anchor={anchor} tabIndex={-1}>
        <div className={css.copy}><span>{t(label)}</span><p>{t(detail)}</p></div>
      </div>)}
    {available && value !== undefined && snapshot.status === 'ready' && <form onSubmit={(event) => {
      event.preventDefault()
      if (draft !== undefined) void commit(() => save(draft.changes, draft.revision), false)
    }}>
      <fieldset disabled={!writable || status === 'saving'}>
        <legend>{t('launchTitle')}</legend>
        {row('shell', <label htmlFor="terminal-shell">{t('shell')}</label>, t('shellDescription'),
          <input id="terminal-shell" type="text" value={value.terminalShell} onChange={(event) => { change('terminalShell', event.currentTarget.value) }} />)}
        {row('shell-arguments', <label htmlFor="terminal-args">{t('args')}</label>, t('argsDescription'),
          <input id="terminal-args" type="text" value={value.terminalShellArgs} onChange={(event) => { change('terminalShellArgs', event.currentTarget.value) }} />)}
        <p className={css.note}>{t('workingDirectory')}</p>
      </fieldset>
      <fieldset disabled={!writable || status === 'saving'}>
        <legend>{t('appearanceTitle')}</legend>
        {row('font-family', <label htmlFor="terminal-font">{t('font')}</label>, t('fontDescription'),
          <input id="terminal-font" type="text" value={value.terminalFontFamily} onChange={(event) => { change('terminalFontFamily', event.currentTarget.value) }} />)}
        {row('font-size', <label htmlFor="terminal-font-size">{t('fontSize')}</label>, t('fontSizeDescription'),
          <input id="terminal-font-size" type="number" min={9} max={32} step={1} required value={Number.isNaN(value.terminalFontSize) ? '' : value.terminalFontSize}
            onChange={(event) => { change('terminalFontSize', event.currentTarget.valueAsNumber) }} />)}
        {row('scrollback', <label htmlFor="terminal-scrollback">{t('scrollback')}</label>, t('scrollbackDescription'),
          <input id="terminal-scrollback" type="number" min={0} max={100000} step={1} required value={Number.isNaN(value.terminalScrollback) ? '' : value.terminalScrollback}
            onChange={(event) => { change('terminalScrollback', event.currentTarget.valueAsNumber) }} />)}
        {row('cursor-style', <label htmlFor="terminal-cursor">{t('cursorStyle')}</label>, t('cursorDescription'),
          <select id="terminal-cursor" value={value.terminalCursorStyle}
            onChange={(event) => { change('terminalCursorStyle', event.currentTarget.value as TerminalPreferences['terminalCursorStyle']) }}>
            <option value="block">{t('block')}</option><option value="underline">{t('underline')}</option><option value="bar">{t('bar')}</option>
          </select>)}
        {row('cursor-blink', <label htmlFor="terminal-cursor-blink">{t('cursorBlink')}</label>, t('cursorBlinkDescription'),
          <input id="terminal-cursor-blink" type="checkbox" checked={value.terminalCursorBlink}
            onChange={(event) => { change('terminalCursorBlink', event.currentTarget.checked) }} />)}
        <p className={css.note}>{t('live')}</p>
      </fieldset>
      {!writable && <p role="status" className={css.note}>{t('readOnly')}</p>}
      <div className={css.actions}>
        <button type="submit" disabled={!writable || draft === undefined || status === 'saving'}>{t(status === 'saving' ? 'saving' : 'save')}</button>
        {draft !== undefined && <button type="button" disabled={status === 'saving'} onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('discard')}</button>}
        <button type="button" disabled={!writable || !hasOverrides || status === 'saving'}
          onClick={() => { setResetRevision(snapshot.revision) }}>{t('reset')}</button>
      </div>
    </form>}
    {status === 'saved' && <p role="status">{t('saved')}</p>}
    {status === 'reset' && <p role="status">{t('resetDone')}</p>}
    {status === 'error' && <p role="alert" className={css.error}>{t('failed')}</p>}
    <p className={css.note}>{t('lifetime')}</p>
    <Modal open={resetRevision !== undefined} onClose={() => { if (!pending.current) setResetRevision(undefined) }}
      title={t('resetTitle')} description={t('resetDescription')} closeLabel={t('close')}
      footer={<div className={css.actions}>
        <button type="button" disabled={status === 'saving'} onClick={() => { setResetRevision(undefined) }}>{t('cancel')}</button>
        <button type="button" disabled={!writable || status === 'saving'} onClick={() => {
          if (resetRevision !== undefined) void commit(() => reset(resetRevision), true)
        }}>{t('resetConfirm')}</button>
      </div>} />
  </section>
}
