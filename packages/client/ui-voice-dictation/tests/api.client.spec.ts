import { afterEach, describe, expect, it, vi } from 'vitest'
import { voiceApi, VoiceApiError } from '../src/client/api.ts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('voiceApi', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('engineStatus posts to /voice/api/engine.status and returns the value', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, value: { ok: true } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.engineStatus()).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/voice/api/engine.status', expect.objectContaining({ method: 'POST' }))
  })

  it('modelsList posts to /voice/api/models.list and returns the value', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, value: { models: [] } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.modelsList()).resolves.toEqual({ models: [] })
    expect(fetchMock).toHaveBeenCalledWith('/voice/api/models.list', expect.objectContaining({ method: 'POST' }))
  })

  it('modelsDownload posts the modelId payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, value: { cacheDir: '/cache/x' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.modelsDownload('zh')).resolves.toEqual({ cacheDir: '/cache/x' })
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(call[1].body as string)).toEqual({ modelId: 'zh' })
  })

  it('modelsRemove posts the modelId payload', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, value: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.modelsRemove('zh')).resolves.toEqual({})
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(call[0]).toBe('/voice/api/models.remove')
    expect(JSON.parse(call[1].body as string)).toEqual({ modelId: 'zh' })
  })

  it('transcribe posts modelId and pcm payload and returns text', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true, value: { text: 'hello' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.transcribe('zh', 'YWJj')).resolves.toEqual({ text: 'hello' })
  })

  it('throws VoiceApiError with the wire code on a business failure', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(404, { ok: false, error: { code: 'not-found', message: 'unknown model' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(voiceApi.modelsDownload('missing')).rejects.toMatchObject({ code: 'not-found', message: 'unknown model' })
  })

  it('throws a network VoiceApiError when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(voiceApi.modelsList()).rejects.toBeInstanceOf(VoiceApiError)
    await expect(voiceApi.modelsList()).rejects.toMatchObject({ code: 'network', message: 'offline' })
  })

  it('throws an http-coded error when the response is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 500 })))
    await expect(voiceApi.modelsList()).rejects.toMatchObject({ code: 'http', message: 'HTTP 500' })
  })
})
