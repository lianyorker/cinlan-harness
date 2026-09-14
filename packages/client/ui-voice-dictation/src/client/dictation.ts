/**
 * Ctrl+Shift+E dictation capture: records the microphone via ScriptProcessorNode
 * at the system's native sample rate, then manually resamples to 16kHz mono.
 * POSTs the base64-encoded PCM to the Host's /voice/api/transcribe method.
 * Kept dependency-free (no React) so the capture/encode logic is unit-testable
 * without a DOM renderer.
 */
import { voiceApi } from './api.ts'

/** The sample rate the Host's shipped models require. */
const TARGET_SAMPLE_RATE = 16_000

/** One active recording session (ScriptProcessorNode + its accumulated samples). */
export interface DictationRecording {
  /** Stop recording and resolve the captured 16kHz mono float32 samples. */
  stop(): Promise<Float32Array>
}

/**
 * Start recording the given microphone stream via ScriptProcessorNode.
 * The AudioContext uses the system's native sample rate; samples are resampled
 * to 16kHz on stop. The caller owns the stream's lifecycle (acquired via
 * getUserMedia) and must stop its tracks after {@link DictationRecording.stop}
 * resolves.
 * @param stream - an active microphone MediaStream.
 * @param audioContextCtor - injectable AudioContext constructor (tests provide a fake).
 * @returns a handle whose stop() resolves the captured PCM samples.
 */
export function startRecording(
  stream: MediaStream,
  audioContextCtor: typeof AudioContext = AudioContext,
): DictationRecording {
  const context = new audioContextCtor()
  const source = context.createMediaStreamSource(stream)
  const processor = context.createScriptProcessor(4096, 1, 1)
  const chunks: Float32Array[] = []
  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const input = event.inputBuffer.getChannelData(0)
    chunks.push(new Float32Array(input))
  }
  source.connect(processor)
  // ScriptProcessorNode requires a connection to destination to fire onaudioprocess;
  // route through a zero-gain node to avoid feedback.
  const muteGain = context.createGain()
  muteGain.gain.value = 0
  processor.connect(muteGain)
  muteGain.connect(context.destination)

  return {
    stop: () => new Promise<Float32Array>((resolve) => {
      // Allow any pending onaudioprocess callbacks to flush.
      setTimeout(() => {
        source.disconnect()
        processor.disconnect()
        muteGain.disconnect()
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const raw = new Float32Array(total)
        let offset = 0
        for (const chunk of chunks) {
          raw.set(chunk, offset)
          offset += chunk.length
        }
        const result = resampleToMono16k(raw, context.sampleRate)
        context.close().then(() => resolve(result))
      }, 200)
    }),
  }
}

/** Linear-interpolation resample from nativeRate to 16kHz mono. */
function resampleToMono16k(input: Float32Array, nativeRate: number): Float32Array {
  if (nativeRate === TARGET_SAMPLE_RATE) return input
  const ratio = nativeRate / TARGET_SAMPLE_RATE
  const outLength = Math.round(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const sourceIndex = i * ratio
    const lower = Math.floor(sourceIndex)
    const upper = Math.min(lower + 1, input.length - 1)
    const frac = sourceIndex - lower
    out[i] = (input[lower] ?? 0) * (1 - frac) + (input[upper] ?? 0) * frac
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
 * @param recording - active recording to stop.
 * @param modelId - the shipped model to transcribe against.
 * @returns the transcript text.
 */
export async function finishDictation(
  recording: DictationRecording,
  modelId: string,
): Promise<string> {
  const samples = await recording.stop()
  const { text } = await voiceApi.transcribe(modelId, encodePcmBase64(samples))
  return text
}
