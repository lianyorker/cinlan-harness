/* oxlint-disable typescript/unbound-method -- response spies are inert test doubles. */
import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { readJsonBody, requireString, VoiceApiError, writeError, writeJson, writeOk } from '../src/wire.ts'

function fakeResponse() {
  const chunks: string[] = []
  return {
    writeHead: vi.fn(),
    end: vi.fn((body: string) => { chunks.push(body) }),
    chunks,
  } as unknown as import('node:http').ServerResponse & { chunks: string[] }
}

describe('readJsonBody', () => {
  it('parses a JSON body', async () => {
    const req = Readable.from([Buffer.from(JSON.stringify({ a: 1 }))]) as unknown as import('node:http').IncomingMessage
    await expect(readJsonBody(req)).resolves.toEqual({ a: 1 })
  })

  it('treats a blank body as an empty object', async () => {
    const req = Readable.from([]) as unknown as import('node:http').IncomingMessage
    await expect(readJsonBody(req)).resolves.toEqual({})
  })

  it('rejects malformed JSON', async () => {
    const req = Readable.from([Buffer.from('not json')]) as unknown as import('node:http').IncomingMessage
    await expect(readJsonBody(req)).rejects.toThrow(/not valid JSON/)
  })

  it('rejects an oversized body', async () => {
    const oversized = Buffer.alloc((32 << 20) + 1)
    const req = Readable.from([oversized]) as unknown as import('node:http').IncomingMessage
    await expect(readJsonBody(req)).rejects.toThrow(/too large/)
  })
})

describe('requireString', () => {
  it('returns a present string field', () => {
    expect(requireString({ modelId: 'zh' }, 'modelId')).toBe('zh')
  })

  it('throws bad-request for a missing or empty field', () => {
    expect(() => requireString({}, 'modelId')).toThrow(expect.objectContaining({ code: 'bad-request' }))
    expect(() => requireString({ modelId: '' }, 'modelId')).toThrow(expect.objectContaining({ code: 'bad-request' }))
  })
})

describe('response envelope', () => {
  it('writeOk writes a 200 success envelope', () => {
    const res = fakeResponse()
    writeOk(res, { text: 'hi' })
    expect(res.writeHead).toHaveBeenCalledWith(200, { 'content-type': 'application/json; charset=utf-8' })
    expect(JSON.parse(res.chunks[0]!)).toEqual({ ok: true, value: { text: 'hi' } })
  })

  it('writeError writes the VoiceApiError status and code', () => {
    const res = fakeResponse()
    writeError(res, new VoiceApiError('not-found', 'missing', 404))
    expect(res.writeHead).toHaveBeenCalledWith(404, { 'content-type': 'application/json; charset=utf-8' })
    expect(JSON.parse(res.chunks[0]!)).toEqual({ ok: false, error: { code: 'not-found', message: 'missing' } })
  })

  it('writeError maps an unknown thrown value to a 500 internal error', () => {
    const res = fakeResponse()
    writeError(res, 'plain string failure')
    expect(JSON.parse(res.chunks[0]!)).toEqual({ ok: false, error: { code: 'internal', message: 'plain string failure' } })
  })

  it('writeJson serializes an arbitrary status and body', () => {
    const res = fakeResponse()
    writeJson(res, 201, { created: true })
    expect(res.writeHead).toHaveBeenCalledWith(201, { 'content-type': 'application/json; charset=utf-8' })
  })
})
