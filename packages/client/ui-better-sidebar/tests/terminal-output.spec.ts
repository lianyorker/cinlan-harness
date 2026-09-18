import { getEventListeners } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalAttachmentId, SidebarTerminalFrame, SidebarTerminalProcessId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { encodedFrameBytes, TerminalOutput } from '../src/terminal-output.ts'

type Options = ConstructorParameters<typeof TerminalOutput>[0]
type DataFrame = Extract<SidebarTerminalFrame, { type: 'data' }>
type OutputFrame = Exclude<SidebarTerminalFrame, { type: 'ready' }>
const attachmentId = 'attachment' as SidebarTerminalAttachmentId
const outputs = new Set<TerminalOutput>()

function wireBytes(frame: SidebarTerminalFrame): number {
  return new TextEncoder().encode(JSON.stringify(frame)).byteLength
}

function dataFrame(data: string, sequence = 1, id = attachmentId): DataFrame {
  return { type: 'data', attachmentId: id, sequence, data }
}

function createOutput(limits: Partial<Options['limits']> = {}, id = attachmentId) {
  const pressure = vi.fn<(blocked: boolean) => void>()
  const resolved = { frameBytes: 256, bufferBytes: 8192, ackTimeoutMs: 100, ...limits }
  const output = new TerminalOutput({ attachmentId: id, limits: resolved, onPressure: pressure })
  outputs.add(output)
  return { output, pressure, limits: resolved }
}

function open(output: TerminalOutput, signal = new AbortController().signal): AsyncIterator<OutputFrame> {
  return output.frames(signal)[Symbol.asyncIterator]()
}

async function readData(iterator: AsyncIterator<OutputFrame>): Promise<DataFrame> {
  const result = await iterator.next()
  expect(result.done).toBe(false)
  if (result.done || result.value.type !== 'data') throw new Error('Expected a terminal data frame.')
  return result.value
}

