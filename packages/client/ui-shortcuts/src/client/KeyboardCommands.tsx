/** Editable rows for commands registered with the keyboard service. */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { focusWithoutRing } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EffectiveKeyboardCommand, KeyboardService, KeyboardWriteResult } from '@deepseek-ai/dsh-client-keyboard/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ShortcutIcon } from './Icons.tsx'
import css from './Reference.module.css'

/** Keyboard-registry write callbacks injected by the shortcuts plugin. */
export interface KeyboardCommandsInjected {
  captureKey: KeyboardService['capture']
  setBinding: KeyboardService['setBinding']
  resetBinding: KeyboardService['resetBinding']
  resetAll: KeyboardService['resetAll']
}

type Props = PropsLocale<'shortcuts'> & KeyboardCommandsInjected & {
  /** Registered commands already filtered and ranked by the reference search. */
  commands: readonly EffectiveKeyboardCommand[]
  /** Whether the accepted keyboard preferences can be written. */
  writable: boolean
  /** Whether any command carries a saved user override. */
  hasOverrides: boolean
}

/** Write failures and refused captures name their own localized explanation. */
const MESSAGES = {
  unavailable: 'command-unavailable', reserved: 'reserved', invalid: 'modifier-required',
  conflict: 'keyboard-conflict', failed: 'write-failed',
} as const

/**
 * Render keyboard-registry commands with an inline recorder, keeping failed choices for retry.
 * @param props - ranked commands, write callbacks, and localized copy.
 * @returns one section of editable rows, or null when no command matches the search.
 */
export function KeyboardCommands({ commands, writable, hasOverrides, captureKey, setBinding, resetBinding, resetAll, t }: Props) {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState<(() => Promise<KeyboardWriteResult>) | null>(null)
  const inFlight = useRef(false)
  const recorder = useRef<HTMLButtonElement>(null)
  const editable = writable && !saving
  useEffect(() => {
    if (recordingId !== null && recorder.current !== null) focusWithoutRing(recorder.current)
  }, [recordingId])
  if (commands.length === 0) return null
  const save = (operation: () => Promise<KeyboardWriteResult>): void => {
    if (!editable || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    setRetry(null)
    void operation().then((result) => {
      if (result.ok) setRecordingId(null)
      else {
        setError(t(MESSAGES[result.reason]))
        if (result.reason === 'failed') setRetry(() => operation)
      }
    }, () => { setError(t('write-failed')); setRetry(() => operation) }).finally(() => {
      inFlight.current = false
      setSaving(false)
    })
  }
  const record = (event: KeyboardEvent<HTMLElement>): void => {
    if (recordingId === null || !editable) return
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
    event.preventDefault()
    event.stopPropagation()
    if (result.kind !== 'binding') { setError(t(MESSAGES[result.kind])); return }
    save(() => setBinding(recordingId, result.binding))
  }
  return <section aria-label={t('keyboard-group')} aria-busy={saving} onKeyDownCapture={record}>
    <div className={css.groupRow}>
      <h3 className={css.group}>{t('keyboard-group')}</h3>
      {hasOverrides && <button type="button" className={css.inlineAction} disabled={!editable}
        onClick={() => { save(resetAll) }}>{t('reset-all')}</button>}
    </div>
    <ul className={css.rows}>{commands.map(command => <li key={command.id} className={css.row}
      data-settings-anchor={'keybinding-' + command.id}>
      {recordingId !== command.id && <button type="button" className={css.rowButton}
        aria-label={t('edit-label', { command: command.label })}
        disabled={!editable || !command.registered || command.status === 'unavailable'}
        onClick={() => { setRecordingId(command.id); setError(null); setRetry(null) }} />}
      <span className={css.commandLabel}>{command.label}</span>
      <span className={css.binding}>
        {recordingId === command.id
          ? <div className={css.inlineEditor} role="group" aria-label={command.label} aria-busy={saving}>
            <div className={css.inlineControls}>
              <button type="button" className={css.inlineAction} disabled={!editable || !command.overridden}
                onClick={() => { save(() => resetBinding(command.id)) }}>{t('reset')}</button>
              <button type="button" className={css.inlineAction}
                disabled={!editable || !command.registered || command.bindings.length === 0}
                onClick={() => { save(() => setBinding(command.id, null)) }}>{t('clear')}</button>
              <button ref={recorder} type="button" className={css.recorder} disabled={!editable}
                aria-label={t('record')} onClick={() => { setError(null); setRetry(null) }}>{t('recording')}</button>
            </div>
            {error !== null && <span className={css.review} role="alert">{error}</span>}
            {retry !== null && <button type="button" className={css.inlineAction} disabled={!editable}
              onClick={() => { save(retry) }}>{t('retry-save')}</button>}
          </div>
          : <>
            <span className={css.rowActions}><ShortcutIcon kind="edit" /></span>
            {command.bindingLabels.length === 0
              ? <span className={css.unbound}>{t('unbound')}</span>
              : <span className={css.keyBadge}>{command.bindingLabels.join(' / ')}</span>}
          </>}
      </span>
    </li>)}</ul>
    {commands.some(command => command.status !== 'available') && <ul className={css.rows}>
      {commands.filter(command => command.status !== 'available').map(command => <li key={command.id} className={css.hint}>
        {command.label} — {t(command.status === 'unavailable' ? MESSAGES.unavailable
          : command.status === 'conflict' ? MESSAGES.conflict : command.status === 'reserved' ? MESSAGES.reserved : MESSAGES.invalid)}
      </li>)}
    </ul>}
  </section>
}
