/**
 * Ctrl+Shift+E dictation capture: records the microphone via ScriptProcessorNode
 * at the system's native sample rate, then manually resamples to 16kHz mono.
 * The controller owns transcription through its injected host callback.
 */
/** The sample rate the Host's shipped models require. */
const TARGET_SAMPLE_RATE = 16_000

/** One active recording session (ScriptProcessorNode + its accumulated samples). */
export interface DictationRecording {
  /** Stop capture and close its AudioContext; reject if cleanup fails, otherwise resolve the 16kHz mono PCM. */
  stop(): Promise<Float32Array>
}

/** Optional capture bound and sample-level feedback for an explicit microphone test. */
export interface RecordingOptions {
  /** Maximum captured seconds; samples beyond this limit are discarded. */
  maxSeconds: number
  /** Receive the RMS amplitude of each captured buffer, between zero and one. */
  onLevel: (level: number) => void
  /** Called once after the capture reaches its sample limit. */
  onLimit: () => void
}

/**
 * Start recording the given microphone stream via ScriptProcessorNode.
 * The AudioContext uses the system's native sample rate; samples are resampled
 * to 16kHz on stop. The caller owns the stream's lifecycle (acquired via
 * getUserMedia) and must stop its tracks when capture ends.
 * @param stream - an active microphone MediaStream.
 * @param audioContextCtor - injectable AudioContext constructor (tests provide a fake).
 * @param options - optional duration bound and meter callbacks for settings capture.
 * @returns an idempotent handle whose stop() disconnects capture and resolves PCM samples, or rejects if cleanup fails.
 */
export function startRecording(
  stream: MediaStream,
  audioContextCtor: typeof AudioContext = AudioContext,
  options?: RecordingOptions,
): DictationRecording {
  const context = new audioContextCtor()
  const nodes: AudioNode[] = []
  try {
    const source = context.createMediaStreamSource(stream)
    nodes.push(source)
    /* oxlint-disable typescript/no-deprecated -- Capture uses ScriptProcessorNode until a served AudioWorklet module is available. */
    const processor = context.createScriptProcessor(4096, 1, 1)
    nodes.push(processor)
    const chunks: Float32Array[] = []
    const maxSamples = options === undefined ? Infinity : Math.floor(options.maxSeconds * context.sampleRate)
    let sampleCount = 0
    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (sampleCount >= maxSamples) return
      const input = event.inputBuffer.getChannelData(0).subarray(0, maxSamples - sampleCount)
      chunks.push(new Float32Array(input))
      sampleCount += input.length
      if (options !== undefined) {
        const squareSum = input.reduce((sum, value) => sum + value * value, 0)
        options.onLevel(input.length === 0 ? 0 : Math.min(1, Math.sqrt(squareSum / input.length)))
        if (sampleCount >= maxSamples) options.onLimit()
      }
    }
    /* oxlint-enable typescript/no-deprecated */
    source.connect(processor)
    // ScriptProcessorNode requires a connection to destination to fire onaudioprocess;
    // route through a zero-gain node to avoid feedback.
    const muteGain = context.createGain()
    nodes.push(muteGain)
    muteGain.gain.value = 0
    processor.connect(muteGain)
    muteGain.connect(context.destination)

    let stopped: Promise<Float32Array> | undefined
    return {
      stop: () => stopped ??= (async () => {
        source.disconnect()
        processor.disconnect()
        muteGain.disconnect()
        // oxlint-disable-next-line typescript/no-deprecated -- Clear the owned ScriptProcessorNode callback after capture stops.
        processor.onaudioprocess = null
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const raw = new Float32Array(total)
        let offset = 0
        for (const chunk of chunks) {
          raw.set(chunk, offset)
          offset += chunk.length
        }
        chunks.length = 0
        const result = resampleToMono16k(raw, context.sampleRate)
        await context.close()
        return result
      })(),
    }
  } catch (error) {
    for (const node of nodes) node.disconnect()
    void context.close().catch(() => { /* Setup failure remains the caller-visible error if context closure also fails. */ })
    throw error
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