async function drain(output: TerminalOutput, iterator: AsyncIterator<OutputFrame>): Promise<OutputFrame[]> {
  const frames: OutputFrame[] = []
  for (;;) {
    const result = await iterator.next()
    if (result.done) return frames
    frames.push(result.value)
    if (result.value.type === 'data') output.ack(result.value.sequence)
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  for (const output of outputs) output.dispose()
  outputs.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('encodedFrameBytes', () => {
  it('measures complete ready, data, and exit JSON including escaped attachment metadata', () => {
    const id = 'quoted\"\\\n中😀' as SidebarTerminalAttachmentId
    const frames: SidebarTerminalFrame[] = [
      { type: 'ready', attachmentId: id, processId: '87654321-4321-4321-8321-cba987654321' as SidebarTerminalProcessId, pid: 123, cwd: 'C:\\工作\\\"', shellName: 'pwsh\n' },
      dataFrame('\0\b\t\n\f\r\"\\é中😀\ud800', 123, id),
      { type: 'exit', attachmentId: id, exitCode: -123 },
    ]
    for (const frame of frames) expect(encodedFrameBytes(frame)).toBe(wireBytes(frame))
    expect(encodedFrameBytes(frames[1]!)).toBeGreaterThan(JSON.stringify(frames[1]).length)
  })
})

describe('TerminalOutput byte limits', () => {
  it.each([0, 1, wireBytes(dataFrame(''))])('fails the stream when a %i-byte frame cannot hold one character', async (frameBytes) => {
    const { output, pressure } = createOutput({ frameBytes })
    const iterator = open(output)
    expect(() => output.push('a')).not.toThrow()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'SidebarTerminalError', code: 'output-overflow' })
    expect(pressure).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts an exact complete frame and retains its bytes until ACK', async () => {
    const expected = dataFrame('é😀\\\n\0')
    const bytes = wireBytes(expected)
    const { output, pressure } = createOutput({ frameBytes: bytes, bufferBytes: bytes })
    const iterator = open(output)
    output.push(expected.data)
    expect(pressure.mock.calls).toEqual([[true]])
    expect(await readData(iterator)).toEqual(expected)
    expect(pressure.mock.calls).toEqual([[true]])
    output.ack(1)
    expect(pressure.mock.calls).toEqual([[true], [false]])
    output.finish(0)
    expect(await drain(output, iterator)).toEqual([{ type: 'exit', attachmentId, exitCode: 0 }])
  })

  it.each(['frameBytes', 'bufferBytes'] as const)('rejects a surrogate pair one byte beyond %s without splitting it', async (limit) => {
    const bytes = wireBytes(dataFrame('😀'))
    const { output } = createOutput({ [limit]: bytes - 1 })
    const iterator = open(output)
    expect(() => output.push('😀')).not.toThrow()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
  })

  it('frames escaped and multibyte text losslessly across sequence digit changes', async () => {
    const id = 'long-\"\\\n中😀-attachment' as SidebarTerminalAttachmentId
    const text = '\"\0\\\n\b\t\f\r é中😀💩'.repeat(12)
    const frameBytes = wireBytes(dataFrame('', 1, id)) + 12
    const { output } = createOutput({ frameBytes }, id)
    const iterator = open(output)
    output.push(text)
    output.finish(-7)
    const frames = await drain(output, iterator)
    const data = frames.filter((frame): frame is DataFrame => frame.type === 'data')
    expect(data.length).toBeGreaterThan(10)
    expect(data.map(frame => frame.data).join('')).toBe(text)
    expect(data.map(frame => frame.sequence)).toEqual(data.map((_, index) => index + 1))
    for (const frame of frames) expect(wireBytes(frame)).toBeLessThanOrEqual(frameBytes)
    for (const frame of data) expect(frame.data.isWellFormed()).toBe(true)
    expect(frames.at(-1)).toEqual({ type: 'exit', attachmentId: id, exitCode: -7 })
  })

  it('preserves emoji in long chunks at odd and even tiny frame capacities', async () => {
    const text = '😀'.repeat(40)
    for (const payloadBytes of [5, 6, 7, 8, 9, 10]) {
      const frameBytes = wireBytes(dataFrame('')) + payloadBytes
      const { output } = createOutput({ frameBytes })
      const iterator = open(output)
      output.push(text)
      output.finish(0)
      const frames = await drain(output, iterator)
      const data = frames.filter((frame): frame is DataFrame => frame.type === 'data')
      expect(data.map(frame => frame.data).join('')).toBe(text)
      for (const frame of data) expect(frame.data.isWellFormed()).toBe(true)
      for (const frame of frames) expect(wireBytes(frame)).toBeLessThanOrEqual(frameBytes)
    }
  })

  it('joins a surrogate pair across native callbacks before emitting it', async () => {
    const { output } = createOutput()
    const iterator = open(output)
    output.push('A\ud83d')
    const delivered = vi.fn()
    const pending = iterator.next().then((result) => { delivered(result); return result })
    await vi.advanceTimersByTimeAsync(1000)
    expect(delivered).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    output.push('\ude00B')
    expect(await pending).toEqual({ done: false, value: dataFrame('A😀B') })
    output.ack(1)
  })

  it('preserves lone surrogates and flushes a trailing high surrogate on finish', async () => {
    const text = '\udfff:x\ud800'
    const { output, limits } = createOutput()
    const iterator = open(output)
    output.push(text)
    output.finish(3)
    const frames = await drain(output, iterator)
    expect(frames).toEqual([dataFrame(text), { type: 'exit', attachmentId, exitCode: 3 }])
    for (const frame of frames) expect(wireBytes(frame)).toBeLessThanOrEqual(limits.frameBytes)
  })

  it('rejects an oversized single native chunk without throwing or retaining pressure', async () => {
    const { output, pressure } = createOutput({ bufferBytes: 512 })
    const iterator = open(output)
    expect(() => output.push('x'.repeat(1024 * 1024))).not.toThrow()
    await expect(iterator.next()).rejects.toBeInstanceOf(SidebarTerminalError)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(pressure).not.toHaveBeenCalled()
  })

  it('reports native overflow before a consumer attaches without installing a listener', async () => {
    const { output } = createOutput({ frameBytes: 1 })
    output.push('a')
    const controller = new AbortController()
    const iterator = open(output, controller.signal)
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('counts every serialized frame header in the complete pending byte budget', async () => {
    const frameBytes = wireBytes(dataFrame('ab'))
    const { output } = createOutput({ frameBytes, bufferBytes: 2 * frameBytes - 1 })
    const iterator = open(output)
    expect(() => output.push('abcd')).not.toThrow()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
  })

  it('coalesces thousands of tiny native callbacks into bounded emitted frames', async () => {
    const { output, limits } = createOutput()
    const iterator = open(output)
    for (let i = 0; i < 4096; i++) { output.push(''); output.push('x') }
    output.finish(0)
    const frames = await drain(output, iterator)
    const data = frames.filter((frame): frame is DataFrame => frame.type === 'data')
    expect(data.map(frame => frame.data).join('')).toBe('x'.repeat(4096))
    expect(data.length).toBeLessThan(64)
    expect(frames.reduce((bytes, frame) => bytes + wireBytes(frame), 0)).toBeLessThanOrEqual(limits.bufferBytes)
    for (const frame of frames) expect(wireBytes(frame)).toBeLessThanOrEqual(limits.frameBytes)
  })
})

describe('TerminalOutput renderer credit', () => {
  it('pauses at half capacity and resumes at quarter capacity after rendering ACKs', async () => {
    const frameBytes = wireBytes(dataFrame('abcd'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes * 4 })
    const iterator = open(output)
    output.push('abcdefgh')
    expect(pressure.mock.calls).toEqual([[true]])
    const first = await readData(iterator)
    output.push('ijkl')
    expect(pressure.mock.calls).toEqual([[true]])
    output.ack(first.sequence)
    expect(pressure.mock.calls).toEqual([[true]])
    const second = await readData(iterator)
    output.ack(second.sequence)
    expect(pressure.mock.calls).toEqual([[true], [false]])
    const third = await readData(iterator)
    output.ack(third.sequence)
    expect([first.data, second.data, third.data]).toEqual(['abcd', 'efgh', 'ijkl'])
    output.push('mnopqrst')
    expect(pressure.mock.calls).toEqual([[true], [false], [true]])
    output.dispose()
    expect(pressure.mock.calls).toEqual([[true], [false], [true], [false]])
  })

  it('fails explicitly when callbacks after pause exceed pending plus in-flight bytes', async () => {
    const frameBytes = wireBytes(dataFrame('aa'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes * 2 })
    const iterator = open(output)
    output.push('aa')
    await readData(iterator)
    output.push('bb')
    expect(pressure.mock.calls).toEqual([[true]])
    const pending = iterator.next()
    expect(() => output.push('c')).not.toThrow()
    await expect(pending).rejects.toMatchObject({ code: 'output-overflow' })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(() => output.ack(1)).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('emits no second data frame or exit until xterm completion is acknowledged', async () => {
    const frameBytes = wireBytes(dataFrame('first'))
    const { output } = createOutput({ frameBytes })
    const iterator = open(output)
    output.push('firstlast')
    output.finish(9)
    output.finish(88)
    output.push('ignored')
    expect(await readData(iterator)).toEqual(dataFrame('first'))
    const delivered = vi.fn()
    const second = iterator.next().then((result) => { delivered(result); return result })
    await vi.advanceTimersByTimeAsync(99)
    expect(delivered).not.toHaveBeenCalled()
    output.ack(1)
    expect(await second).toEqual({ done: false, value: dataFrame('last', 2) })
    delivered.mockClear()
    const exit = iterator.next().then((result) => { delivered(result); return result })
    output.ack(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(delivered).not.toHaveBeenCalled()
    output.ack(2)
    expect(await exit).toEqual({ done: false, value: { type: 'exit', attachmentId, exitCode: 9 } })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects unsent ACKs without consuming credit and accepts duplicate old ACKs', async () => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output } = createOutput({ frameBytes })
    const iterator = open(output)
    expect(() => output.ack(1)).toThrowError(expect.objectContaining({ code: 'invalid-request' }))
    output.push('ab')
    expect(await readData(iterator)).toEqual(dataFrame('a'))
    expect(() => output.ack(2)).toThrowError(expect.objectContaining({ code: 'invalid-request' }))
    output.ack(1)
    output.ack(1)
    expect(await readData(iterator)).toEqual(dataFrame('b', 2))
    output.ack(1)
    output.ack(2)
    output.finish(0)
    expect((await drain(output, iterator)).at(-1)).toEqual({ type: 'exit', attachmentId, exitCode: 0 })
  })

  it.each([false, true])('times out missing ACKs even when the consumer waits for another frame: %s', async (waiting) => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output, pressure, limits } = createOutput({ frameBytes, bufferBytes: frameBytes * 2 })
    const controller = new AbortController()
    const iterator = open(output, controller.signal)
    output.push('a')
    await vi.advanceTimersByTimeAsync(limits.ackTimeoutMs * 2)
    expect(await readData(iterator)).toEqual(dataFrame('a'))
    const rejection = waiting ? expect(iterator.next()).rejects.toMatchObject({ code: 'ack-timeout' }) : undefined
    await vi.advanceTimersByTimeAsync(limits.ackTimeoutMs - 1)
    expect(pressure.mock.calls).toEqual([[true]])
    output.ack(0)
    await vi.advanceTimersByTimeAsync(1)
    if (rejection) await rejection
    else await expect(iterator.next()).rejects.toMatchObject({ code: 'ack-timeout' })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(vi.getTimerCount()).toBe(0)
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    output.ack(1)
    output.ack(99)
    output.push('late')
    output.finish(0)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(pressure.mock.calls).toEqual([[true], [false]])
  })
})

describe('TerminalOutput exit and teardown', () => {
  const exit: OutputFrame = { type: 'exit', attachmentId, exitCode: -123 }

  it('emits an exact bounded exit and releases its listener without another read', async () => {
    const bytes = wireBytes(exit)
    const { output, pressure } = createOutput({ frameBytes: bytes, bufferBytes: bytes })
    const controller = new AbortController()
    const iterator = open(output, controller.signal)
    output.finish(exit.exitCode)
    expect(await iterator.next()).toEqual({ done: false, value: exit })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    output.ack(99)
    controller.abort()
    output.push('late')
    output.finish(0)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(pressure.mock.calls).toEqual([[true], [false]])
  })

  it.each(['frameBytes', 'bufferBytes'] as const)('fails when the exit exceeds %s by one byte', async (limit) => {
    const { output } = createOutput({ [limit]: wireBytes(exit) - 1 })
    const iterator = open(output)
    expect(() => output.finish(exit.exitCode)).not.toThrow()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
  })

  it('includes the queued exit in the combined retained-byte limit', async () => {
    const { output, pressure } = createOutput({ bufferBytes: wireBytes(dataFrame('a')) + wireBytes(exit) - 1 })
    const iterator = open(output)
    output.push('a')
    await readData(iterator)
    output.finish(exit.exitCode)
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['abort', 'dispose', 'return'] as const)('%s settles blocked reads, clears deadlines, and makes late callbacks inert', async (action) => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes * 2 })
    const controller = new AbortController()
    const iterator = open(output, controller.signal)
    output.push('ab')
    await readData(iterator)
    const pending = iterator.next()
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(1)
    if (action === 'abort') controller.abort()
    else if (action === 'dispose') output.dispose()
    else await iterator.return!()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
    expect(pressure.mock.calls).toEqual([[true], [false]])
    output.dispose()
    controller.abort()
    output.push('late')
    output.finish(0)
    output.ack(1)
    output.ack(999)
    await vi.runAllTimersAsync()
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(pressure.mock.calls).toEqual([[true], [false]])
  })

  it.each(['pre-aborted', 'disposed'] as const)('ends %s output before the first read without installing a listener', async (action) => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes })
    const controller = new AbortController()
    output.push('a')
    if (action === 'pre-aborted') controller.abort()
    else output.dispose()
    const iterator = open(output, controller.signal)
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles an empty waiting consumer without inventing a pressure transition', async () => {
    const { output, pressure } = createOutput()
    const iterator = open(output)
    const pending = iterator.next()
    output.dispose()
    await expect(pending).resolves.toEqual({ done: true, value: undefined })
    expect(pressure).not.toHaveBeenCalled()
  })

  it('rejects another consumer and overlapping reads without disturbing the first read', async () => {
    const { output } = createOutput()
    const iterator = open(output)
    const first = iterator.next()
    expect(() => open(output)).toThrowError(expect.objectContaining({ code: 'invalid-request' }))
    await expect(iterator.next()).rejects.toMatchObject({ code: 'invalid-request' })
    output.push('a')
    expect(await first).toEqual({ done: false, value: dataFrame('a') })
    output.ack(1)
  })

  it('contains pressure callback failures and preserves the first stream error', async () => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes })
    const iterator = open(output)
    const failure = new Error('native pause failed')
    pressure.mockImplementation(() => { throw failure })
    expect(() => output.push('a')).not.toThrow()
    await expect(iterator.next()).rejects.toBe(failure)
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves overflow when releasing native pressure also fails', async () => {
    const frameBytes = wireBytes(dataFrame('a'))
    const { output, pressure } = createOutput({ frameBytes, bufferBytes: frameBytes })
    const iterator = open(output)
    output.push('a')
    await readData(iterator)
    pressure.mockImplementation(() => { throw new Error('native resume failed') })
    expect(() => output.push('b')).not.toThrow()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'output-overflow' })
    expect(pressure.mock.calls).toEqual([[true], [false]])
    expect(vi.getTimerCount()).toBe(0)
  })
})
