/** Shared Ctrl+Shift+E/button dictation controller and observable UI state. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceApi, VoiceModelRow } from './api.ts'
import { encodePcmBase64, startRecording, type DictationRecording } from './dictation.ts'
import type { VoiceSettings } from './voice-settings.ts'
import { formatFinalTranscriptSegment } from './final-segments.ts'
import { captureInsertionTarget, insertIntoTarget, isComposerTarget, type InsertionTarget } from './insertion-target.ts'

/** Observable lifecycle of the single application-wide dictation operation. */
export type DictationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting'; readonly sessionId: SessionId }
  | { readonly phase: 'recording'; readonly sessionId: SessionId; readonly transcript?: string }
  | { readonly phase: 'processing'; readonly sessionId: SessionId }
  | { readonly phase: 'error'; readonly message: string }

interface ActiveRecording {
  readonly sessionId: SessionId
  readonly recording: DictationRecording
  readonly tracks: readonly MediaStreamTrack[]
  readonly onTrackEnded: () => void
  readonly insertionTarget: InsertionTarget | undefined
  readonly model: VoiceModelRow
  readonly stream?: ReturnType<VoiceApi['transcribeStream']>
  readonly transcript?: Promise<string | undefined>
}

function appendToDraft(ctx: ClientContext, sessionId: SessionId, text: string): boolean {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return false
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft + formatFinalTranscriptSegment(text, draft))
    return true
  } catch (error) {
    console.warn('[dsh-client-ui-voice-dictation] draft insert failed:', error)
    return false
  }
}

/** Surface capture and transcription feedback in the initiating session. */
function notifyDictation(ctx: ClientContext, sessionId: SessionId, level: 'info' | 'error', message: string): void {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return
    conversation.input.for(actx).notify(level, message)
  } catch (error) {
    console.warn('[dsh-client-ui-voice-dictation] error notice failed:', error)
  }
}

async function readyModelId(
  settings: VoiceSettings, modelsList: VoiceApi['modelsList'], signal: AbortSignal,
): Promise<VoiceModelRow | undefined> {
  const { models } = await modelsList(signal)
  if (settings.sttModel !== null) {
    const selected = models.find(model => model.definition.id === settings.sttModel && model.status.state === 'ready')
    if (selected !== undefined) return selected
  }
  return models.find(model => model.status.state === 'ready' && model.definition.provider !== 'openai')
}

/** One application-wide controller shared by the keyboard shortcut and composer button. */
export class DictationController {
  /** Stable observable state consumed by the composer button. */
  readonly store: SnapshotStore<DictationState> = createSnapshotStore<DictationState>({ phase: 'idle' })
  private active: ActiveRecording | undefined
  private pending: Promise<void> | undefined
  private generation = 0
  private readonly lifetime = new AbortController()
  private acquisition: AbortController | undefined

  constructor(
    private readonly ctx: ClientContext,
    private readonly settingsStore: SnapshotStore<VoiceSettings>,
    private readonly host: Pick<VoiceApi, 'modelsList' | 'transcribe' | 'transcribeStream'>,
  ) {}

  /**
   * Start when idle/error, stop or cancel the owning session, and ignore gestures owned by another session.
   * @param sessionId - session that owns the gesture and any resulting recording.
   */
  toggle(sessionId: SessionId): void {
    const state = this.store.getSnapshot()
    if (state.phase === 'recording') {
      if (state.sessionId === sessionId) this.track(this.stopRecording())
      return
    }
    if (state.phase === 'starting') {
      if (state.sessionId === sessionId) this.stop(sessionId)
      return
    }
    if (state.phase === 'processing') return
    this.track(this.startInternal(sessionId))
  }

  private track(operation: Promise<void>): void {
    this.pending = operation
    const clear = (): void => {
      if (this.pending === operation) this.pending = undefined
    }
    void operation.then(clear, clear)
  }

