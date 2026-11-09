/** App-wide dictation status shown independently of the composer button. */
import type { DictationState } from './dictation-controller.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { IconLoadingOutline16, IconStopFill16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './DictationIndicator.module.css'

/** Controller state and stop action supplied by the overlay registration. */
export interface DictationIndicatorInjected {
  hooks: { dictation: SnapshotStore<DictationState> }
  stop: (sessionId: SessionId) => void
}

/** Props of the persistent application overlay entry. */
export type DictationIndicatorProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.voice'>
  & InjectFace<DictationIndicatorInjected>

/**
 * Show the active dictation lifecycle across session navigation.
 * @param props - overlay state, stop action, and localized copy.
 * @returns the status strip while dictation is active, otherwise null.
 */
export function DictationIndicator({ useDictation, stop, t }: DictationIndicatorProps) {
  const state = useDictation(value => value)
  if (state.phase !== 'starting' && state.phase !== 'recording' && state.phase !== 'processing') return null
  const processing = state.phase === 'processing'
  const label = processing
    ? t('processingDictation')
    : state.phase === 'starting'
      ? t('startingDictation')
      : t('recordingDictation')

  return (
    <div className={css.indicator} role="status" aria-live="polite">
      {processing || state.phase === 'starting'
        ? <IconLoadingOutline16 className={css.spinner} size={16} />
        : <span className={css.recordingMark} aria-hidden="true" />}
      <span className={css.label}>
        {state.phase === 'recording' && state.transcript !== undefined && state.transcript !== '' ? state.transcript : label}
      </span>
      <button
        type="button"
        className={css.stop}
        aria-label={t('stopDictation')}
        disabled={processing}
        onClick={() => { stop(state.sessionId) }}
      >
        <IconStopFill16 size={16} />
      </button>
    </div>
  )
}
