/** Child-process entry for one online sherpa-onnx recognition session. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { VoiceModelArchitecture } from '@cinlan/voice'
import { loadSherpaOnnx } from './sherpa-deps.ts'
import type { SherpaOnlineRecognizer, SherpaOnlineStream } from './sherpa-deps.ts'

type Request =
  | { readonly type: 'start'; readonly architecture: VoiceModelArchitecture; readonly cacheDir: string }
  | { readonly type: 'audio'; readonly id: number; readonly samples: Float32Array }
  | { readonly type: 'finish'; readonly id: number }

const SAMPLE_RATE = 16_000
const TAIL_PADDING_SECONDS = 0.4
let recognizer: SherpaOnlineRecognizer | undefined
let stream: SherpaOnlineStream | undefined

process.on('message', (value: unknown) => {
  void Promise.resolve().then(() => handle(parseRequest(value))).catch(() => {
    if (process.send === undefined) return
    process.send({ type: 'failure', message: 'Local speech recognition failed.' }, () => { process.disconnect() })
  })
})

async function handle(request: Request): Promise<void> {
  if (request.type === 'start') {
    const workerEntry = process.argv[1]
    if (workerEntry === undefined) throw new Error('recognition worker entry path is unavailable')
    const module = loadSherpaOnnx(createRequire(workerEntry))
    if (module === null) throw new Error('native addon unavailable')
    const architecture = request.architecture
    if (architecture.type === 'openai') throw new Error('cloud model cannot run in local recognition worker')
    const resolve = (path: string): string => {
      const parts = path.split('/')
      return parts.length > 1 ? join(request.cacheDir, ...parts.slice(1)) : join(request.cacheDir, path)
    }
    const tokens = resolve(architecture.tokens)
    const base = { tokens, numThreads: 1, provider: 'cpu' as const, debug: 0 as const }
    if (architecture.type === 'transducer') {
      recognizer = new module.OnlineRecognizer({
        featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
        modelConfig: {
          ...base,
          transducer: {
            encoder: resolve(architecture.encoder),
            decoder: resolve(architecture.decoder),
            joiner: resolve(architecture.joiner),
          },
        },
      })
    } else if (architecture.type === 'paraformer') {
      recognizer = new module.OnlineRecognizer({ featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 }, modelConfig: {
        ...base,
        paraformer: { encoder: resolve(architecture.encoder), decoder: resolve(architecture.decoder) },
      } })
    } else {
      throw new Error('model does not support online recognition')
    }
    stream = recognizer.createStream()
    post({ type: 'ready' })
    return
  }

  if (recognizer === undefined || stream === undefined) throw new Error('recognizer is not ready')
  if (request.type === 'audio') {
    const samples = request.samples
    if (!(samples instanceof Float32Array) || samples.length === 0 || samples.some(sample => !Number.isFinite(sample))) {
      throw new Error('invalid audio chunk')
    }
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: request.samples })
    decodeReady(recognizer, stream)
    post({ type: 'partial', id: request.id, text: recognizer.getResult(stream).text })
    return
  }

  stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples: new Float32Array(Math.round(SAMPLE_RATE * TAIL_PADDING_SECONDS)) })
  stream.inputFinished()
  decodeReady(recognizer, stream)
  if (process.send === undefined) throw new Error('recognition worker has no IPC channel')
  process.send({ type: 'final', id: request.id, text: recognizer.getResult(stream).text }, () => { process.disconnect() })
}

function parseRequest(value: unknown): Request {
  if (!isRecord(value) || typeof value.type !== 'string') throw new Error('invalid recognition request')
  if (value.type === 'start') {
    if (typeof value.cacheDir !== 'string') throw new Error('invalid recognition model path')
    const architecture = parseOnlineArchitecture(value.architecture)
    return { type: 'start', architecture, cacheDir: value.cacheDir }
  }
  if (value.type === 'audio') {
    if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || !(value.samples instanceof Float32Array)) {
      throw new Error('invalid audio request')
    }
    return { type: 'audio', id: value.id, samples: value.samples }
  }
  if (value.type === 'finish' && typeof value.id === 'number' && Number.isSafeInteger(value.id)) {
    return { type: 'finish', id: value.id }
  }
  throw new Error('invalid recognition request')
}

function parseOnlineArchitecture(value: unknown): VoiceModelArchitecture {
  if (!isRecord(value) || typeof value.type !== 'string' || typeof value.tokens !== 'string') {
    throw new Error('invalid online recognition architecture')
  }
  if (value.type === 'transducer'
    && typeof value.encoder === 'string' && typeof value.decoder === 'string' && typeof value.joiner === 'string') {
    return { type: value.type, encoder: value.encoder, decoder: value.decoder, joiner: value.joiner, tokens: value.tokens }
  }
  if (value.type === 'paraformer' && typeof value.encoder === 'string' && typeof value.decoder === 'string') {
    return { type: value.type, encoder: value.encoder, decoder: value.decoder, tokens: value.tokens }
  }
  throw new Error('unsupported online recognition architecture')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function decodeReady(recognizer: SherpaOnlineRecognizer, stream: SherpaOnlineStream): void {
  while (recognizer.isReady(stream)) recognizer.decode(stream)
}

function post(message: Record<string, unknown>): void {
  if (process.send === undefined) throw new Error('recognition worker has no IPC channel')
  process.send(message)
}
