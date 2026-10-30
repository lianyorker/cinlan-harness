/** Line transport edge coverage: backpressure, notifications, error frames, lifecycle guards. */
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createWorkerTransport } from '../src/transport.ts'

function frame(value: object): string {
  return JSON.stringify(value) + '\n'
}

function collect(output: PassThrough): string[] {
  const frames: string[] = []
  output.on('data', (chunk: Buffer) => { frames.push(chunk.toString('utf8')) })
  return frames
}

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

describe('worker transport edge cases', () => {
  it('pauses input while output reports backpressure and resumes on drain', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    collect(output)
    vi.spyOn(output, 'write').mockReturnValue(false)
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    transport.notify('pressure', {})
    expect(input.isPaused()).toBe(true)
    output.emit('drain')
    expect(input.isPaused()).toBe(false)
    transport.close()
  })

  it('rejects request frames with -32601 while no request handler is installed', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const frames = collect(output)
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    input.write(frame({ jsonrpc: '2.0', id: 7, method: 'unhandled', params: {} }))
    await flushMicrotasks()
    const response = JSON.parse(frames.join('').trim()) as { id: number; error: { code: number } }
    expect(response).toMatchObject({ id: 7, error: { code: -32601 } })
    transport.close()
  })

  it('forwards notifications and closes the endpoint when the handler throws', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createWorkerTransport(input, output, 262144)
    const seen: unknown[] = []
    transport.onNotification((method, params) => { seen.push([method, params]) })
    transport.start()
    input.write(frame({ jsonrpc: '2.0', method: 'ping' }))
    input.write(frame({ jsonrpc: '2.0', method: 'pong', params: { a: 1 } }))
    await flushMicrotasks()
    expect(seen).toEqual([['ping', {}], ['pong', { a: 1 }]])
    transport.onNotification(() => { throw new Error('notification failure') })
    input.write(frame({ jsonrpc: '2.0', method: 'die', params: {} }))
    await transport.closed
  })

  it('rejects the pending request when the peer returns an error frame', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const frames = collect(output)
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    const pending = transport.request('remote', {})
    await flushMicrotasks()
    const sent = JSON.parse(frames.join('').trim()) as { id: string | number }
    input.write(frame({ jsonrpc: '2.0', id: sent.id, error: { code: -1, message: 'remote refused' } }))
    await expect(pending).rejects.toThrow('Worker JSON-RPC request failed')
    transport.close()
  })

  it('accepts string chunks and skips blank lines', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    const pending = transport.request('remote', {})
    await flushMicrotasks()
    input.emit('data', '\n')
    await flushMicrotasks()
    input.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 'unmatched', result: {} }) + '\n')
    input.emit('data', JSON.stringify({ jsonrpc: '2.0', id: 'again', result: { ok: 1 } }) + '\n')
    await flushMicrotasks()
    expect(pending).not.toBeUndefined()
    transport.close()
    await expect(pending).rejects.toThrow('Worker transport closed')
  })

  it('rejects a request when the output throws a non-Error value', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    vi.spyOn(output, 'write').mockImplementation(() => { throw 'opaque sink failure' as never })
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    await expect(transport.request('remote', {})).rejects.toThrow('Worker output failed')
    transport.close()
  })

  it('ignores repeated starts and starts into closure on a destroyed input', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    transport.start()
    input.destroy()
    await transport.closed
    const destroyed = new PassThrough()
    destroyed.destroy()
    const late = createWorkerTransport(destroyed, new PassThrough(), 262144)
    late.start()
    await late.closed
    const post = createWorkerTransport(new PassThrough(), new PassThrough(), 262144)
    post.start()
    post.close()
    post.start()
    await post.closed
  })

  it('rejects flush before start and after close', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const transport = createWorkerTransport(input, output, 262144)
    await expect(transport.flush()).rejects.toThrow('not started')
    transport.start()
    transport.close()
    await expect(transport.flush()).rejects.toThrow('closed')
  })

  it('rejects flush when the output write callback reports a failure', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    vi.spyOn(output, 'write').mockImplementation(((_chunk: unknown, encoding: unknown, callback?: unknown) => {
      const done = typeof encoding === 'function' ? encoding : callback
      if (typeof done === 'function') queueMicrotask(() => { (done as (error?: Error | null) => void)(new Error('sink write failed')) })
      return true
    }) as typeof output.write)
    const transport = createWorkerTransport(input, output, 262144)
    transport.start()
    await expect(transport.flush()).rejects.toThrow('sink write failed')
    transport.close()
  })
})
