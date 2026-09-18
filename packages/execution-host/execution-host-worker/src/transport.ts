/** Strict JSON-RPC framing; malformed, oversized, and invalid UTF-8 input closes the endpoint. */

import { randomUUID } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import { z } from 'zod'

const idSchema = z.union([z.string().min(1).max(128), z.number().int()])
const paramsSchema = z.record(z.string(), z.unknown())
const frameSchema = z.union([
  z.strictObject({ jsonrpc: z.literal('2.0'), id: idSchema, method: z.string().min(1), params: paramsSchema }),
  z.strictObject({ jsonrpc: z.literal('2.0'), method: z.string().min(1), params: paramsSchema.optional() }),
  z.strictObject({ jsonrpc: z.literal('2.0'), id: idSchema, result: z.unknown() }),
  z.strictObject({
    jsonrpc: z.literal('2.0'), id: idSchema,
    error: z.strictObject({ code: z.number().int(), message: z.string(), data: z.unknown().optional() }),
  }),
])
type Frame = z.infer<typeof frameSchema>
type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>
type NotificationHandler = (method: string, params: Record<string, unknown>) => void
interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void }

/**
 * JSON-RPC endpoint with the line transport API. Streams remain caller-owned.
 * All retained partial lines and emitted lines obey the configured UTF-8 byte cap.
 */
export interface WorkerTransport {
  /** Resolves after input detaches and pending requests reject; queued writes retain their error guard until settlement. */
  readonly closed: Promise<void>
  /** Start accepting input. Repeated calls have no effect. */
  start(): void
  /** Detach listeners and reject pending requests without destroying streams. */
  close(): void
  /**
   * Install the request handler. Failures become sanitized JSON-RPC errors.
   * @param handler - Handler returning one complete result.
   */
  onRequest(handler: RequestHandler): void
  /**
   * Install the notification handler. A thrown callback closes the endpoint.
   * @param handler - Notification callback.
   */
  onNotification(handler: NotificationHandler): void
  /**
   * Send a request. Aborting abandons its response, without cancelling remote work.
   * @param method - Protocol method.
   * @param params - Parameters object.
   * @param signal - Optional local abandonment signal.
   * @returns The untrusted result; rejects on error, closure, or a frame exceeding the cap.
   */
  request(method: string, params: object, signal?: AbortSignal): Promise<unknown>
  /**
   * Send a notification; throws on closure or a frame exceeding the cap.
   * @param method - Notification method.
   * @param params - Optional parameters object.
   */
  notify(method: string, params?: object): void
  /** @returns Settlement of prior output write callbacks; rejects on output failure. */
  flush(): Promise<void>
}

/**
 * Create a strict JSON-RPC endpoint; no bytes flow before start().
 * @param input - Caller-owned readable byte stream.
 * @param output - Caller-owned writable byte stream.
 * @param maxFrameBytes - Positive safe integer cap, excluding the newline delimiter.
 * @returns A transport with explicit start, close, and output flush lifetime.
 */
