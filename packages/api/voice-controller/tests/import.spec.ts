import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VoiceModelRow } from '@cinlan/voice'
import { authenticatedCookie, createHarness, models, nativeRecognizer, remoteResult } from './harness.ts'

describe('user voice models through Remote', () => {
  it('imports, transcribes with a language hint, restores after provider reload, and removes only the managed copy', async () => {
    const harness = await createHarness(true)
    const source = join(harness.root, 'user-model')
    await mkdir(source)
    await writeFile(join(source, 'model.onnx'), 'user model bytes')
    await writeFile(join(source, 'tokens.txt'), 'tokens')
    await writeFile(join(source, 'clh-voice-model.json'), JSON.stringify({
      name: 'My SenseVoice', kind: 'non-streaming', language: 'multilingual',
      architecture: { type: 'sense-voice', model: 'model.onnx', tokens: 'tokens.txt', language: 'auto' },
    }))
    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    expect((await harness.http('modelsImport', { request: { sourcePath: source } })).status).toBe(401)
    const result = await remoteResult(await harness.http('modelsImport', { request: { sourcePath: source } }, cookie))
    if (!result.ok) throw new Error(result.error.message)
    const row = result.value as VoiceModelRow
    expect(row.definition).toMatchObject({ name: 'My SenseVoice', userImported: true, provider: 'local' })
    expect(row.definition.id).toMatch(/^user-/)
    expect(row.resource.integrity).toBe('verified')
    if (row.status.state !== 'ready') throw new Error('Imported model is not ready')
    expect(await readFile(join(row.status.cacheDir, 'model.onnx'), 'utf8')).toBe('user model bytes')
    await harness.setEnabled('@cinlan/voice-sherpa-onnx', false)
    await harness.setEnabled('@cinlan/voice-sherpa-onnx', true)
    expect((await models(harness)).find(item => item.definition.id === row.definition.id)).toEqual(row)
    const native = nativeRecognizer('imported transcript')
    expect(await remoteResult(await harness.remote('transcribe', { request: {
      modelId: row.definition.id, pcm16kMonoBase64: Buffer.from(new Float32Array([0.25]).buffer).toString('base64'), language: 'ja',
    } }))).toEqual({ ok: true, value: { text: 'imported transcript' } })
    expect(native.construct).toHaveBeenCalledWith(expect.objectContaining({ modelConfig: expect.objectContaining({ senseVoice: expect.objectContaining({ language: 'ja' }) }) }))
    for (const method of ['modelsDownload', 'modelsReinstall', 'modelsUpdate']) {
      expect(await remoteResult(await harness.remote(method, { request: { modelId: row.definition.id } }))).toMatchObject({ ok: false, error: { code: 'voice/invalid-request' } })
    }
    expect(await remoteResult(await harness.remote('modelsRemove', { request: { modelId: row.definition.id } }))).toEqual({ ok: true, value: {} })
    expect((await models(harness)).some(item => item.definition.id === row.definition.id)).toBe(false)
    await harness.setEnabled('@cinlan/voice-sherpa-onnx', false)
    await harness.setEnabled('@cinlan/voice-sherpa-onnx', true)
    expect((await models(harness)).some(item => item.definition.id === row.definition.id)).toBe(false)
    expect(await readFile(join(source, 'model.onnx'), 'utf8')).toBe('user model bytes')
  })
})
