/** OpenAI cloud transcription Provider for voice dictation. */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type { VoiceModelDefinition, VoiceModelId, VoiceModelTask, VoiceModelsListValue, VoiceOperations, VoiceTranscribeRequest } from '@cinlan/voice'
import { VoiceError, VoiceModelId as brandModelId } from '@cinlan/voice'

/** Cordis plugin name. */
export const name = 'voice-openai'
/** Model registration and Host credential storage. */
export const inject = ['voice', 'credentials']

const API_KEY = credentialRef('OPENAI_API_KEY')
/** OpenAI-compatible deployment endpoint and request limits. */
export interface Config {
  /** API origin and version prefix; defaults to the official OpenAI API. */
  baseURL?: string
  /** Full request deadline in milliseconds. */
  requestTimeoutMs?: number
  /** Maximum transcription JSON response bytes. */
  responseMaxBytes?: number
}
/** Validated deployment configuration. */
export const Config: z<Config> = z.object({
  baseURL: z.string().default('https://api.openai.com/v1'),
  requestTimeoutMs: z.number().default(120_000),
  responseMaxBytes: z.number().default(1024 * 1024),
})

interface Options { url: string; requestTimeoutMs: number; responseMaxBytes: number }
function optionsOf(config: Config): Options {
  const base = new URL(config.baseURL ?? 'https://api.openai.com/v1')
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('voice-openai: baseURL must be an HTTP API URL without credentials, search, or fragment')
  const requestTimeoutMs = config.requestTimeoutMs ?? 120_000
  const responseMaxBytes = config.responseMaxBytes ?? 1024 * 1024
  if (![requestTimeoutMs, responseMaxBytes].every(value => Number.isSafeInteger(value) && value > 0) || requestTimeoutMs > 2_147_483_647) throw new Error('voice-openai: limits must be positive safe integers and timeout must fit a timer')
  return { url: base.href.replace(/\/$/, '') + '/audio/transcriptions', requestTimeoutMs, responseMaxBytes }
}
const OPENAI_MODELS = [
  ['openai-gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe', 'Fast OpenAI cloud transcription'],
  ['openai-gpt-4o-transcribe', 'GPT-4o Transcribe', 'Higher accuracy OpenAI cloud transcription'],
] as const

function definition(id: string, label: string, description: string, model: string): VoiceModelDefinition {
  return {
    id: brandModelId(id), name: label, label, description, language: 'multilingual', type: 'openai',
    provider: 'openai', streaming: false, recommended: id.includes('mini'), kind: 'non-streaming', approximateBytes: 0,
    download: { type: 'cloud' },
    architecture: { type: 'openai', model },
  }
}

const DEFINITIONS = OPENAI_MODELS.map(([id, label, description]) => definition(id, label, description, id.replace('openai-', '')))

function wav(samples: Float32Array): Blob {
  const bytes = Buffer.alloc(44 + samples.length * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8)
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] as number))
    bytes.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + index * 2)
  }
  return new Blob([bytes], { type: 'audio/wav' })
}

class OpenAiVoiceOperations implements VoiceOperations {
  supportsModel(definition: VoiceModelDefinition): boolean { return definition.provider === 'openai' }

  engineStatus(signal: AbortSignal) {
    signal.throwIfAborted()
    return Promise.resolve({ ok: true as const })
  }

  async modelsList(signal: AbortSignal): Promise<VoiceModelsListValue> {
    signal.throwIfAborted()
    const configured = (await this.ctx.credentials.describe(API_KEY)).configured
    return {
      models: DEFINITIONS.map(definition => ({
        definition: {
          id: definition.id, name: definition.name, description: definition.description,
          recommended: definition.recommended, approximateBytes: 0,
          label: definition.name, language: 'multilingual', type: 'openai',
          provider: 'openai', streaming: false },
        resource: {
          revision: 'openai', source: [this.options.url], installedVersion: null,
          availableVersion: 'openai', updateAvailable: false, integrity: 'unverified' as const,
        },
        task: null,
        status: configured ? { state: 'ready' as const, cacheDir: '' } : { state: 'not-downloaded' as const },
      })),
    }
  }

  private readonly lifetime = new AbortController()
  private readonly active = new Set<Promise<unknown>>()

