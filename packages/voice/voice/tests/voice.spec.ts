import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import VoiceRuntime, { VoiceError, VoiceModelId } from '../src/index.ts'
import type { VoiceEngine, VoiceModelDefinition, VoiceOperations, VoiceRecognizer } from '../src/index.ts'

function definition(id: string): VoiceModelDefinition {
  return {
    id: VoiceModelId(id),
    name: id,
    description: 'test model',
    recommended: false,
    kind: 'streaming',
    approximateBytes: 1024,
    download: { type: 'archive', url: 'https://example.invalid/model.tar.bz2', sha256: '0'.repeat(64) },
    architecture: { type: 'transducer', encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
  }
}

function engine(id = 'sherpa-onnx'): VoiceEngine & { loadModel: ReturnType<typeof vi.fn> } {
  const recognizer: VoiceRecognizer = {
    transcribe: vi.fn(async () => 'hello'),
    dispose: vi.fn(),
  }
  return { id, loadModel: vi.fn(async () => recognizer) }
}

async function mount() {
  const ctx = new Context()
  const fiber = await ctx.plugin(VoiceRuntime)
  return { ctx, fiber }
}

describe('VoiceRuntime', () => {
  it('brands opaque model ids and exposes typed failures', () => {
    expect(VoiceModelId('zh-14m')).toBe('zh-14m')
    expect(new VoiceError('failed', 'VOICE_TEST')).toMatchObject({
      name: 'VoiceError', message: 'failed', code: 'VOICE_TEST',
    })
  })

  it('reports no engine until one registers, and rejects a second registration', async () => {
    const { ctx, fiber } = await mount()
    expect(ctx.voice.engineOrUndefined).toBeUndefined()
    const one = engine('one')
    const unregister = ctx.voice.registerEngine(one)
    expect(ctx.voice.engineOrUndefined).toBe(one)
    expect(() => ctx.voice.registerEngine(engine('two')))
      .toThrow(expect.objectContaining({ code: 'VOICE_ENGINE_DUPLICATE' }))
    unregister()
    unregister()
    expect(ctx.voice.engineOrUndefined).toBeUndefined()
    await fiber.dispose()
  })

  it('registers models, rejects duplicates, and resolves or rejects lookups', async () => {
    const { ctx, fiber } = await mount()
    expect(ctx.voice.listDefinitions()).toEqual([])
    const zh = definition('zh-14m')
    const bilingual = definition('bilingual')
    const unregisterZh = ctx.voice.registerModel(zh)
    ctx.voice.registerModel(bilingual)
    expect(ctx.voice.listDefinitions()).toEqual([zh, bilingual])
    expect(ctx.voice.requireDefinition(zh.id)).toBe(zh)
    expect(() => ctx.voice.requireDefinition(VoiceModelId('missing')))
      .toThrow(expect.objectContaining({ code: 'VOICE_MODEL_UNKNOWN' }))
    expect(() => ctx.voice.registerModel(bilingual))
      .toThrow(expect.objectContaining({ code: 'VOICE_MODEL_DUPLICATE' }))
    unregisterZh()
    expect(ctx.voice.listDefinitions()).toEqual([bilingual])
    await fiber.dispose()
  })

  it('a registered engine loads a model and transcribes through the recognizer contract', async () => {
    const { ctx, fiber } = await mount()
    const model = definition('zh-14m')
    ctx.voice.registerModel(model)
    const mounted = engine()
    ctx.voice.registerEngine(mounted)
    const recognizer = await ctx.voice.engineOrUndefined?.loadModel(model, '/cache/zh-14m')
    expect(mounted.loadModel).toHaveBeenCalledWith(model, '/cache/zh-14m')
    await expect(recognizer?.transcribe(new Float32Array([0, 0]))).resolves.toBe('hello')
    await fiber.dispose()
  })

  it('gates operations behind a single registered provider and forwards engine status', async () => {
    const { ctx, fiber } = await mount()
    const signal = new AbortController().signal
    expect(() => ctx.voice.engineStatus(signal)).toThrow(expect.objectContaining({ code: 'VOICE_UNAVAILABLE' }))
    const aborted = new AbortController()
    aborted.abort()
    const operations: VoiceOperations = {
      engineStatus: vi.fn(async () => ({ ok: true as const })),
      modelsList: vi.fn(async () => ({ models: [] })),
      modelsDownload: vi.fn(),
      modelsReinstall: vi.fn(),
      modelsUpdate: vi.fn(),
      modelsCancel: vi.fn(),
      modelsRemove: vi.fn(async () => {}),
      transcribe: vi.fn(async () => ({ text: 'hello' })),
    }
    const unregister = ctx.voice.registerOperations(operations)
    expect(() => ctx.voice.registerOperations(operations))
      .toThrow(expect.objectContaining({ code: 'VOICE_OPERATIONS_DUPLICATE' }))
    await expect(ctx.voice.engineStatus(signal)).resolves.toEqual({ ok: true })
    expect(operations.engineStatus).toHaveBeenCalledWith(signal)
    expect(() => ctx.voice.engineStatus(aborted.signal)).toThrow()
    expect(operations.engineStatus).toHaveBeenCalledOnce()
    unregister()
    unregister()
    expect(() => ctx.voice.engineStatus(signal)).toThrow(expect.objectContaining({ code: 'VOICE_UNAVAILABLE' }))
    await fiber.dispose()
  })

  it('validates transport payloads and decodes canonical PCM', async () => {
    const { parseVoiceModelRequest, parseVoiceCancelRequest, parseVoiceTranscribeRequest } = await import('../src/transport.ts')
    const taskId = crypto.randomUUID()
    expect(parseVoiceModelRequest({ modelId: 'zh-14m' })).toBe('zh-14m')
    for (const bad of [null, {}, { modelId: '' }, { modelId: 7 }, { modelId: 'x'.repeat(257) }]) {
      expect(() => parseVoiceModelRequest(bad)).toThrow(expect.objectContaining({ code: 'VOICE_INVALID_REQUEST' }))
    }
    expect(parseVoiceCancelRequest({ modelId: 'zh-14m', taskId })).toEqual({ modelId: 'zh-14m', taskId })
    for (const bad of [{ modelId: 'm' }, { modelId: 'm', taskId: 'not-uuid' }, { modelId: 'm', taskId, extra: 1 }]) {
      expect(() => parseVoiceCancelRequest(bad)).toThrow(expect.objectContaining({ code: 'VOICE_INVALID_REQUEST' }))
    }
    for (const bad of [null, { modelId: 'm' }, { modelId: 'm', pcm16kMonoBase64: '' }, { modelId: 'm', pcm16kMonoBase64: 'x'.repeat(22_000_001) }]) {
      expect(() => parseVoiceTranscribeRequest(bad)).toThrow(expect.objectContaining({ code: 'VOICE_INVALID_REQUEST' }))
    }
    const decoded = parseVoiceTranscribeRequest({
      modelId: 'zh-14m',
      pcm16kMonoBase64: Buffer.alloc(8).toString('base64'),
    })
    expect(decoded.modelId).toBe('zh-14m')
    expect(decoded.samples).toEqual(new Float32Array([0, 0]))
    for (const pcm of [
      Buffer.from('a'),
      Buffer.alloc(3),
      Buffer.alloc(1).fill(0),
    ]) {
      expect(() => parseVoiceTranscribeRequest({ modelId: 'm', pcm16kMonoBase64: pcm.toString('base64') }))
        .toThrow(expect.objectContaining({ code: 'VOICE_INVALID_REQUEST' }))
    }
    const nonFinite = Buffer.alloc(4)
    nonFinite.writeFloatLE(Number.POSITIVE_INFINITY)
    expect(() => parseVoiceTranscribeRequest({ modelId: 'm', pcm16kMonoBase64: nonFinite.toString('base64') }))
      .toThrow(expect.objectContaining({ code: 'VOICE_INVALID_REQUEST' }))
  })
})
