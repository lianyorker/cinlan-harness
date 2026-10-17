import { describe, expect, it } from 'vitest'
import { architectureFilePaths } from '@deepseek-ai/dsh-voice'
import { SHIPPED_MODELS } from '../src/model-registry.ts'

describe('Orca local model catalog', () => {
  it('ships ten local models in picker order with exact identities', () => {
    expect(SHIPPED_MODELS.map(model => model.id)).toEqual([
      'parakeet-tdt-0.6b-v3-int8', 'parakeet-tdt-0.6b-v2-int8', 'zipformer-bilingual-zh-en',
      'paraformer-bilingual-zh-en', 'zipformer-streaming-en-20m', 'zipformer-streaming-zh-14m',
      'zipformer-streaming-korean', 'parakeet-tdt-ctc-0.6b-ja-int8', 'whisper-tiny', 'sense-voice-zh-en-ja-ko-yue',
    ])
    expect(SHIPPED_MODELS.filter(model => model.recommended).map(model => model.id)).toEqual(['parakeet-tdt-0.6b-v3-int8'])
  })

  it.each(SHIPPED_MODELS)('pins every required file and total bytes for $name', (model) => {
    expect(model.provider).toBe('local')
    expect(model.label).toBe(model.name)
    expect(model.language).toBeTruthy()
    expect(model.kind).toBe(model.streaming ? 'streaming' : 'non-streaming')
    expect(model.download.type).toBe('files')
    if (model.download.type !== 'files') throw new Error('Expected file pins')
    const entries = model.download.entries
    expect(new Set(entries.map(entry => entry.name)).size).toBe(entries.length)
    expect(model.approximateBytes).toBe(entries.reduce((total, entry) => total + entry.bytes, 0))
    for (const file of architectureFilePaths(model.architecture)) expect(entries.some(entry => entry.name === file)).toBe(true)
    for (const entry of entries) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(entry.bytes).toBeGreaterThan(0)
      expect(entry.url).toMatch(/\/resolve\/[a-f0-9]{40}\//)
    }
  })
})
