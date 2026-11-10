import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { authenticatedCookie, createHarness, httpFixture, models, remoteResult } from './harness.ts'

const MODEL_ID = 'openai-gpt-4o-mini-transcribe'
const PCM = Buffer.from(new Float32Array([0, 0.5, -1, 1.25]).buffer).toString('base64')
const key = () => 'test-key-' + randomUUID()

describe('OpenAI transcription through real voice Remote', () => {
  it('stores, rotates, and clears the key without returning it; posts PCM as WAV with a language hint', async () => {
    const received: { authorization: string | undefined; form: FormData; url: string | undefined }[] = []
    const upstream = await httpFixture((request, response) => {
      void (async () => {
        const chunks: Buffer[] = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': request.headers['content-type']! } }).formData()
        received.push({ authorization: request.headers.authorization, form, url: request.url })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ text: 'cloud transcript' }))
      })().catch(() => { response.writeHead(500); response.end() })
    })
    const harness = await createHarness(true, { openAi: { baseURL: upstream.origin + '/v1' } })
    const first = key()
    const second = key()
    expect(await remoteResult(await harness.remote('openAiKeySave', { value: { apiKey: first } }))).toEqual({ ok: true, value: {} })
    const status = await remoteResult(await harness.remote('openAiKeyStatus'))
    expect(status).toEqual({ ok: true, value: { configured: true, writable: true } })
    expect(JSON.stringify(status)).not.toContain(first)
    const roster = await models(harness)
    expect(roster.filter(row => row.definition.provider === 'openai').map(row => row.definition.id)).toEqual([
      MODEL_ID, 'openai-gpt-4o-transcribe',
    ])
    expect(roster.find(row => row.definition.id === MODEL_ID)?.status.state).toBe('ready')
    expect(roster.find(row => row.definition.id === MODEL_ID)?.resource.integrity).toBe('unverified')

    const cookie = authenticatedCookie(harness.ctx.connection, harness.origin!)
    expect((await harness.http('openAiKeySave', { value: { apiKey: second } })).status).toBe(401)
    const request = { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM, language: 'zh' } }
    expect(await remoteResult(await harness.http('transcribe', request, cookie))).toEqual({ ok: true, value: { text: 'cloud transcript' } })
    expect(received[0]?.authorization).toBe('Bearer ' + first)
    expect(received[0]?.url).toBe('/v1/audio/transcriptions')
    expect(received[0]?.form.get('model')).toBe('gpt-4o-mini-transcribe')
    expect(received[0]?.form.get('language')).toBe('zh')
    expect(received[0]?.form.get('response_format')).toBe('json')
    const file = received[0]?.form.get('file')
    if (!(file instanceof Blob)) throw new Error('Expected uploaded WAV file')
    const wav = Buffer.from(await file.arrayBuffer())
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect([44, 46, 48, 50].map(offset => wav.readInt16LE(offset))).toEqual([0, 16384, -32768, 32767])

    await harness.remote('openAiKeySave', { value: { apiKey: second } })
    expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } }))).toMatchObject({ ok: true })
    expect(received[1]?.authorization).toBe('Bearer ' + second)
    expect(received[1]?.form.has('language')).toBe(false)
    expect(await remoteResult(await harness.remote('openAiKeyClear'))).toEqual({ ok: true, value: {} })
    expect(await remoteResult(await harness.remote('openAiKeyStatus'))).toEqual({ ok: true, value: { configured: false, writable: true } })
    expect(await remoteResult(await harness.remote('transcribe', request))).toMatchObject({ ok: false, error: { code: 'voice/unavailable' } })
    expect((await models(harness)).find(row => row.definition.id === MODEL_ID)?.status.state).toBe('not-downloaded')
    expect(received).toHaveLength(2)
  })

  it.each([
    { status: 401, body: 'credential details must stay private', limit: 128 },
    { status: 200, body: '{invalid-json', limit: 128 },
    { status: 200, body: '{"text":12}', limit: 128 },
    { status: 200, body: '{"text":"' + 'x'.repeat(256) + '"}', limit: 32 },
  ])('contains upstream HTTP $status and invalid or oversized JSON', async ({ status, body, limit }) => {
    const upstream = await httpFixture((request, response) => {
      request.resume()
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(body)
    })
    const harness = await createHarness(false, { openAi: { baseURL: upstream.origin, responseMaxBytes: limit } })
    const secret = key()
    await harness.remote('openAiKeySave', { value: { apiKey: secret } })
    const result = await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } }))
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain(body)
  })

  it('rejects malformed keys and language hints before contacting OpenAI', async () => {
    const upstream = vi.fn()
    const server = await httpFixture((request, response) => { upstream(); request.resume(); response.end('{"text":"bad"}') })
    const harness = await createHarness(false, { openAi: { baseURL: server.origin } })
    for (const apiKey of ['', 'line\nbreak', 'spaces invalid', 'x'.repeat(4097)]) {
      expect(await remoteResult(await harness.remote('openAiKeySave', { value: { apiKey } }))).toMatchObject({ ok: false })
    }
    await harness.remote('openAiKeySave', { value: { apiKey: key() } })
    for (const language of ['../../en', 'auto', 'EN', 'english']) {
      expect(await remoteResult(await harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM, language } })))
        .toMatchObject({ ok: false })
    }
    expect(upstream).not.toHaveBeenCalled()
  })

  it('cancels and joins an in-flight request when its Provider unloads', async () => {
    const entered = Promise.withResolvers<undefined>()
    const closed = Promise.withResolvers<undefined>()
    const upstream = await httpFixture((request, response) => {
      request.resume()
      response.on('close', () => { closed.resolve(undefined) })
      entered.resolve(undefined)
    })
    const harness = await createHarness(false, { openAi: { baseURL: upstream.origin } })
    await harness.remote('openAiKeySave', { value: { apiKey: key() } })
    const pending = harness.remote('transcribe', { request: { modelId: MODEL_ID, pcm16kMonoBase64: PCM } }).then(remoteResult)
    await entered.promise
    await harness.setEnabled('@cinlan/voice-openai', false)
    await closed.promise
    expect((await pending).ok).toBe(false)
    expect((await models(harness)).some(row => row.definition.provider === 'openai')).toBe(false)
  })
})
