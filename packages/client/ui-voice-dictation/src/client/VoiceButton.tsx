/** Voice dictation control rendered in conversation.input.right. */
import { IconContextInjectionOutline16, IconLoadingOutline16, IconStopFill16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DictationState } from './dictation-controller.ts'
import css from './VoiceButton.module.css'

export interface VoiceButtonInjected {
  hooks: { dictation: SnapshotStore<DictationState> }
  toggle: (sessionId: SessionId) => void
}

export type VoiceButtonProps = PropsRuntime<'conversation.input.right'>
  & InjectFace<VoiceButtonInjected>
  & PropsLocale<'settings.voice'>

/** Small composer-tool-row control sharing the application DictationController. */
export function VoiceButton({ sessionId, useInput, useDictation, toggle, t }: VoiceButtonProps) {
  const state = useDictation(value => value)
  const input = useInput(value => value)
  const owned = (state.phase === 'starting' || state.phase === 'recording' || state.phase === 'processing')
    && state.sessionId === sessionId
  const recording = owned && state.phase === 'recording'
  const busy = owned && (state.phase === 'starting' || state.phase === 'processing')
  const ownedByAnotherSession = !owned
    && (state.phase === 'starting' || state.phase === 'recording' || state.phase === 'processing')
  const disabled = ownedByAnotherSession || busy || (!recording && input.phase !== 'plain')
  const label = recording
    ? t('stopDictation')
    : busy
      ? t('processingDictation')
      : t('startDictation')

  return (
    <Tooltip label={label} side="top" delayMs={400}>
      <button
        type="button"
        className={css.button}
        data-dictation-phase={recording ? 'recording' : busy ? state.phase : 'idle'}
        aria-label={label}
        disabled={disabled}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={() => { toggle(sessionId) }}
      >
        {recording
          ? <IconStopFill16 size={14} />
          : busy
            ? <IconLoadingOutline16 size={14} className={css.spin} />
            : <IconContextInjectionOutline16 size={14} />}
      </button>
    </Tooltip>
  )
}
