/** Voice dictation control rendered in conversation.input.right. */
import { useEffect, useState } from 'react'
import { IconLoadingOutline16, IconMicrophoneOutline16, IconStopFill16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { voiceApi } from './api.ts'
import type { DictationState } from './dictation-controller.ts'
import type { VoiceSettings } from './voice-settings.ts'
import css from './VoiceButton.module.css'

export interface VoiceButtonInjected {
  hooks: { dictation: SnapshotStore<DictationState>; settings: SnapshotStore<VoiceSettings> }
  toggle: (sessionId: SessionId) => void
}

export type VoiceButtonProps = PropsRuntime<'conversation.input.right'>
  & InjectFace<VoiceButtonInjected>
  & PropsLocale<'settings.voice'>

/** Small composer-tool-row control sharing the application DictationController. */
export function VoiceButton({ sessionId, useInput, useDictation, useSettings, toggle, t }: VoiceButtonProps) {
  const state = useDictation(value => value)
  const input = useInput(value => value)
  const settings = useSettings(value => value)
  const [hasReadyModel, setHasReadyModel] = useState(false)

  useEffect(() => {
    if (state.phase === 'error') console.error('[dsh-voice] dictation error:', state.message)
  }, [state])

  useEffect(() => {
    if (!settings.enabled) return
    let current = true
    const refresh = (): void => {
      void voiceApi.modelsList().then(
        ({ models }) => { if (current) setHasReadyModel(models.some(model => model.status.state === 'ready')) },
        () => { if (current) setHasReadyModel(false) },
      )
    }
    refresh()
    // Re-check after each dictation cycle settles, so a model finishing its
    // download while the composer is open makes the button appear without a reload.
    const timer = state.phase === 'idle' || state.phase === 'error' ? setInterval(refresh, 3000) : undefined
    return () => {
      current = false
      if (timer !== undefined) clearInterval(timer)
    }
  }, [settings.enabled, state.phase])

  if (!settings.enabled || !hasReadyModel) return null

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
          ? <IconStopFill16 size={16} />
          : busy
            ? <IconLoadingOutline16 size={16} className={css.spin} />
            : <IconMicrophoneOutline16 size={18} />}
      </button>
    </Tooltip>
  )
}
