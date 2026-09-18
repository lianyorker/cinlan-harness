/** Bounded Host output for one sidebar terminal attachment, credited by renderer ACKs. */
import { Buffer } from 'node:buffer'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalAttachmentId, SidebarTerminalFrame } from '@deepseek-ai/dsh-sidebar-terminals/types'

type DataFrame = Extract<SidebarTerminalFrame, { type: 'data' }>
type ExitFrame = Extract<SidebarTerminalFrame, { type: 'exit' }>
type OutputFrame = DataFrame | ExitFrame
type State = { kind: 'open' } | { kind: 'finishing'; frame: ExitFrame }
  | { kind: 'closed' } | { kind: 'failed'; error: unknown }

interface OutputOptions {
  readonly attachmentId: SidebarTerminalAttachmentId
  readonly limits: { readonly frameBytes: number; readonly bufferBytes: number; readonly ackTimeoutMs: number }
  readonly onPressure: (blocked: boolean) => void
}

interface PendingFrame {
  frame: DataFrame
  bytes: number
}

/**
 * Measure the complete JSON frame, including escaped metadata and UTF-8 data.
 * @param frame - frame to send through the terminal carrier.
 * @returns serialized byte count for the configured frame limit.
 */
export function encodedFrameBytes(frame: SidebarTerminalFrame): number {
  return Buffer.byteLength(JSON.stringify(frame), 'utf8')
}

function highSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

function splitsPair(data: string, end: number): boolean {
  const next = data.charCodeAt(end)
  return highSurrogate(data.charCodeAt(end - 1)) && next >= 0xdc00 && next <= 0xdfff
}

/**
 * Private attachment output with one consumer and one unacknowledged data frame.
 * Pending and in-flight serialized frames share the byte budget, including a queued exit.
 * Pressure changes at half/quarter capacity; the provider owns aggregate PTY pause state.
 */
export class TerminalOutput {
  private state: State = { kind: 'open' }
  private readonly pending: PendingFrame[] = []
  private bufferedBytes = 0
  private nextSequence = 1
  private acknowledged = 0
  private inFlight: { sequence: number; bytes: number } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private blocked = false
  private claimed = false
  private wake: (() => void) | undefined
  private detachAbort: (() => void) | undefined

  /** @param options - attachment identity, validated required limits, and native pressure owner. */
  constructor(private readonly options: OutputOptions) {}

  /**
   * Queue native output, coalescing callbacks into bounded frames without splitting pairs.
   * Overflow and pressure-callback failures reject the stream instead of the native dispatcher.
   * @param data - native output; ignored after finish, failure, or disposal.
   */
  push(data: string): void {
    if (this.state.kind !== 'open' || !data) return
    if (data.length > this.options.limits.bufferBytes) {
      this.overflow()
      return
    }
    let offset = 0
    while (offset < data.length) {
      let tail = this.pending.at(-1)
      let end = tail ? this.fittingEnd(tail.frame, data, offset, tail.bytes) : offset
      if (!tail || end === offset) {
        const frame: DataFrame = { type: 'data', attachmentId: this.options.attachmentId, sequence: this.nextSequence, data: '' }
        end = this.fittingEnd(frame, data, offset, 0)
        if (end === offset) {
          this.overflow()
          return
        }
        tail = { frame, bytes: encodedFrameBytes(frame) }
        this.pending.push(tail)
        this.bufferedBytes += tail.bytes
        this.nextSequence++
      }
      tail.frame = { ...tail.frame, data: tail.frame.data + data.slice(offset, end) }
      const bytes = encodedFrameBytes(tail.frame)
      this.bufferedBytes += bytes - tail.bytes
      tail.bytes = bytes
      offset = end
    }
    this.updatePressure()
    this.notify()
  }

  /**
   * Queue a bounded exit after all data has been rendered and acknowledged.
   * @param exitCode - native process exit status; the first finish wins.
   */
  finish(exitCode: number): void {
    if (this.state.kind !== 'open') return
    const frame: ExitFrame = { type: 'exit', attachmentId: this.options.attachmentId, exitCode }
    const bytes = encodedFrameBytes(frame)
    if (bytes > this.options.limits.frameBytes || this.bufferedBytes + bytes > this.options.limits.bufferBytes) {
      this.overflow()
      return
    }
    this.bufferedBytes += bytes
    this.state = { kind: 'finishing', frame }
    this.updatePressure()
    this.notify()
  }

  /**
   * Release data credit only after the renderer completes xterm.write.
   * Old ACKs and ACKs after closure are inert; an unsent sequence throws invalid-request.
   * @param sequence - completed data-frame sequence.
   */
  ack(sequence: number): void {
    if (this.state.kind === 'closed' || this.state.kind === 'failed' || sequence <= this.acknowledged) return
    if (!this.inFlight || sequence !== this.inFlight.sequence) {
      throw new SidebarTerminalError('invalid-request', 'Terminal ACK sequence has not been sent.')
    }
    this.acknowledged = sequence
    this.bufferedBytes -= this.inFlight.bytes
    this.inFlight = undefined
    this.clearTimer()
    this.updatePressure()
    this.notify()
  }

