/** Wire validation and byte bounds independent of worker filesystem operations. */

import { PassThrough, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkerTransport, workerInfoSchema, directoryInspectionSchema, workerResultSchema } from '../src/protocol.ts'
import type { WorkerTransport } from '../src/protocol.ts'

const endpoints: WorkerTransport[] = []
const streams: (PassThrough | Writable)[] = []
afterEach(() => {
  for (const endpoint of endpoints.splice(0)) endpoint.close()
  for (const stream of streams.splice(0)) stream.destroy()
})

function endpoint(maxFrameBytes: number) {
  const input = new PassThrough()
  const output = new PassThrough()
  streams.push(input, output)
  const transport = createWorkerTransport(input, output, maxFrameBytes)
  endpoints.push(transport)
  const emitted: Buffer[] = []
  output.on('data', (bytes: Buffer) => emitted.push(bytes))
  transport.start()
  return { input, output, transport, emitted }
}

function requestLine(params: object): Buffer {
  return Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'inspectDirectory', params }))
}

describe('bounded worker transport', () => {
  it('requires start before writing and validates the configured frame bound', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    streams.push(input, output)
    for (const bound of [0, -1, 1.5, Infinity]) {
      expect(() => createWorkerTransport(input, output, bound)).toThrow('frame byte limit')
    }
    const transport = createWorkerTransport(input, output, 1024)
    endpoints.push(transport)
    await expect(transport.request('initialize', { protocolVersion: 1 })).rejects.toThrow('not started')
    await expect(transport.flush()).rejects.toThrow('not started')
    expect(input.listenerCount('data')).toBe(0)
  })
  it('accepts an exact UTF-8 frame bound across multibyte chunk boundaries', async () => {
    const line = requestLine({ path: '目录' })
    const e = endpoint(line.length)
    const seen = Promise.withResolvers<unknown>()
    e.transport.onRequest(async (_method, params) => { seen.resolve(params); return {} })
    const split = line.indexOf(Buffer.from('目')) + 1
    e.input.write(line.subarray(0, split))
    e.input.write(line.subarray(split))
    e.input.write('\n')
    expect(await seen.promise).toEqual({ path: '目录' })
    await e.transport.flush()
    expect(e.emitted[0]?.toString()).toContain('"result":{}')
  })

  it.each(['whole', 'split', 'unterminated'] as const)('closes oversized %s input before dispatch', async (mode) => {
    const e = endpoint(64)
    let dispatched = false
    e.transport.onRequest(async () => { dispatched = true })
    if (mode === 'whole') e.input.write('字'.repeat(22) + '\n')
    else {
      e.input.write('a'.repeat(64))
      e.input.write(mode === 'split' ? 'b\n' : 'b')
    }
    await e.transport.closed
    expect(dispatched).toBe(false)
    expect(e.input.listenerCount('data')).toBe(0)
  })

  it.each([
    '{', 'null', '[]', '{"jsonrpc":"1.0","id":"a","method":"x","params":{}}',
    '{"jsonrpc":"2.0","id":{},"method":"x","params":{}}',
    '{"jsonrpc":"2.0","id":"a","method":"x","params":[]}',
    '{"jsonrpc":"2.0","id":"a","method":"x","params":{},"extra":true}',
  ])('closes malformed JSON-RPC input: %s', async (line) => {
    const e = endpoint(1024)
    e.input.write(line + '\n')
    await e.transport.closed
  })

  it('refuses invalid UTF-8 and discards an unterminated final frame', async () => {
    const invalid = endpoint(1024)
    invalid.input.write(Buffer.from([0xff, 10]))
    await invalid.transport.closed
    const partial = endpoint(1024)
    let dispatched = false
    partial.transport.onRequest(async () => { dispatched = true })
    partial.input.end(requestLine({}))
    await partial.transport.closed
    expect(dispatched).toBe(false)
  })

  it('accepts an exact outbound byte cap and rejects one byte less', async () => {
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { text: '目录' } })
    const exact = endpoint(Buffer.byteLength(line))
    exact.transport.notify('event', { text: '目录' })
    expect(Buffer.concat(exact.emitted).toString()).toBe(line + '\n')
    const short = endpoint(Buffer.byteLength(line) - 1)
    expect(() => { short.transport.notify('event', { text: '目录' }) }).toThrow('byte limit')
    expect(short.emitted).toEqual([])
  })

  it.each([true, false])('contains output failures with early close=%s', async (earlyClose) => {
    const input = new PassThrough()
    let complete!: (error?: Error | null) => void
    const output = new Writable({ write(_chunk, _encoding, callback) { complete = callback } })
    streams.push(input, output)
    const transport = createWorkerTransport(input, output, 1024)
    endpoints.push(transport)
    transport.start()
    transport.notify('event')
    if (earlyClose) transport.close()
    complete(new Error('output failed'))
    await new Promise<void>(resolve => setImmediate(resolve))
    await transport.closed
    expect(input.listenerCount('data')).toBe(0)
    expect(output.listenerCount('error')).toBe(0)
  })

  it('bounds complete outbound frames and never emits an oversized response', async () => {
    const e = endpoint(100)
    expect(() => { e.transport.notify('event', { text: '字'.repeat(100) }) }).toThrow('byte limit')
    await expect(e.transport.request('x', { text: '字'.repeat(100) })).rejects.toThrow('byte limit')
    e.transport.onRequest(async () => '字'.repeat(100))
    e.input.write(Buffer.concat([requestLine({}), Buffer.from('\n')]))
    await e.transport.closed
    expect(e.emitted).toEqual([])
  })

  it('delivers concurrent request results and supports client abandonment', async () => {
    const left = new PassThrough()
    const right = new PassThrough()
    streams.push(left, right)
    const server = createWorkerTransport(left, right, 1024)
    const client = createWorkerTransport(right, left, 1024)
    endpoints.push(server, client)
    const hold = Promise.withResolvers<undefined>()
    server.onRequest(async (method, params) => {
      if (method === 'held') await hold.promise
      return params
    })
    server.start()
    client.start()
    expect(await client.request('echo', { path: '目录' })).toEqual({ path: '目录' })
    const controller = new AbortController()
    const abandoned = client.request('held', {}, controller.signal)
    controller.abort()
    await expect(abandoned).rejects.toThrow('aborted')
    hold.resolve(undefined)
    await expect(client.request('already', {}, controller.signal)).rejects.toThrow('aborted')
    const pending = client.request('echo', {})
    client.close()
    await expect(pending).rejects.toThrow('closed')
    await expect(client.request('closed', {})).rejects.toThrow('closed')
  })

  it('contains handler failures without disclosing their messages', async () => {
    const e = endpoint(1024)
    e.transport.onRequest(async () => { throw new Error('private credential') })
    e.input.write(Buffer.concat([requestLine({}), Buffer.from('\n')]))
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(Buffer.concat(e.emitted).toString()).toContain('Worker request failed')
    expect(Buffer.concat(e.emitted).toString()).not.toContain('credential')
  })

  it('flushes only after the output callback and releases stream listeners on disposal', async () => {
    const callbacks: (() => void)[] = []
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, callback) { callbacks.push(callback) } })
    streams.push(input, output)
    const transport = createWorkerTransport(input, output, 1024)
    endpoints.push(transport)
    transport.start()
    transport.notify('event')
    let flushed = false
    const flush = transport.flush().then(() => { flushed = true })
    expect(flushed).toBe(false)
    callbacks.shift()?.()
    callbacks.shift()?.()
    await flush
    transport.close()
    expect(input.listenerCount('data')).toBe(0)
    expect(output.listenerCount('drain')).toBe(0)
  })
})

describe('worker response schemas', () => {
  it('refuses incomplete or widened operation reports', () => {
    expect(workerInfoSchema.safeParse({ protocolVersion: 1, roots: [], capabilities: ['run-command'] }).success).toBe(false)
    expect(directoryInspectionSchema.safeParse({ entries: [], truncated: false }).success).toBe(false)
    expect(workerResultSchema(directoryInspectionSchema).safeParse({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid' } }).success).toBe(true)
    expect(workerResultSchema(directoryInspectionSchema).safeParse({ ok: true, value: {} }).success).toBe(false)
  })
})