export function createWorkerTransport(input: Readable, output: Writable, maxFrameBytes: number): WorkerTransport {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) throw new Error('Invalid worker frame byte limit')
  let started = false
  let ended = false
  let partial = Buffer.alloc(0)
  let requestHandler: RequestHandler | undefined
  let notificationHandler: NotificationHandler | undefined
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  const pending = new Map<string | number, Pending>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pendingWrites = 0
  let writeFailurePending = false
  const detachOutput = (): void => {
    output.off('error', onOutputError)
    output.off('close', onOutputClose)
  }
  const onOutputError = (): void => { close(); detachOutput() }
  const onOutputClose = (): void => { close(); detachOutput() }
  const wrote = (error?: Error | null): void => {
    pendingWrites--
    if (error) writeFailurePending = true
    if (ended && pendingWrites === 0 && !writeFailurePending) detachOutput()
  }

  const close = (): void => {
    if (ended) return
    ended = true
    input.off('data', onData)
    input.pause()
    input.off('end', close)
    input.off('close', close)
    input.off('error', close)
    if (pendingWrites === 0 && !writeFailurePending) detachOutput()
    output.off('drain', resume)
    partial = Buffer.alloc(0)
    for (const item of pending.values()) item.reject(new Error('Worker transport closed'))
    pending.clear()
    resolveClosed()
  }
  const resume = (): void => { if (!ended) input.resume() }
  const write = (message: object): void => {
    if (ended) throw new Error('Worker transport closed')
    if (!started) throw new Error('Worker transport is not started')
    const line = JSON.stringify(message)
    if (Buffer.byteLength(line, 'utf8') > maxFrameBytes) throw new Error('Worker frame exceeds byte limit')
    pendingWrites++
    if (!output.write(line + '\n', wrote)) input.pause()
  }
  const respond = async (frame: Extract<Frame, { method: string; id: string | number }>): Promise<void> => {
    let message: object
    try {
      message = requestHandler
        ? { jsonrpc: '2.0', id: frame.id, result: await requestHandler(frame.method, frame.params) }
        : { jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unsupported worker method' } }
    } catch {
      // Request-handler failures never expose provider details to the remote peer.
      message = { jsonrpc: '2.0', id: frame.id, error: { code: -32603, message: 'Worker request failed' } }
    }
    if (ended) return
    try { write(message) } catch { close() }
  }
  const receive = (bytes: Buffer): void => {
    let value: unknown
    try { value = JSON.parse(decoder.decode(bytes)) } catch { close(); return }
    const parsed = frameSchema.safeParse(value)
    if (!parsed.success) { close(); return }
    const frame = parsed.data
    if ('method' in frame) {
      if ('id' in frame) void respond(frame)
      else {
        try { notificationHandler?.(frame.method, frame.params ?? {}) } catch { close() }
      }
      return
    }
    const item = pending.get(frame.id)
    if (!item) return
    pending.delete(frame.id)
    if ('error' in frame) item.reject(new Error('Worker JSON-RPC request failed'))
    else item.resolve(frame.result)
  }
  const onData = (chunk: Buffer | string): void => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    let offset = 0
    while (offset < bytes.length && !ended) {
      const newline = bytes.indexOf(10, offset)
      const end = newline < 0 ? bytes.length : newline
      const length = end - offset
      if (partial.length + length > maxFrameBytes) { close(); return }
      const line = Buffer.concat([partial, bytes.subarray(offset, end)])
      partial = newline < 0 ? line : Buffer.alloc(0)
      if (newline < 0) return
      if (line.length) receive(line)
      offset = newline + 1
    }
  }

  return {
    closed,
    start() {
      if (started || ended) return
      started = true
      input.on('data', onData)
      input.on('end', close)
      input.on('close', close)
      input.on('error', close)
      output.on('error', onOutputError)
      output.on('close', onOutputClose)
      output.on('drain', resume)
      if (input.readableEnded || input.destroyed || output.destroyed) close()
    },
    close,
    onRequest(handler) { requestHandler = handler },
    onNotification(handler) { notificationHandler = handler },
    request(method, params, signal) {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('Worker request aborted')); return }
        const onAbort = (): void => { pending.delete(id); reject(new Error('Worker request aborted')) }
        signal?.addEventListener('abort', onAbort, { once: true })
        const detach = (): void => { signal?.removeEventListener('abort', onAbort) }
        pending.set(id, {
          resolve(value) { detach(); resolve(value) },
          reject(error) { detach(); reject(error) },
        })
        try { write({ jsonrpc: '2.0', id, method, params }) } catch (error) {
          pending.delete(id)
          detach()
          reject(error instanceof Error ? error : new Error('Worker output failed'))
        }
      })
    },
    notify(method, params) { write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }) },
    flush() {
      return new Promise<void>((resolve, reject) => {
        if (ended) { reject(new Error('Worker transport closed')); return }
        if (!started) { reject(new Error('Worker transport is not started')); return }
        pendingWrites++
        output.write('', (error) => { wrote(error); if (error) reject(error); else resolve() })
      })
    },
  }
}
