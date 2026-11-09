/**
 * Ctrl+Shift+E dictation capture: records the microphone via AudioWorkletNode
 * at the system's native sample rate, then manually resamples to 16kHz mono.
 * The controller owns transcription through its injected host callback.
 */
/** The sample rate the Host's shipped models require. */
const TARGET_SAMPLE_RATE = 16_000
const STREAM_CHUNK_SAMPLES = 1_600

/** One active recording session and its accumulated samples. */
export interface DictationRecording {
  /** Stop capture and close its AudioContext; retained samples are empty when chunks are streamed. */
  stop(): Promise<Float32Array>
}

/** Optional capture bound and sample-level feedback for an explicit microphone test. */
export interface RecordingOptions {
  /** Maximum captured seconds; samples beyond this limit are discarded. */
  maxSeconds?: number
  /** Receive the RMS amplitude of each captured buffer, between zero and one. */
  onLevel?: (level: number) => void
  /** Called once after the capture reaches its sample limit. */
  onLimit?: () => void
  /** Receive bounded 16kHz chunks; when present, complete audio is not retained. */
  onPcmChunk?: (samples: Float32Array) => void
}

/**
 * Load the bundled AudioWorklet processor and start recording a microphone stream.
 * The AudioContext uses the system's native sample rate; samples are resampled
 * to 16kHz on stop, or incrementally when `onPcmChunk` is supplied. The caller owns the stream's lifecycle (acquired via
 * getUserMedia) and must stop its tracks when capture ends.
 * @param stream - an active microphone MediaStream.
 * @param audioContextCtor - injectable AudioContext constructor (tests provide a fake).
 * @param options - optional duration bound and meter callbacks for settings capture.
 * @param signal - optional cancellation of pending module loading or context resume.
 * @returns an idempotent handle whose stop() disconnects capture and resolves received PCM samples, or rejects if capture or cleanup fails.
 */
