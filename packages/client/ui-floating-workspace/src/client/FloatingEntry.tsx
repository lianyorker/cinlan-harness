/** Existing shell-slot entries and child close affordance; the app itself renders its normal slots. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { KeyEventFacts } from '@deepseek-ai/dsh-client-keyboard/client'
import type { FloatingSnapshot } from './contract.ts'
import type { ToggleButtonPosition } from '../types.ts'
import css from './FloatingEntry.module.css'

/** Framework hook plus action callbacks owned by this registration. */
export interface FloatingEntryInjected {
  hooks: { floating: ObservableSnapshot<FloatingSnapshot> }
  position: ToggleButtonPosition
  /** Toggle the exact owned app window from an explicit user gesture. */
  toggle: () => void
  /** Close this exact child or the main renderer's owned child. */
  closeWindow: () => void
  /**
   * Delegate event matching to the keyboard service.
   * @param facts - DOM event facts copied by this entry's listener.
   * @returns whether the effective registered command may run.
   */
  matchesShortcut: (facts: KeyEventFacts) => boolean
}

/** All three entries use the shell's common framework hooks and the same private facts. */
export type FloatingEntryProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.floatingWorkspace'> & InjectFace<FloatingEntryInjected>

/**
 * Render the entry only in its accepted position, or a close control inside the child.
 * @param props - framework-bound runtime facts and plain actions.
 * @returns an existing-shell entry or no content when disabled or at another position.
 */
export function FloatingEntry({ useFloating, position, t, toggle, closeWindow, matchesShortcut }: FloatingEntryProps) {
  const snapshot = useFloating(value => value)
  const overlay = position === 'floating'
  useEffect(() => {
    if (!overlay || snapshot.child) return
    const onKey = (event: KeyboardEvent) => {
      if (!matchesShortcut({
        key: event.key, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
        isComposing: event.isComposing, repeat: event.repeat, defaultPrevented: event.defaultPrevented,
        // oxlint-disable-next-line typescript/no-deprecated -- The keyboard service rejects legacy IME sentinel 229.
        keyCode: event.keyCode, altGraph: event.getModifierState('AltGraph'),
      })) return
      event.preventDefault()
      event.stopPropagation()
      toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [overlay, snapshot.child, matchesShortcut, toggle])
  if (snapshot.child) {
    if (position === 'sidebar') return <div className={css.entry} data-floating-child-control>
      <Button variant="ghost" size="sm" onClick={closeWindow} aria-label={t('close')} title={t('close')}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </Button>
    </div>
    if (!overlay || !snapshot.targetUnavailable) return null
    return <div className={css.notice} role="status">{t('initialSessionUnavailable')}</div>
  }
  const prefs = snapshot.settings.value
  if (snapshot.settings.status !== 'ready' || prefs?.enabled !== true) return null
  const showTrigger = prefs.toggleButtonPosition === position
  const error = snapshot.phase === 'blocked' || snapshot.phase === 'unavailable'
  if (!showTrigger && !(overlay && error)) return null
  return <>
    {showTrigger && <div className={overlay ? css.floating : css.entry} data-floating-entry={position}>
      <Button variant="ghost" size="sm" onClick={toggle}
        aria-label={t('toggle')} aria-pressed={snapshot.phase === 'open'} title={t('toggle')}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 9h18M10 14h6v5" />
        </svg>
      </Button>
    </div>}
    {overlay && error && <div className={css.notice} data-floating-feedback role="alert">{t(snapshot.phase === 'blocked' ? 'blocked' : 'unavailable')}</div>}
  </>
}
