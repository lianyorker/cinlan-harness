/** Persisted voice dictation settings: enable/disable, mode, model, microphone. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Dictation activation mode. */
export type DictationMode = 'toggle' | 'hold'

/** Voice settings persisted to localStorage. */
export interface VoiceSettings {
  /** Master switch; when false, the shortcut and button are inert. */
  readonly enabled: boolean
  /** toggle: click to start/stop; hold: press-and-hold to record. */
  readonly dictationMode: DictationMode
  /** Selected model id; null = auto (first ready model). */
  readonly sttModel: string | null
  /** Microphone device id; null = system default. */
  readonly microphoneDeviceId: string | null
}

const STORAGE_KEY = 'dsh.voice.settings'

const DEFAULTS: VoiceSettings = {
  enabled: true,
  dictationMode: 'toggle',
  sttModel: null,
  microphoneDeviceId: null,
}

const LEGACY_MODEL_IDS = new Map([
  ['zh-streaming-zipformer-14m', 'zipformer-streaming-zh-14m'],
  ['bilingual-streaming-zipformer', 'zipformer-bilingual-zh-en'],
  ['en-streaming-zipformer-20m', 'zipformer-streaming-en-20m'],
  ['bilingual-streaming-paraformer', 'paraformer-bilingual-zh-en'],
])

function rehydrate(raw: unknown): VoiceSettings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULTS
  const obj = raw as Record<string, unknown>
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : DEFAULTS.enabled,
    dictationMode: obj.dictationMode === 'hold' ? 'hold' : 'toggle',
    sttModel: typeof obj.sttModel === 'string' ? LEGACY_MODEL_IDS.get(obj.sttModel) ?? obj.sttModel : null,
    microphoneDeviceId: typeof obj.microphoneDeviceId === 'string' ? obj.microphoneDeviceId : null,
  }
}

/** Create the persisted voice settings store. */
export function createVoiceSettingsStore(): SnapshotStore<VoiceSettings> {
  const store = createSnapshotStore<VoiceSettings>(DEFAULTS, { persist: { name: STORAGE_KEY } })
  // Rehydrate with validation in case localStorage has stale/invalid data.
  const current = store.getSnapshot()
  const validated = rehydrate(current)
  if (validated !== current) store.set(validated)
  return store
}