  /**
   * Claim the attachment's sole consumer; a second claim throws invalid-request.
   * Abort, iterator return, and disposal end quietly and detach all owned resources.
   * @param signal - attachment lifetime, including cancellation before the first read.
   * @returns data frames requiring ACKs, followed by an exit, or a stream failure.
   */
  frames(signal: AbortSignal): AsyncIterable<OutputFrame> {
    if (this.claimed) throw new SidebarTerminalError('invalid-request', 'Terminal output already has a consumer.')
    this.claimed = true
    if (signal.aborted) {
      this.dispose()
    } else if (this.state.kind !== 'closed' && this.state.kind !== 'failed') {
      const abort = (): void => { this.dispose() }
      signal.addEventListener('abort', abort, { once: true })
      this.detachAbort = () => { signal.removeEventListener('abort', abort) }
    }
    let reading = false
    const iterator: AsyncIterableIterator<OutputFrame> = {
      [Symbol.asyncIterator]() { return this },
      next: () => {
        if (reading) return Promise.reject(new SidebarTerminalError('invalid-request', 'Terminal output read is already pending.'))
        reading = true
        return this.nextFrame().finally(() => { reading = false })
      },
      return: () => {
        this.dispose()
        return Promise.resolve({ done: true, value: undefined })
      },
    }
    return iterator
  }

  /** Drop output, clear the ACK deadline and abort listener, and relinquish pressure. */
  dispose(): void {
    this.stop({ kind: 'closed' })
  }

  private fittingEnd(frame: DataFrame, data: string, start: number, chargedBytes: number): number {
    const limit = Math.min(this.options.limits.frameBytes, this.options.limits.bufferBytes - this.bufferedBytes + chargedBytes)
    let low = start
    let high = Math.min(data.length, start + this.options.limits.frameBytes)
    if (splitsPair(data, high)) high--
    while (low < high) {
      let middle = Math.ceil((low + high) / 2)
      if (splitsPair(data, middle)) middle++
      const candidate = { ...frame, data: frame.data + data.slice(start, middle) }
      if (encodedFrameBytes(candidate) <= limit) {
        low = middle
      } else {
        high = middle - 1
        if (splitsPair(data, high)) high--
      }
    }
    return low
  }

  private async nextFrame(): Promise<IteratorResult<OutputFrame>> {
    for (;;) {
      if (this.state.kind === 'failed') {
        const { error } = this.state
        this.state = { kind: 'closed' }
        throw error
      }
      if (this.state.kind === 'closed') return { done: true, value: undefined }
      if (!this.inFlight) {
        const entry = this.pending[0]
        if (entry && !(this.state.kind === 'open' && this.pending.length === 1
          && highSurrogate(entry.frame.data.charCodeAt(entry.frame.data.length - 1)))) {
          this.pending.shift()
          this.inFlight = { sequence: entry.frame.sequence, bytes: entry.bytes }
          this.timer = setTimeout(() => {
            this.stop({ kind: 'failed', error: new SidebarTerminalError('ack-timeout', 'Terminal renderer did not acknowledge output in time.') })
          }, this.options.limits.ackTimeoutMs)
          return { done: false, value: entry.frame }
        }
        if (!entry && this.state.kind === 'finishing') {
          const { frame } = this.state
          this.stop({ kind: 'closed' })
          return { done: false, value: frame }
        }
      }
      await new Promise<void>((resolve) => { this.wake = resolve })
    }
  }

  private updatePressure(): void {
    if (!this.blocked && this.bufferedBytes >= this.options.limits.bufferBytes / 2) this.setPressure(true)
    else if (this.blocked && this.bufferedBytes <= this.options.limits.bufferBytes / 4) this.setPressure(false)
  }

  private setPressure(blocked: boolean): void {
    if (this.blocked === blocked) return
    this.blocked = blocked
    try {
      this.options.onPressure(blocked)
    } catch (error) {
      // A failing release cannot replace an already-settled stream outcome.
      this.stop({ kind: 'failed', error })
    }
  }

  private overflow(): void {
    this.stop({ kind: 'failed', error: new SidebarTerminalError('output-overflow', 'Terminal output exceeds the configured byte limits.') })
  }

  private stop(state: Extract<State, { kind: 'closed' | 'failed' }>): void {
    if (this.state.kind === 'closed' || this.state.kind === 'failed') return
    this.state = state
    this.pending.length = 0
    this.inFlight = undefined
    this.bufferedBytes = 0
    this.clearTimer()
    this.detachAbort?.()
    this.detachAbort = undefined
    this.setPressure(false)
    this.notify()
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }
}
