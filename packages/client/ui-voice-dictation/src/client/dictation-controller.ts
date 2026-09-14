/** Shared Ctrl+Shift+E/button dictation controller and observable UI state. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { voiceApi } from './api.ts'
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

async function readyModelId(settings: VoiceSettings): Promise<string | undefined> {
  if (settings.sttModel !== null) {
    const { models } = await voiceApi.modelsList()
    const selected = models.find(model => model.definition.id === settings.sttModel && model.status.state === 'ready')
    if (selected !== undefined) return selected.definition.id
  }
  const { models } = await voiceApi.modelsList()
  return models.find(model => model.status.state === 'ready')?.definition.id
}

/** One application-wide controller shared by the keyboard shortcut and composer button. */
export class DictationController {
  /** Stable observable state consumed by the composer button. */
  readonly store: SnapshotStore<DictationState> = createSnapshotStore<DictationState>({ phase: 'idle' })
  private active: ActiveRecording | undefined
  private pending: Promise<void> | undefined
  private generation = 0

  constructor(private readonly ctx: ClientContext, private readonly settingsStore: SnapshotStore<VoiceSettings>) {}

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

  /** Start recording for the given session (hold mode entry point). */
  start(sessionId: SessionId): void {
    const state = this.store.getSnapshot()
    if (state.phase === 'recording' || state.phase === 'starting') return
    this.track(this.startInternal(sessionId))
  }

  /** Stop recording for the given session (hold mode entry point). */
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
      this.active = { sessionId, stream, recording: startRecording(stream) }
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
      const modelId = await readyModelId(this.settingsStore.getSnapshot())
      if (generation !== this.generation) return
      if (modelId === undefined) throw new Error('no ready dictation model; download one in Settings first')
      const samples = await current.recording.stop()
      if (generation !== this.generation) return
      const { text } = await voiceApi.transcribe(modelId, encodePcmBase64(samples))
      if (generation !== this.generation) return
      if (text.trim() !== '' && !appendToDraft(this.ctx, current.sessionId, text.trim())) {
        throw new Error('current session composer is unavailable')
      }
      this.store.set({ phase: 'idle' })
    } catch (error) {
      if (generation === this.generation) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[dsh-voice] transcription failed:', error)
        notifyDictationError(this.ctx, current.sessionId, message)
        this.store.set({ phase: 'error', message })
      }
    } finally {
      for (const track of current.stream.getTracks()) track.stop()
    }
  }

  /**
   * Invalidate publication, release active tracks, and await pending acquisition or transcription.
   * @returns promise that settles after no owned asynchronous operation can mutate UI state or drafts.
   */
  async dispose(): Promise<void> {
    this.generation += 1
    const current = this.active
    this.active = undefined
    if (current !== undefined) {
      for (const track of current.stream.getTracks()) track.stop()
    }
    this.store.set({ phase: 'idle' })
    await this.pending
  }
}