  /**
   * Start a held recording when no recording or transcription owns the controller.
   * @param sessionId - session that receives the eventual transcript.
   */
  start(sessionId: SessionId): void {
    const state = this.store.getSnapshot()
    if (state.phase === 'recording' || state.phase === 'starting' || state.phase === 'processing') return
    this.track(this.startInternal(sessionId))
  }

  /**
   * Stop the owning session recording or invalidate its pending microphone request.
   * @param sessionId - session that initiated the held gesture.
   */
  stop(sessionId: SessionId): void {
    const state = this.store.getSnapshot()
    if (state.phase === 'recording' && state.sessionId === sessionId) {
      this.track(this.stopRecording())
      return
    }
    if (state.phase === 'starting' && state.sessionId === sessionId) {
      this.generation += 1
      this.acquisition?.abort(new DOMException('dictation gesture released', 'AbortError'))
      this.store.set({ phase: 'idle' })
    }
  }

  private async startInternal(sessionId: SessionId): Promise<void> {
    const generation = ++this.generation
    const acquisition = new AbortController()
    this.acquisition = acquisition
    this.store.set({ phase: 'starting', sessionId })
    let streamHandle: ReturnType<VoiceApi['transcribeStream']> | undefined
    try {
      const insertionTarget = captureInsertionTarget()
      const abort = AbortSignal.any([acquisition.signal, this.lifetime.signal])
      const model = await readyModelId(this.settingsStore.getSnapshot(), this.host.modelsList, abort)
      if (generation !== this.generation) return
      if (model === undefined) throw new Error(this.ctx.locale.bind('settings.voice')('dictationNoModel'))
      if (model.definition.streaming === true) {
        streamHandle = this.host.transcribeStream(model.definition.id, this.lifetime.signal)
      }
      const { microphoneDeviceId } = this.settingsStore.getSnapshot()
      const audioOptions: MediaTrackConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
      let usedDefaultMicrophone = false
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { ...audioOptions, ...(microphoneDeviceId === null ? {} : { deviceId: { exact: microphoneDeviceId } }) },
        })
      } catch (error) {
        const unavailableSelection = error instanceof DOMException
          && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
        if (microphoneDeviceId === null || !unavailableSelection || generation !== this.generation) throw error
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioOptions })
        usedDefaultMicrophone = true
      }
      if (generation !== this.generation) {
        streamHandle?.dispose()
        for (const track of stream.getTracks()) track.stop()
        return
      }
      let recording: DictationRecording
      try {
        recording = await startRecording(stream, AudioContext, streamHandle === undefined ? undefined : {
          onPcmChunk: samples => streamHandle?.send({ pcm16kMonoBase64: encodePcmBase64(samples) }),
        }, AbortSignal.any([acquisition.signal, this.lifetime.signal]))
      } catch (error) {
        for (const track of stream.getTracks()) track.stop()
        throw error
      }
      if (generation !== this.generation) {
        try { await recording.stop() } finally {
          streamHandle?.dispose()
          for (const track of stream.getTracks()) track.stop()
        }
        return
      }
      const current: ActiveRecording = {
        sessionId,
        recording,
        tracks: stream.getTracks(),
        onTrackEnded: () => { this.track(this.failCapture(current)) },
        insertionTarget,
        model,
        ...(streamHandle === undefined ? {} : { stream: streamHandle }),
        ...(streamHandle === undefined ? {} : { transcript: this.consumeTranscript(streamHandle, generation) }),
      }
      this.active = current
      this.store.set({ phase: 'recording', sessionId })
      if (usedDefaultMicrophone) {
        notifyDictation(this.ctx, sessionId, 'info', this.ctx.locale.bind('settings.voice')('microphoneFallback'))
      }
      for (const track of current.tracks) {
        track.addEventListener('ended', current.onTrackEnded, { once: true })
        if (track.readyState === 'ended') current.onTrackEnded()
      }
    } catch (error) {
      streamHandle?.dispose()
      if (generation !== this.generation) return
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-voice] failed to start recording:', error)
      notifyDictation(this.ctx, sessionId, 'error', message)
      this.store.set({ phase: 'error', message })
    } finally {
      if (this.acquisition === acquisition) this.acquisition = undefined
    }
  }

  private async stopRecording(): Promise<void> {
    const current = this.active
    if (current === undefined) return
    const generation = this.generation
    this.active = undefined
    this.store.set({ phase: 'processing', sessionId: current.sessionId })
    try {
      let samples: Float32Array
      try {
        samples = await current.recording.stop()
      } finally {
        this.releaseTracks(current)
      }
      if (generation !== this.generation) return
      let text: string
      if (current.stream !== undefined && current.transcript !== undefined) {
        current.stream.end()
        const transcript = await current.transcript
        if (transcript === undefined) return
        text = transcript
      } else {
        if (samples.length === 0) throw new Error(this.ctx.locale.bind('settings.voice')('dictationNoModel'))
        const language = this.settingsStore.getSnapshot().language
        const { text: transcript } = await this.host.transcribe(
          current.model.definition.id, encodePcmBase64(samples), this.lifetime.signal, language === 'auto' ? undefined : language,
        )
        text = transcript
      }
      if (generation !== this.generation) return
      const transcript = text.trim()
      if (transcript !== '') {
        const target = current.insertionTarget
        const { terminalConfirmBeforeInsert } = this.settingsStore.getSnapshot()
        if (target?.kind === 'terminal' && terminalConfirmBeforeInsert
          && !window.confirm(this.ctx.locale.bind('settings.voice')('terminalConfirmBeforeInsertMessage'))) {
          this.store.set({ phase: 'idle' })
          return
        }
        const inserted = target !== undefined && !isComposerTarget(target)
          ? insertIntoTarget(target, transcript)
          : appendToDraft(this.ctx, current.sessionId, transcript)
        if (!inserted) {
          throw new Error(this.ctx.locale.bind('settings.voice')('dictationComposerUnavailable'))
        }
      }
      this.store.set({ phase: 'idle' })
    } catch (error) {
      current.stream?.dispose()
      if (generation === this.generation) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-voice] transcription failed:', error)
        notifyDictation(this.ctx, current.sessionId, 'error', message)
        this.store.set({ phase: 'error', message })
      }
    }
  }

  private async failCapture(current: ActiveRecording): Promise<void> {
    if (this.active !== current) return
    this.active = undefined
    const generation = ++this.generation
    const message = this.ctx.locale.bind('settings.voice')('microphoneCaptureLost')
    try {
      await current.recording.stop()
    } catch (error) {
      console.warn('[dsh-voice] failed to release disconnected microphone capture:', error)
    } finally {
      current.stream?.dispose()
      this.releaseTracks(current)
    }
    if (generation !== this.generation) return
    this.store.set({ phase: 'error', message })
    notifyDictation(this.ctx, current.sessionId, 'error', message)
  }

  private async consumeTranscript(handle: ReturnType<VoiceApi['transcribeStream']>, generation: number): Promise<string | undefined> {
    let final: string | undefined
    for await (const frame of handle) {
      if (generation !== this.generation) continue
      if (frame.type === 'partial') {
        const state = this.store.getSnapshot()
        if (state.phase === 'recording') this.store.set({ ...state, transcript: frame.text })
      } else {
        final = frame.text
      }
    }
    if (final === undefined && generation === this.generation) throw new Error('Voice transcription ended without a final result.')
    return final
  }

  private releaseTracks(current: ActiveRecording): void {
    for (const track of current.tracks) {
      track.removeEventListener('ended', current.onTrackEnded)
      track.stop()
    }
  }

  /**
   * Invalidate publication, release active tracks, and await pending acquisition or transcription.
   * @returns promise that settles after no owned asynchronous operation can mutate UI state or drafts.
   */
  async dispose(): Promise<void> {
    this.generation += 1
    this.lifetime.abort(new DOMException('voice dictation disposed', 'AbortError'))
    const current = this.active
    this.active = undefined
    this.store.set({ phase: 'idle' })
    if (current !== undefined) {
      try {
        await current.recording.stop()
      } finally {
        current.stream?.dispose()
        this.releaseTracks(current)
      }
    }
    await this.pending
  }
}
