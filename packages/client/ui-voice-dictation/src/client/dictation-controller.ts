/** Shared Ctrl+Shift+E/button dictation controller and observable UI state. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { VoiceApi } from './api.ts'
import { encodePcmBase64, startRecording, type DictationRecording } from './dictation.ts'
import type { VoiceSettings } from './voice-settings.ts'

/** Observable lifecycle of the single application-wide dictation operation. */
export type DictationState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'starting'; readonly sessionId: SessionId }
  | { readonly phase: 'recording'; readonly sessionId: SessionId }
  | { readonly phase: 'processing'; readonly sessionId: SessionId }
  | { readonly phase: 'error'; readonly message: string }

interface ActiveRecording {
  readonly sessionId: SessionId
  readonly stream: MediaStream
  readonly recording: DictationRecording
}

function appendToDraft(ctx: ClientContext, sessionId: SessionId, text: string): boolean {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return false
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return false
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft.trim() === '' ? text : `${draft} ${text}`)
    return true
  } catch (error) {
    console.warn('[dsh-client-ui-voice-dictation] draft insert failed:', error)
    return false
  }
}

/** Surface a dictation failure as a visible composer notice (console.error alone leaves the user with no feedback). */
function notifyDictationError(ctx: ClientContext, sessionId: SessionId, message: string): void {
  try {
    const actx = ctx.sessions.scope(sessionId)
    if (actx === undefined) return
    const conversation = ctx.get('conversation')
    if (conversation === undefined) return
    conversation.input.for(actx).notify('error', message)
  } catch (error) {
    console.warn('[dsh-client-ui-voice-dictation] error notice failed:', error)
  }
}

async function readyModelId(
  settings: VoiceSettings, modelsList: VoiceApi['modelsList'], signal: AbortSignal,
): Promise<string | undefined> {
  const { models } = await modelsList(signal)
  if (settings.sttModel !== null) {
    const selected = models.find(model => model.definition.id === settings.sttModel && model.status.state === 'ready')
    if (selected !== undefined) return selected.definition.id
  }
  return models.find(model => model.status.state === 'ready')?.definition.id
}

/** One application-wide controller shared by the keyboard shortcut and composer button. */
export class DictationController {
  /** Stable observable state consumed by the composer button. */
  readonly store: SnapshotStore<DictationState> = createSnapshotStore<DictationState>({ phase: 'idle' })
  private active: ActiveRecording | undefined
  private pending: Promise<void> | undefined
  private generation = 0
  private readonly lifetime = new AbortController()

  constructor(
    private readonly ctx: ClientContext,
    private readonly settingsStore: SnapshotStore<VoiceSettings>,
    private readonly host: Pick<VoiceApi, 'modelsList' | 'transcribe'>,
  ) {}

  /**
   * Start when idle/error, stop only from the owning session, and ignore gestures while another operation owns the controller.
   * @param sessionId - session that owns the gesture and any resulting recording.
   */
  toggle(sessionId: SessionId): void {
    const state = this.store.getSnapshot()
    if (state.phase === 'recording') {
      if (state.sessionId === sessionId) this.track(this.stopRecording())
      return
    }
    if (state.phase === 'starting' || state.phase === 'processing') return
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
      this.store.set({ phase: 'idle' })
    }
  }

  private async startInternal(sessionId: SessionId): Promise<void> {
    const generation = ++this.generation
    this.store.set({ phase: 'starting', sessionId })
    try {
      const { microphoneDeviceId } = this.settingsStore.getSnapshot()
      const audioConstraints: MediaStreamConstraints['audio'] = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(microphoneDeviceId !== null ? { deviceId: { exact: microphoneDeviceId } } : {}),
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop()
        return
      }
      let recording: DictationRecording
      try {
        recording = startRecording(stream)
      } catch (error) {
        for (const track of stream.getTracks()) track.stop()
        throw error
      }
      this.active = { sessionId, stream, recording }
      this.store.set({ phase: 'recording', sessionId })
    } catch (error) {
      if (generation !== this.generation) return
      const message = error instanceof Error ? error.message : String(error)
      console.error('[dsh-voice] failed to start recording:', error)
      notifyDictationError(this.ctx, sessionId, message)
      this.store.set({ phase: 'error', message })
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
        for (const track of current.stream.getTracks()) track.stop()
      }
      if (generation !== this.generation) return
      const modelId = await readyModelId(this.settingsStore.getSnapshot(), this.host.modelsList, this.lifetime.signal)
      if (generation !== this.generation) return
      if (modelId === undefined) throw new Error(this.ctx.locale.bind('settings.voice')('dictationNoModel'))
      if (generation !== this.generation) return
      const { text } = await this.host.transcribe(modelId, encodePcmBase64(samples), this.lifetime.signal)
      if (generation !== this.generation) return
      if (text.trim() !== '' && !appendToDraft(this.ctx, current.sessionId, text.trim())) {
        throw new Error(this.ctx.locale.bind('settings.voice')('dictationComposerUnavailable'))
      }
      this.store.set({ phase: 'idle' })
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-voice] transcription failed:', error)
        notifyDictationError(this.ctx, current.sessionId, message)
        this.store.set({ phase: 'error', message })
      }
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
        for (const track of current.stream.getTracks()) track.stop()
      }
    }
    await this.pending
  }
}