  modelsDownload(_modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.unsupported(signal)
  }
  modelsReinstall(_modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.unsupported(signal)
  }
  modelsUpdate(_modelId: VoiceModelId, signal: AbortSignal): Promise<VoiceModelTask> {
    return this.unsupported(signal)
  }
  modelsCancel(_modelId: VoiceModelId, _taskId: string, signal: AbortSignal): Promise<{ cancelled: boolean }> {
    return this.unsupported(signal)
  }
  modelsRemove(_modelId: VoiceModelId, signal: AbortSignal): Promise<void> {
    return this.unsupported(signal)
  }
  transcribe(request: VoiceTranscribeRequest, signal: AbortSignal) {
    const abort = AbortSignal.any([signal, this.lifetime.signal, AbortSignal.timeout(this.options.requestTimeoutMs)])
    const operation = this.transcribeOpenAi(request, abort)
    this.active.add(operation)
    void operation.then(() => this.active.delete(operation), () => this.active.delete(operation))
    return operation
  }
  transcribeStream(
    _modelId: VoiceModelId,
    _chunks: AsyncIterable<{ pcm16kMonoBase64: string }>,
    signal: AbortSignal,
  ): AsyncIterable<never> {
    signal.throwIfAborted()
    throw new VoiceError('OpenAI transcription accepts complete clips', 'VOICE_STREAM_UNSUPPORTED')
  }

  constructor(private readonly ctx: Context, private readonly options: Options) {}

  async dispose(): Promise<void> {
    this.lifetime.abort()
    await Promise.allSettled(this.active)
  }

  private unsupported(signal: AbortSignal): never {
    signal.throwIfAborted()
    throw new VoiceError('Cloud models use API credentials and have no local installation', 'VOICE_INVALID_REQUEST')
  }

  private require(modelId: VoiceModelId): VoiceModelDefinition {
    const value = DEFINITIONS.find(item => item.id === modelId)
    if (value === undefined) throw new VoiceError(`unknown voice model '${modelId}'`, 'VOICE_MODEL_UNKNOWN')
    return value
  }

  private async transcribeOpenAi(request: VoiceTranscribeRequest, signal: AbortSignal) {
    signal.throwIfAborted()
    const definition = this.require(request.modelId)
    const resolved = await this.ctx.credentials.resolve(API_KEY)
    if (resolved === undefined) throw new VoiceError('OpenAI API key is not configured', 'VOICE_UNAVAILABLE')
    const form = new FormData()
    form.append('file', wav(request.samples), 'voice.wav')
    if (definition.architecture.type !== 'openai') throw new Error('Invalid OpenAI catalog entry')
    form.append('model', definition.architecture.model)
    form.append('response_format', 'json')
    if (request.language !== undefined) form.append('language', request.language)
    try {
      const response = await fetch(this.options.url, { method: 'POST', headers: { Authorization: `Bearer ${resolved.value}` }, body: form, signal, redirect: 'error' })
      if (!response.ok) {
        await response.body?.cancel()
        throw new VoiceError(`OpenAI transcription failed (HTTP ${String(response.status)}); check the API key, quota, and endpoint`, 'VOICE_OPERATION_FAILED')
      }
      const reader = response.body?.getReader()
      if (reader === undefined) throw new VoiceError('OpenAI returned an empty response', 'VOICE_OPERATION_FAILED')
      const chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > this.options.responseMaxBytes) throw new VoiceError('OpenAI transcription response exceeds the configured limit', 'VOICE_OPERATION_FAILED')
          chunks.push(chunk.value)
        }
      } finally { try { await reader.cancel() } finally { reader.releaseLock() } }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (body === null || typeof body !== 'object' || !('text' in body) || typeof body.text !== 'string') throw new VoiceError('OpenAI returned an invalid transcription response', 'VOICE_OPERATION_FAILED')
      signal.throwIfAborted()
      return { text: body.text }
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof VoiceError) throw error
      throw new VoiceError('OpenAI transcription failed; check the network and endpoint', 'VOICE_UNAVAILABLE')
    }
  }
}

/** Mount cloud models and cancellable transcription operations.
 * @param ctx - Provider registration and credential owner.
 * @param config - Endpoint and response bounds.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const options = optionsOf(config)
  for (const model of DEFINITIONS) ctx.effect(() => ctx.voice.registerModel(model), 'voice-openai: model ' + model.id)
  ctx.effect(() => {
    const operations = new OpenAiVoiceOperations(ctx, options)
    const unregister = ctx.voice.registerOperations(operations)
    return async () => { unregister(); await operations.dispose() }
  }, 'voice-openai: operations')
}
