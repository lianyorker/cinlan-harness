/** Explicit, ephemeral settings capture; audio and transcripts never enter a Session draft. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { VoiceSettingsSectionProps } from './VoiceSettingsSection.tsx'
import type { VoiceSettings } from './voice-settings.ts'
import { encodePcmBase64, startRecording, type DictationRecording } from './dictation.ts'
import css from './VoiceSettingsSection.module.css'

// Bound microphone exposure and retained PCM even when the settings page stays open.
const TEST_SECONDS = 10

type TestState =
  | { phase: 'idle' | 'starting' | 'recording' | 'processing' | 'cancelled' }
  | { phase: 'done'; text: string }
  | { phase: 'error'; key: 'testCaptureFailed' | 'testPermissionDenied' | 'testTranscribeFailed' }

interface TestOperation {
  abort: AbortController
  modelId: string
  stream?: MediaStream
  recording?: DictationRecording
  timer?: ReturnType<typeof setTimeout>
}

function release(operation: TestOperation): Promise<Float32Array> {
  clearTimeout(operation.timer)
  for (const track of operation.stream?.getTracks() ?? []) track.stop()
  delete operation.stream
  const recording = operation.recording
  delete operation.recording
  return recording?.stop() ?? Promise.resolve(new Float32Array())
}

/**
 * Record only after a click, release tracks before transcription, and discard results after cancellation.
 * @param props - current preferences, Host-ready model identity, localized copy and transcription callback.
 * @returns bounded microphone test controls, level meter and ephemeral transcript.
 */
export function VoiceTestSection({ settings, modelId, t, transcribe }: {
  settings: VoiceSettings
  modelId: string | null
} & Pick<VoiceSettingsSectionProps, 't' | 'transcribe'>): ReactNode {
  const [state, setState] = useState<TestState>({ phase: 'idle' })
  const [level, setLevel] = useState(0)
  const active = useRef<TestOperation | null>(null)
  const mediaDevices = (navigator as { mediaDevices?: MediaDevices }).mediaDevices
  const supported = typeof mediaDevices?.getUserMedia === 'function' && typeof AudioContext !== 'undefined'

  const cancel = (): void => {
    const operation = active.current
    active.current = null
    if (operation === null) return
    operation.abort.abort()
    // Capture closure can fail after tracks have stopped; cancellation has no transcript to publish.
    void release(operation).catch(() => { /* AudioContext closure failure after microphone tracks stopped. */ })
  }

  useEffect(() => () => { cancel() }, [])
  useEffect(() => {
    if (settings.enabled) return
    cancel()
    setState({ phase: 'idle' })
    setLevel(0)
  }, [settings.enabled])

  const stop = async (operation: TestOperation): Promise<void> => {
    if (active.current !== operation || operation.recording === undefined) return
    setState({ phase: 'processing' })
    setLevel(0)
    try {
      const samples = await release(operation)
      if (active.current !== operation) return
      const { text } = await transcribe(operation.modelId, encodePcmBase64(samples), operation.abort.signal)
      if (active.current !== operation) return
      active.current = null
      setState({ phase: 'done', text })
    } catch {
      if (active.current !== operation) return
      active.current = null
      setState({ phase: 'error', key: 'testTranscribeFailed' })
    }
  }

  const start = async (): Promise<void> => {
    if (active.current !== null || modelId === null) return
    const operation: TestOperation = { abort: new AbortController(), modelId }
    active.current = operation
    setState({ phase: 'starting' })
    setLevel(0)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        ...(settings.microphoneDeviceId === null ? {} : { deviceId: { exact: settings.microphoneDeviceId } }),
      } })
      if (active.current !== operation) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      operation.stream = stream
      operation.recording = startRecording(stream, AudioContext, {
        maxSeconds: TEST_SECONDS,
        onLevel: (value) => { if (active.current === operation) setLevel(value) },
        onLimit: () => { void stop(operation) },
      })
      operation.timer = setTimeout(() => { void stop(operation) }, TEST_SECONDS * 1000)
      setState({ phase: 'recording' })
    } catch (error) {
      await release(operation).catch(() => { /* Capture setup failure remains the visible error after tracks stopped. */ })
      if (active.current !== operation) return
      active.current = null
      setState({ phase: 'error', key: error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'testPermissionDenied' : 'testCaptureFailed' })
    }
  }

  const busy = state.phase === 'starting' || state.phase === 'recording' || state.phase === 'processing'
  return (
    <section className={css.settingSection} data-settings-anchor="voice-test">
      <div className={css.settingRow}>
        <div className={css.settingCopy}>
          <h2 className={css.settingTitle}>{t('testTitle')}</h2>
          <p className={css.settingDescription}>{t('testDescription', { seconds: TEST_SECONDS })}</p>
          {!supported && <p className={css.settingDescription}>{t('microphoneUnavailable')}</p>}
          {modelId === null && <p className={css.settingDescription}>{t('testNeedsModel')}</p>}
          <p role={state.phase === 'error' ? 'alert' : 'status'} className={css.settingDescription}>
            {state.phase === 'error' ? t(state.key) : state.phase === 'done' ? t(state.text.trim() === '' ? 'testEmpty' : 'testComplete')
              : t(state.phase === 'recording' ? 'testRecording' : state.phase === 'starting' ? 'micRequesting'
                : state.phase === 'processing' ? 'processingDictation' : state.phase === 'cancelled' ? 'testCancelled' : 'testIdle')}
          </p>
          <meter min={0} max={1} value={level} aria-label={t('testLevel')} />
          {state.phase === 'done' && state.text.trim() !== '' && <p className={css.settingDescription} aria-label={t('testTranscript')}>{state.text}</p>}
        </div>
        <div className={css.settingControl}>
          {!busy && <button type="button" className={css.actionButton} disabled={!settings.enabled || !supported || modelId === null}
            onClick={() => { void start() }}>{t('testStart')}</button>}
          {state.phase === 'recording' && <button type="button" className={css.actionButton} onClick={() => {
            const operation = active.current
            if (operation !== null) void stop(operation)
          }}>{t('testStop')}</button>}
          {busy && <button type="button" className={css.actionButton} onClick={() => {
            cancel(); setLevel(0); setState({ phase: 'cancelled' })
          }}>{t('testCancel')}</button>}
        </div>
      </div>
    </section>
  )
}
