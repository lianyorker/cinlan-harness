/**
 * Ctrl+Shift+E dictation capture: records the microphone via MediaRecorder,
 * decodes the clip through AudioContext.decodeAudioData, resamples to 16kHz
 * mono, and POSTs the base64-encoded PCM to the Host's /voice/api/transcribe
 * method. Kept dependency-free (no React) so the capture/encode logic is
 * unit-testable without a DOM renderer.
 */
import { voiceApi } from './api.ts'

/** The sample rate the Host's shipped models require. */
const TARGET_SAMPLE_RATE = 16_000

/** One active recording session (MediaRecorder + its accumulated chunks). */
export interface DictationRecording {
  /** Stop recording and resolve the finished audio Blob. */
  stop(): Promise<Blob>
}

/**
 * Start recording the given microphone stream. The caller owns the stream's
 * lifecycle (acquired via getUserMedia) and must stop its tracks after
 * {@link DictationRecording.stop} resolves.
 * @param stream - an active microphone MediaStream.
 * @returns a handle whose stop() resolves the recorded clip.
 */
export function startRecording(stream: MediaStream): DictationRecording {
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  })
  recorder.start()
  return {
    stop: () => new Promise<Blob>((resolve) => {
      recorder.addEventListener('stop', () => { resolve(new Blob(chunks, { type: recorder.mimeType })) }, { once: true })
      recorder.stop()
    }),
  }
}

/**
 * Decode a recorded clip and resample it to 16kHz mono float32 samples.
 * @param blob - the recorded audio clip (any MediaRecorder-produced format the browser's decoder accepts).
 * @param audioContextCtor - injectable AudioContext constructor (tests provide a fake).
 * @returns 16kHz mono PCM float32 samples.
 */
export async function decodeAndResample(
  blob: Blob,
  audioContextCtor: typeof AudioContext = AudioContext,
): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const context = new audioContextCtor()
  try {
    const decoded = await context.decodeAudioData(arrayBuffer)
    return resampleToMono(decoded, TARGET_SAMPLE_RATE)
  } finally {
    await context.close()
  }
}

/** Downmix every channel to mono (simple average) and linearly resample to `targetRate`. */
function resampleToMono(buffer: AudioBuffer, targetRate: number): Float32Array {
  const channels = buffer.numberOfChannels
  const mono = new Float32Array(buffer.length)
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / channels
  }
  if (buffer.sampleRate === targetRate) return mono
  const ratio = buffer.sampleRate / targetRate
  const outLength = Math.round(mono.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const sourceIndex = i * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, mono.length - 1)
    const frac = sourceIndex - lower
    out[i] = (mono[lower] ?? 0) * (1 - frac) + (mono[upper] ?? 0) * frac
  }
  return out
}

/**
 * Encode 16kHz mono float32 samples as canonical base64 for the transcribe wire payload.
 * @param samples - PCM samples to encode without copying or conversion.
 * @returns canonical base64 over the samples' float32 bytes.
 */
export function encodePcmBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] ?? 0)
  return btoa(binary)
}

/**
 * Full record-decode-transcribe pipeline for one dictation gesture.
 * @param recording - active recording to stop and decode.
 * @param modelId - the shipped model to transcribe against.
 * @param recording - the active DictationRecording handle to stop.
 * @returns the transcript text.
 */
export async function finishDictation(
  recording: DictationRecording,
  modelId: string,
): Promise<string> {
  const blob = await recording.stop()
  const samples = await decodeAndResample(blob)
  const { text } = await voiceApi.transcribe(modelId, encodePcmBase64(samples))
  return text
}
