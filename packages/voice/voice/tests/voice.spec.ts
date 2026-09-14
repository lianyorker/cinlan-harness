import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import VoiceRuntime, { VoiceError, VoiceModelId } from '../src/index.ts'
import type { VoiceEngine, VoiceModelDefinition, VoiceRecognizer } from '../src/index.ts'

function definition(id: string): VoiceModelDefinition {
  return {
    id: VoiceModelId(id),
    name: id,
    kind: 'streaming',
    approximateBytes: 1024,
    archiveUrl: 'https://example.invalid/model.tar.bz2',
    archiveSha256: '0'.repeat(64),
    files: { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
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
})