export async function startRecording(
  stream: MediaStream,
  audioContextCtor: typeof AudioContext = AudioContext,
  options?: RecordingOptions,
  signal?: AbortSignal,
): Promise<DictationRecording> {
  signal?.throwIfAborted()
  const context = new audioContextCtor()
  const nodes: AudioNode[] = []
  let processor: AudioWorkletNode | undefined
  let closed: Promise<void> | undefined
  const release = (): Promise<void> => closed ??= (async () => {
    if (processor !== undefined) {
      processor.port.onmessage = null
      processor.onprocessorerror = null
      processor.port.close()
    }
    try {
      for (const node of nodes) node.disconnect()
    } finally {
      await context.close()
    }
  })()
  const cancelled = Promise.withResolvers<never>()
  const abort = (): void => { cancelled.reject(signal?.reason) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    const moduleUrl = URL.createObjectURL(new Blob([CAPTURE_PROCESSOR], { type: 'text/javascript' }))
    try {
      await Promise.race([context.audioWorklet.addModule(moduleUrl), cancelled.promise])
    } finally {
      URL.revokeObjectURL(moduleUrl)
    }
    signal?.throwIfAborted()
    const source = context.createMediaStreamSource(stream)
    nodes.push(source)
    const capture = new AudioWorkletNode(context, 'clh-dictation-capture', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
    })
    processor = capture
    nodes.push(capture)
    let captureFailed = false
    capture.onprocessorerror = () => { captureFailed = true }
    const chunks: Float32Array[] = []
    const pendingPcm: number[] = []
    const resampler = new StreamingResampler(context.sampleRate)
    const maxSamples = options?.maxSeconds === undefined ? Infinity : Math.floor(options.maxSeconds * context.sampleRate)
    let sampleCount = 0
    capture.port.onmessage = (event: MessageEvent<unknown>) => {
      if (sampleCount >= maxSamples) return
      if (!(event.data instanceof Float32Array)) { captureFailed = true; return }
      const input = event.data.subarray(0, maxSamples - sampleCount)
      if (options?.onPcmChunk === undefined) chunks.push(new Float32Array(input))
      else {
        const output = resampler.accept(input)
        for (const sample of output) {
          pendingPcm.push(sample)
          if (pendingPcm.length === STREAM_CHUNK_SAMPLES) {
            if (!sendPcmChunk(pendingPcm, options.onPcmChunk)) captureFailed = true
            pendingPcm.length = 0
          }
        }
      }
      sampleCount += input.length
      if (options?.onLevel !== undefined) {
        const squareSum = input.reduce((sum, value) => sum + value * value, 0)
        options.onLevel(input.length === 0 ? 0 : Math.min(1, Math.sqrt(squareSum / input.length)))
      }
      if (sampleCount >= maxSamples) options?.onLimit?.()
    }
    source.connect(capture)
    // Keep the capture graph active without playing microphone input through the speakers.
    const muteGain = context.createGain()
    nodes.push(muteGain)
    muteGain.gain.value = 0
    capture.connect(muteGain)
    muteGain.connect(context.destination)
    await Promise.race([context.resume(), cancelled.promise])
    signal?.throwIfAborted()

    let stopped: Promise<Float32Array> | undefined
    return {
      stop: () => stopped ??= (async () => {
        await release()
        if (captureFailed) throw new Error('Voice audio capture failed; start a new recording.')
        if (options?.onPcmChunk !== undefined) {
          if (pendingPcm.length > 0 && !sendPcmChunk(pendingPcm, options.onPcmChunk)) captureFailed = true
          if (captureFailed) throw new Error('Voice audio capture failed; start a new recording.')
          return new Float32Array()
        }
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const raw = new Float32Array(total)
        let offset = 0
        for (const chunk of chunks) {
          raw.set(chunk, offset)
          offset += chunk.length
        }
        chunks.length = 0
        const result = resampleToMono16k(raw, context.sampleRate)
        return result
      })(),
    }
  } catch (error) {
    await release().catch((_cleanupError: unknown) => { /* Setup failure remains visible after context closure was attempted. */ })
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

function sendPcmChunk(samples: number[], onPcmChunk: (samples: Float32Array) => void): boolean {
  try { onPcmChunk(Float32Array.from(samples)); return true } catch (_error: unknown) { return false }
}

// A self-contained module avoids a second asset route in Web and the Desktop byte-pipe carrier.
const CAPTURE_PROCESSOR = `
class DictationCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel !== undefined) {
      const samples = channel.slice();
      this.port.postMessage(samples, [samples.buffer]);
    }
    return true;
  }
}
registerProcessor('clh-dictation-capture', DictationCapture);
`

/** Resample mono audio to 16 kHz with linear interpolation.
 * @param input - Source mono samples.
 * @param nativeRate - Source sample rate in hertz.
 * @returns Resampled mono samples.
 */
export function resampleToMono16k(input: Float32Array, nativeRate: number): Float32Array {
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

/** Resample consecutive worklet frames without resetting interpolation phase. */
class StreamingResampler {
  private tail = new Float32Array()
  private nextPosition = 0
  private readonly ratio: number

  constructor(nativeRate: number) {
    this.ratio = nativeRate / TARGET_SAMPLE_RATE
  }

  accept(input: Float32Array): Float32Array {
    if (this.ratio === 1) return new Float32Array(input)
    const combined = new Float32Array(this.tail.length + input.length)
    combined.set(this.tail)
    combined.set(input, this.tail.length)
    const output: number[] = []
    while (this.nextPosition < combined.length - 1) {
      const lower = Math.floor(this.nextPosition)
      const frac = this.nextPosition - lower
      output.push((combined[lower] ?? 0) * (1 - frac) + (combined[lower + 1] ?? 0) * frac)
      this.nextPosition += this.ratio
    }
    this.nextPosition -= combined.length - 1
    this.tail = combined.slice(-1)
    return Float32Array.from(output)
  }
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
