/** Terminal protocol races exercised through the real Gateway RemoteStream supervisor. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-sidebar-terminal-controller/types'
import type { ConnectionGeneration, ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SidebarAgentTerminalId, SidebarAgentTerminalSnapshot, SidebarTerminalAttachmentId,
  SidebarTerminalCapability, SidebarTerminalFrame, SidebarTerminalOpenRequest,
  SidebarTerminalProcessId, SidebarTerminalSessionId, SidebarTerminalTabId,
} from '@deepseek-ai/dsh-sidebar-terminals/types'
import { createTerminalTransport } from '../src/client/terminal-client.ts'
import type { TerminalCallbacks } from '../src/types.ts'

type TerminalRemote = Parameters<typeof createTerminalTransport>[0]
type AgentList = readonly SidebarAgentTerminalSnapshot[]
const sessionId = 'session' as SidebarTerminalSessionId
const uuid = '00000000-0000-4000-8000-000000000001' as SidebarAgentTerminalId
const attachmentId = 'attachment-1' as SidebarTerminalAttachmentId
const processId = '00000000-0000-4000-8000-000000000002' as SidebarTerminalProcessId
const nextProcessId = '00000000-0000-4000-8000-000000000003' as SidebarTerminalProcessId
const tabId = 'terminal:1' as SidebarTerminalTabId
const request: SidebarTerminalOpenRequest = {
  target: { kind: 'ui', sessionId, tabId }, cols: 80, rows: 24,
}
const capability: SidebarTerminalCapability = { status: 'available', shellName: 'pwsh' }
const ready = (id = attachmentId, nativeProcessId = processId): SidebarTerminalFrame => ({
  type: 'ready', attachmentId: id, processId: nativeProcessId, pid: 42, cwd: '/workspace', shellName: 'pwsh',
})
const data = (sequence = 1, id = attachmentId): SidebarTerminalFrame => ({
  type: 'data', attachmentId: id, sequence, data: 'output',
})
const ok = <T>(value: T): RemoteResult<T> => ({ ok: true, value })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Entry<T> = { type: 'value'; value: T } | { type: 'error'; error: unknown } | { type: 'end' }

class ExternalFeed<T> {
  signal: AbortSignal | undefined
  readonly closed = deferred<undefined>()
  closing: Promise<void> = Promise.resolve(undefined)
  private readonly queue: Entry<T>[] = []
  private changed = deferred<undefined>()

  push(value: T): void { this.queue.push({ type: 'value', value }); this.changed.resolve(undefined) }
  fail(error: unknown): void { this.queue.push({ type: 'error', error }); this.changed.resolve(undefined) }
  end(): void { this.queue.push({ type: 'end' }); this.changed.resolve(undefined) }

  async *open(signal: AbortSignal): AsyncIterable<T> {
    this.signal = signal
    const aborted = (): void => { this.changed.resolve(undefined) }
    signal.addEventListener('abort', aborted, { once: true })
    try {
      while (true) {
        signal.throwIfAborted()
        const next = this.queue.shift()
        if (next === undefined) {
          await this.changed.promise
          this.changed = deferred<undefined>()
          continue
        }
        if (next.type === 'end') return
        if (next.type === 'error') throw next.error
        yield next.value
      }
    } finally {
      signal.removeEventListener('abort', aborted)
      await this.closing
      this.closed.resolve(undefined)
    }
  }
}

function connectionFixture() {
  let current: ConnectionGeneration | undefined = { id: 1, host: { home: '/home' } }
  const listeners = new Set<() => void>()
  const connection: Pick<ConnectionHandle, 'generation'> = {
    generation: {
      getSnapshot: () => current,
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
  return {
    connection, listeners,
    set(id: number | undefined) {
      current = id === undefined ? undefined : { id, host: { home: '/home' } }
      for (const listener of [...listeners]) listener()
    },
  }
}

const owners = new Set<TerminalCallbacks>()
afterEach(async () => {
  await Promise.allSettled([...owners].map(owner => owner.dispose()))
  owners.clear()
})

function fixture() {
  const connection = connectionFixture()
  const terminals: ExternalFeed<SidebarTerminalFrame>[] = []
  const watches: ExternalFeed<AgentList>[] = []
  const remote = {
    capability: vi.fn<TerminalRemote['capability']>(async () => ok(capability)),
    shells: vi.fn<TerminalRemote['shells']>(async () => ok([{ path: '/bin/bash', name: 'bash' }])),
    input: vi.fn<TerminalRemote['input']>(async () => ok(undefined)),
    resize: vi.fn<TerminalRemote['resize']>(async () => ok(undefined)),
    ack: vi.fn<TerminalRemote['ack']>(async () => ok(undefined)),
    release: vi.fn<TerminalRemote['release']>(async () => ok(undefined)),
    closeAgent: vi.fn<TerminalRemote['closeAgent']>(async () => ok(undefined)),
    closeUi: vi.fn<TerminalRemote['closeUi']>(async () => ok(undefined)),
    inspectUi: vi.fn<TerminalRemote['inspectUi']>(async () => ok(null)),
    open: vi.fn<TerminalRemote['open']>((_request, signal) => {
      const feed = new ExternalFeed<SidebarTerminalFrame>()
      terminals.push(feed)
      if (signal === undefined) throw new Error('Expected a supervised cancellation signal')
      return feed.open(signal)
    }),
    watch: vi.fn<TerminalRemote['watch']>((_sessionId, signal) => {
      const feed = new ExternalFeed<AgentList>()
      watches.push(feed)
      if (signal === undefined) throw new Error('Expected a supervised cancellation signal')
      return feed.open(signal)
    }),
  }
  const transport = createTerminalTransport(remote, connection.connection)
  owners.add(transport)
  const frames = vi.fn<(frame: SidebarTerminalFrame) => Promise<void>>(async () => {})
  const errors = vi.fn<(error: unknown) => void>()
  const connect = () => transport.connectTerminal(request, frames, errors)
  return { transport, remote, terminals, watches, connection, frames, errors, connect }
}

async function accepted(f: ReturnType<typeof fixture>, feed = f.terminals.at(0)!) {
  feed.push(ready())
  await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledWith({ attachmentId, sequence: 0 }) })
}

describe('terminal Remote transport', () => {
  it('acknowledges ready after reset and output only after the write callback resolves', async () => {
    const f = fixture()
    const reset = deferred<undefined>()
    const written = deferred<undefined>()
    const sawReady = deferred<undefined>()
    const sawData = deferred<undefined>()
    f.frames.mockImplementation((frame) => {
      if (frame.type === 'ready') { sawReady.resolve(undefined); return reset.promise }
      sawData.resolve(undefined)
      return written.promise
    })
    const close = f.connect()
    f.terminals.at(0)!.push(ready())
    f.terminals.at(0)!.push(data())
    await sawReady.promise
    expect(f.remote.ack).not.toHaveBeenCalled()
    reset.resolve(undefined)
    await sawData.promise
    expect(f.remote.ack.mock.calls).toEqual([[{ attachmentId, sequence: 0 }]])
    written.resolve(undefined)
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledWith({ attachmentId, sequence: 1 }) })
    await close('disconnect')
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('cancels an opening stream and suppresses queued ready after unmount', async () => {
    const f = fixture()
    const close = f.connect()
    f.terminals.at(0)!.push(ready())
    await close('close')
    expect(f.terminals.at(0)!.signal?.aborted).toBe(true)
    expect(f.frames).not.toHaveBeenCalled()
    expect(f.remote.release).not.toHaveBeenCalled()
    expect(f.remote.ack).not.toHaveBeenCalled()
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('aborts promptly even when the external opening resolves a late ready', async () => {
    const f = fixture()
    const opening = deferred<undefined>()
    const returned = deferred<undefined>()
    let signal: AbortSignal | undefined
    f.remote.open.mockImplementation(async function* (_request, abort) {
      signal = abort
      try { await opening.promise; yield ready() } finally { returned.resolve(undefined) }
    })
    const close = f.connect()
    const closing = close('park')
    await vi.waitFor(() => { expect(signal?.aborted).toBe(true) })
    opening.resolve(undefined)
    await closing
    await returned.promise
    expect(f.frames).not.toHaveBeenCalled()
    expect(f.errors).not.toHaveBeenCalled()
    expect(f.remote.ack).not.toHaveBeenCalled()
    expect(f.remote.release).not.toHaveBeenCalled()
  })

  it('sends park before abort and awaits release even if the ready sink is still pending', async () => {
    const f = fixture()
    const reset = deferred<undefined>()
    const entered = deferred<undefined>()
    const released = deferred<RemoteResult<void>>()
    f.frames.mockImplementation(() => { entered.resolve(undefined); return reset.promise })
    f.remote.release.mockReturnValue(released.promise)
    const close = f.connect()
    f.terminals.at(0)!.push(ready())
    await entered.promise
    const closing = close('park')
    expect(close('close')).toBe(closing)
    await vi.waitFor(() => { expect(f.remote.release).toHaveBeenCalledWith({ attachmentId, mode: 'park' }) })
    expect(f.terminals.at(0)!.signal?.aborted).toBe(false)
    const disposing = f.transport.dispose()
    released.resolve(ok(undefined))
    await closing
    await disposing
    expect(f.terminals.at(0)!.signal?.aborted).toBe(true)
    reset.resolve(undefined)
    expect(f.remote.ack).not.toHaveBeenCalled()
    expect(f.frames).toHaveBeenCalledTimes(1)
    expect(f.remote.release).toHaveBeenCalledTimes(1)
  })

  it('suppresses new frames and a completed sink while park is awaiting its Remote answer', async () => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    const released = deferred<RemoteResult<void>>()
    f.remote.release.mockReturnValue(released.promise)
    const closing = close('park')
    f.terminals.at(0)!.push(data())
    await new Promise(resolve => setImmediate(resolve))
    expect(f.frames).toHaveBeenCalledTimes(1)
    expect(f.terminals.at(0)!.signal?.aborted).toBe(false)
    released.resolve(ok(undefined))
    await closing

    const g = fixture()
    const painted = deferred<undefined>()
    const entered = deferred<undefined>()
    const releaseAnswer = deferred<RemoteResult<void>>()
    g.frames.mockImplementation(() => { entered.resolve(undefined); return painted.promise })
    g.remote.release.mockReturnValue(releaseAnswer.promise)
    const closeReady = g.connect()
    g.terminals.at(0)!.push(ready())
    await entered.promise
    const stopping = closeReady('park')
    painted.resolve(undefined)
    await new Promise(resolve => setImmediate(resolve))
    expect(g.terminals.at(0)!.signal?.aborted).toBe(false)
    expect(g.remote.ack).not.toHaveBeenCalled()
    releaseAnswer.resolve(ok(undefined))
    await stopping
  })

  it('never reopens a stream ended by release while its unary answer is delayed', async () => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    const released = deferred<RemoteResult<void>>()
    f.remote.release.mockImplementation(() => {
      f.terminals.at(0)!.end()
      return released.promise
    })
    const stopping = close('park')
    await f.terminals.at(0)!.closed.promise
    await new Promise(resolve => setImmediate(resolve))
    expect(f.remote.open).toHaveBeenCalledTimes(1)
    expect(f.errors).not.toHaveBeenCalled()
    released.resolve(ok(undefined))
    await stopping
  })

  it('does not acknowledge a delayed write completed after close', async () => {
    const f = fixture()
    const written = deferred<undefined>()
    const entered = deferred<undefined>()
    const close = f.connect()
    await accepted(f)
    f.frames.mockImplementation(() => { entered.resolve(undefined); return written.promise })
    f.terminals.at(0)!.push(data())
    await entered.promise
    await close('disconnect')
    written.resolve(undefined)
    await f.transport.dispose()
    expect(f.remote.ack.mock.calls).toEqual([[{ attachmentId, sequence: 0 }]])
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('reopens carrier loss only after Connection is ready and accepts a replacement ready', async () => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    f.connection.set(undefined)
    f.terminals.at(0)!.fail(new RemoteStreamCarrierError('offline'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    expect(f.remote.open).toHaveBeenCalledTimes(1)
    f.connection.set(2)
    await vi.waitFor(() => { expect(f.remote.open).toHaveBeenCalledTimes(2) })
    const replacement = 'attachment-2' as SidebarTerminalAttachmentId
    f.terminals.at(1)!.push(ready(replacement))
    f.terminals.at(1)!.push(data(1, replacement))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledWith({ attachmentId: replacement, sequence: 1 }) })
    expect(f.frames.mock.calls.map(([frame]) => frame.type)).toEqual(['ready', 'ready', 'data'])
    expect(f.connection.listeners.size).toBe(0)
    expect(f.errors).not.toHaveBeenCalled()
    await close('close')
    expect(f.remote.release).toHaveBeenCalledWith({ attachmentId: replacement, mode: 'close' })
  })

  it('closes a reconnect wait without reopening after Connection recovers', async () => {
    const f = fixture()
    const close = f.connect()
    f.connection.set(undefined)
    f.terminals.at(0)!.fail(new RemoteStreamCarrierError('offline opening'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    await close('disconnect')
    f.connection.set(2)
    await f.transport.dispose()
    expect(f.connection.listeners.size).toBe(0)
    expect(f.remote.open).toHaveBeenCalledTimes(1)
    expect(f.errors).not.toHaveBeenCalled()
  })

  it('does not retry permanent Remote failures when Connection changes', async () => {
    const f = fixture()
    f.connect()
    const error = new RemoteError('sidebarTerminals/invalid-directory', 'directory is unavailable', {})
    f.terminals.at(0)!.fail(error)
    await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledWith(error) })
    f.connection.set(undefined)
    f.connection.set(2)
    await f.transport.dispose()
    expect(f.remote.open).toHaveBeenCalledTimes(1)
  })

  it('ends quietly after an exit frame without reconnecting', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    const exit: SidebarTerminalFrame = { type: 'exit', attachmentId, exitCode: 7 }
    f.terminals.at(0)!.push(exit)
    await f.terminals.at(0)!.closed.promise
    await f.transport.dispose()
    expect(f.frames).toHaveBeenLastCalledWith(exit)
    expect(f.remote.open).toHaveBeenCalledTimes(1)
    expect(f.errors).not.toHaveBeenCalled()
    expect(f.remote.release).not.toHaveBeenCalled()
  })

  it('retries an unexpected accepted end but rejects an end before ready', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    f.terminals.at(0)!.end()
    await vi.waitFor(() => { expect(f.remote.open).toHaveBeenCalledTimes(2) })
    f.terminals.at(1)!.end()
    await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledOnce() })
    expect(f.errors.mock.calls.at(0)![0]).toMatchObject({ message: 'Sidebar terminal ended before ready' })
  })

  it.each(['before ready', 'duplicate ready', 'wrong attachment'] as const)('rejects %s protocol violations', async (kind) => {
    const f = fixture()
    f.connect()
    if (kind !== 'before ready') await accepted(f)
    f.terminals.at(0)!.push(kind === 'duplicate ready' ? ready() : data(1,
      kind === 'wrong attachment' ? 'wrong' as SidebarTerminalAttachmentId : attachmentId))
    await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledOnce() })
    await f.transport.dispose()
    expect(f.remote.open).toHaveBeenCalledTimes(1)
  })

  it('surfaces sink and ACK failures and contains exceptions in the error callback', async () => {
    const f = fixture()
    const error = new Error('xterm reset failed')
    f.frames.mockRejectedValue(error)
    f.errors.mockImplementation(() => { throw new Error('error sink failed') })
    f.connect()
    f.terminals.at(0)!.push(ready())
    await f.terminals.at(0)!.closed.promise
    await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledWith(error) })
    expect(f.remote.ack).not.toHaveBeenCalled()

    const g = fixture()
    const ackError = new RemoteError('sidebarTerminals/stale-attachment', 'attachment gone', {})
    g.remote.ack.mockResolvedValue({ ok: false, error: ackError })
    g.connect()
    g.terminals.at(0)!.push(ready())
    await vi.waitFor(() => { expect(g.errors).toHaveBeenCalledWith(ackError) })
    expect(g.remote.open).toHaveBeenCalledTimes(1)
  })

  it('returns unary values and rejects input, resize, capability, and agent-close errors', async () => {
    const f = fixture()
    await expect(f.transport.terminalCapability()).resolves.toEqual(capability)
    await expect(f.transport.terminalShells()).resolves.toEqual([{ path: '/bin/bash', name: 'bash' }])
    await f.transport.terminalInput(attachmentId, 'input')
    await f.transport.terminalResize(attachmentId, 120, 40)
    await f.transport.terminalCloseAgent(uuid)
    expect(f.remote.input).toHaveBeenCalledWith({ attachmentId, data: 'input' })
    expect(f.remote.resize).toHaveBeenCalledWith({ attachmentId, cols: 120, rows: 40 })
    expect(f.remote.closeAgent).toHaveBeenCalledWith(uuid)
    const error = new RemoteError('sidebarTerminals/unavailable', 'PTY unavailable', {})
    f.remote.input.mockResolvedValue({ ok: false, error })
    f.remote.resize.mockResolvedValue({ ok: false, error })
    f.remote.capability.mockResolvedValue({ ok: false, error })
    f.remote.shells.mockResolvedValue({ ok: false, error })
    f.remote.closeAgent.mockResolvedValue({ ok: false, error })
    await expect(f.transport.terminalInput(attachmentId, 'input')).rejects.toBe(error)
    await expect(f.transport.terminalResize(attachmentId, 1, 1)).rejects.toBe(error)
    await expect(f.transport.terminalCapability()).rejects.toBe(error)
    await expect(f.transport.terminalShells()).rejects.toBe(error)
    await expect(f.transport.terminalCloseAgent(uuid)).rejects.toBe(error)
  })

  it('awaits every active stream, unsubscribed watch, release, and in-flight operation on disposal', async () => {
    const f = fixture()
    f.connect()
    f.connect()
    await accepted(f)
    f.terminals.at(1)!.push(ready('second' as SidebarTerminalAttachmentId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledTimes(2) })
    const unsubscribe = f.transport.watchAgentTerminals(sessionId, vi.fn())
    const watchClosed = deferred<undefined>()
    f.watches.at(0)!.closing = watchClosed.promise
    unsubscribe()
    const input = deferred<RemoteResult<void>>()
    f.remote.input.mockReturnValue(input.promise)
    const inputDone = f.transport.terminalInput(attachmentId, 'pending')
    const released = deferred<RemoteResult<void>>()
    f.remote.release.mockReturnValue(released.promise)
    let disposed = false
    const closing = f.transport.dispose()
    expect(f.transport.dispose()).toBe(closing)
    void closing.then(() => { disposed = true })
    await vi.waitFor(() => { expect(f.remote.release).toHaveBeenCalledTimes(2) })
    released.resolve(ok(undefined))
    await Promise.all(f.terminals.map(feed => feed.closed.promise))
    expect(disposed).toBe(false)
    watchClosed.resolve(undefined)
    await f.watches.at(0)!.closed.promise
    expect(disposed).toBe(false)
    input.resolve(ok(undefined))
    await inputDone
    await closing
    expect(disposed).toBe(true)
    expect(() => f.connect()).toThrow('disposed')
    expect(() => f.transport.watchAgentTerminals(sessionId, vi.fn())).toThrow('disposed')
    await expect(f.transport.terminalInput(attachmentId, 'late')).rejects.toThrow('disposed')
  })

  it('awaits stream teardown before rejecting a failed release', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    const error = new RemoteError('sidebarTerminals/stale-attachment', 'gone', {})
    f.remote.release.mockResolvedValue({ ok: false, error })
    const close = f.transport.dispose()
    await expect(close).rejects.toMatchObject({ errors: [error] })
    await f.terminals.at(0)!.closed.promise
    expect(f.terminals.at(0)!.signal?.aborted).toBe(true)
    expect(f.errors).not.toHaveBeenCalled()
  })
})

describe('canonical UI process close', () => {
  it('inspects an offscreen persisted tab after reload and closes exactly that existing process', async () => {
    const f = fixture()
    f.remote.inspectUi.mockResolvedValue(ok(processId))
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.inspectUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId })
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId })
    expect(f.remote.open).not.toHaveBeenCalled()
    expect(f.remote.resize).not.toHaveBeenCalled()
    expect(f.remote.release).not.toHaveBeenCalled()
  })

  it('rejects a failed inspection and awaits that lookup during disposal', async () => {
    const f = fixture()
    const inspected = deferred<RemoteResult<SidebarTerminalProcessId | null>>()
    f.remote.inspectUi.mockReturnValue(inspected.promise)
    const closing = f.transport.terminalCloseUi(sessionId, tabId)
    const error = new RemoteError('sidebarTerminals/unavailable', 'inspection unavailable', {})
    const rejected = expect(closing).rejects.toBe(error)
    let disposed = false
    const disposal = f.transport.dispose().then(() => { disposed = true })
    await new Promise(resolve => setImmediate(resolve))
    expect(disposed).toBe(false)
    inspected.resolve({ ok: false, error })
    await rejected
    await disposal
    expect(f.remote.closeUi).not.toHaveBeenCalled()
    expect(f.remote.inspectUi).toHaveBeenCalledTimes(1)
  })

  it('keeps disposal pending through the close request issued after an in-flight inspection', async () => {
    const f = fixture()
    const inspected = deferred<RemoteResult<SidebarTerminalProcessId | null>>()
    const closed = deferred<RemoteResult<void>>()
    f.remote.inspectUi.mockReturnValue(inspected.promise)
    f.remote.closeUi.mockReturnValue(closed.promise)
    const closing = f.transport.terminalCloseUi(sessionId, tabId)
    let disposed = false
    const disposal = f.transport.dispose().then(() => { disposed = true })
    inspected.resolve(ok(processId))
    await vi.waitFor(() => { expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId }) })
    expect(disposed).toBe(false)
    closed.resolve(ok(undefined))
    await closing
    await disposal
    expect(disposed).toBe(true)
  })

  it('preserves a newer ready received while a cache-miss inspection is pending', async () => {
    const f = fixture()
    const inspected = deferred<RemoteResult<SidebarTerminalProcessId | null>>()
    f.remote.inspectUi.mockReturnValue(inspected.promise)
    const closing = f.transport.terminalCloseUi(sessionId, tabId)
    f.connect()
    f.terminals.at(0)!.push(ready(attachmentId, nextProcessId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledOnce() })
    inspected.resolve(ok(processId))
    await closing
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi.mock.calls).toEqual([
      [{ sessionId, tabId, processId }],
      [{ sessionId, tabId, processId: nextProcessId }],
    ])
    expect(f.remote.inspectUi).toHaveBeenCalledTimes(1)
  })

  it('never replaces a known stale process token with the current inspected generation', async () => {
    const f = fixture()
    const release = f.connect()
    await accepted(f)
    await release('disconnect')
    f.remote.inspectUi.mockResolvedValue(ok(nextProcessId))
    const error = new RemoteError('sidebarTerminals/stale-attachment', 'generation replaced', {})
    f.remote.closeUi.mockResolvedValue({ ok: false, error })
    await expect(f.transport.terminalCloseUi(sessionId, tabId)).rejects.toBe(error)
    expect(f.remote.inspectUi).not.toHaveBeenCalled()
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId })
  })

  it('does not close or spawn a missing process, including a cancelled opening', async () => {
    const f = fixture()
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.inspectUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId })
    expect(f.remote.open).not.toHaveBeenCalled()
    expect(f.remote.closeUi).not.toHaveBeenCalled()
    const close = f.connect()
    f.terminals.at(0)!.push(ready())
    await close('close')
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).not.toHaveBeenCalled()
    expect(f.remote.ack).not.toHaveBeenCalled()
  })

  it('closes the last ready process while its attachment is waiting for Connection', async () => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    f.connection.set(undefined)
    f.terminals.at(0)!.fail(new RemoteStreamCarrierError('offline'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId })
    await close('close')
    f.connection.set(2)
    await f.transport.dispose()
    expect(f.remote.open).toHaveBeenCalledTimes(1)
  })

  it('uses the replacement ready process after renderer release closes its attachment first', async () => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    f.connection.set(undefined)
    f.terminals.at(0)!.fail(new RemoteStreamCarrierError('offline'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    f.connection.set(2)
    await vi.waitFor(() => { expect(f.remote.open).toHaveBeenCalledTimes(2) })
    const nextAttachment = 'attachment-2' as SidebarTerminalAttachmentId
    f.terminals.at(1)!.push(ready(nextAttachment, nextProcessId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledWith({ attachmentId: nextAttachment, sequence: 0 }) })
    await close('close')
    expect(f.remote.release).toHaveBeenCalledWith({ attachmentId: nextAttachment, mode: 'close' })
    await f.transport.terminalCloseUi(sessionId, tabId)
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId: nextProcessId })
  })

  it('keeps process identities scoped to both Session and tab', async () => {
    const f = fixture()
    const otherSession = 'other-session' as SidebarTerminalSessionId
    const otherTab = 'terminal:2' as SidebarTerminalTabId
    const thirdProcess = '00000000-0000-4000-8000-000000000004' as SidebarTerminalProcessId
    f.connect()
    await accepted(f)
    f.transport.connectTerminal({ ...request, target: { kind: 'ui', sessionId: otherSession, tabId } }, f.frames, f.errors)
    f.terminals.at(1)!.push(ready('other-session' as SidebarTerminalAttachmentId, nextProcessId))
    f.transport.connectTerminal({ ...request, target: { kind: 'ui', sessionId, tabId: otherTab } }, f.frames, f.errors)
    f.terminals.at(2)!.push(ready('other-tab' as SidebarTerminalAttachmentId, thirdProcess))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledTimes(3) })
    await f.transport.terminalCloseUi(sessionId, otherTab)
    await f.transport.terminalCloseUi(otherSession, tabId)
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi.mock.calls).toEqual([
      [{ sessionId, tabId: otherTab, processId: thirdProcess }],
      [{ sessionId: otherSession, tabId, processId: nextProcessId }],
      [{ sessionId, tabId, processId }],
    ])
  })

  it('forgets an exited UI process without letting an agent exit remove a UI process', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    f.terminals.at(0)!.push({ type: 'exit', attachmentId, exitCode: 0 })
    await f.terminals.at(0)!.closed.promise
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).not.toHaveBeenCalled()

    f.connect()
    f.terminals.at(1)!.push(ready(attachmentId, nextProcessId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledTimes(2) })
    f.transport.connectTerminal({ ...request, target: { kind: 'agent', uuid } }, f.frames, f.errors)
    const agentAttachment = 'agent-attachment' as SidebarTerminalAttachmentId
    f.terminals.at(2)!.push(ready(agentAttachment))
    f.terminals.at(2)!.push({ type: 'exit', attachmentId: agentAttachment, exitCode: 0 })
    await f.terminals.at(2)!.closed.promise
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId: nextProcessId })
  })

  it('does not forget a newer process when an older attachment emits exit', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    f.connect()
    const nextAttachment = 'attachment-2' as SidebarTerminalAttachmentId
    f.terminals.at(1)!.push(ready(nextAttachment, nextProcessId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledTimes(2) })
    f.terminals.at(0)!.push({ type: 'exit', attachmentId, exitCode: 0 })
    await f.terminals.at(0)!.closed.promise
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId: nextProcessId })
  })

  it.each(['cancelled', 'invalid'] as const)('ignores %s ready instead of replacing the cached process', async (kind) => {
    const f = fixture()
    const close = f.connect()
    await accepted(f)
    if (kind === 'cancelled') {
      await close('disconnect')
      const cancel = f.connect()
      f.terminals.at(1)!.push(ready('late' as SidebarTerminalAttachmentId, nextProcessId))
      await cancel('close')
    } else {
      f.terminals.at(0)!.push(ready('invalid' as SidebarTerminalAttachmentId, nextProcessId))
      await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledOnce() })
    }
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledExactlyOnceWith({ sessionId, tabId, processId })
  })

  it('consumes the captured process before awaiting close and preserves a newer ready on failure', async () => {
    const f = fixture()
    const release = f.connect()
    await accepted(f)
    await release('disconnect')
    const answer = deferred<RemoteResult<void>>()
    f.remote.closeUi.mockReturnValueOnce(answer.promise)
    const closing = f.transport.terminalCloseUi(sessionId, tabId)
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenCalledTimes(1)
    f.connect()
    f.terminals.at(1)!.push(ready(attachmentId, nextProcessId))
    await vi.waitFor(() => { expect(f.remote.ack).toHaveBeenCalledTimes(2) })
    const error = new RemoteError('sidebarTerminals/stale-attachment', 'generation replaced', {})
    answer.resolve({ ok: false, error })
    await expect(closing).rejects.toBe(error)
    await f.transport.terminalCloseUi(sessionId, tabId)
    expect(f.remote.closeUi).toHaveBeenLastCalledWith({ sessionId, tabId, processId: nextProcessId })
  })

  it('awaits canonical close requests during owner disposal and rejects later commands', async () => {
    const f = fixture()
    f.connect()
    await accepted(f)
    const answer = deferred<RemoteResult<void>>()
    f.remote.closeUi.mockReturnValue(answer.promise)
    const closing = f.transport.terminalCloseUi(sessionId, tabId)
    let disposed = false
    const disposal = f.transport.dispose().then(() => { disposed = true })
    await f.terminals.at(0)!.closed.promise
    expect(disposed).toBe(false)
    answer.resolve(ok(undefined))
    await closing
    await disposal
    await expect(f.transport.terminalCloseUi(sessionId, tabId)).rejects.toThrow('disposed')
    expect(f.remote.closeUi).toHaveBeenCalledTimes(1)
  })
})

describe('agent terminal watch lifetime', () => {
  it('suppresses a snapshot already yielded by the supervisor when the caller unsubscribes', async () => {
    const f = fixture()
    const delivery = deferred<IteratorResult<AgentList>>()
    const stopped = deferred<undefined>()
    f.remote.watch.mockImplementation(() => ({
      [Symbol.asyncIterator]: () => ({
        next: () => delivery.promise,
        return: async () => ({ done: true, value: undefined }),
      }),
    }))
    const receive = vi.fn()
    const stop = f.transport.watchAgentTerminals(sessionId, receive)
    // The source read resolves before RemoteStream's yielded item reaches the consumer reaction.
    void delivery.promise.then(() => { queueMicrotask(() => { stop(); stopped.resolve(undefined) }) })
    delivery.resolve({ done: false, value: [] })
    await stopped.promise
    await f.transport.dispose()
    expect(receive).not.toHaveBeenCalled()
  })

  it('retries accepted EOF but ends a watch that never delivered its opening snapshot', async () => {
    const f = fixture()
    const receive = vi.fn()
    f.transport.watchAgentTerminals(sessionId, receive)
    f.watches.at(0)!.push([])
    await vi.waitFor(() => { expect(receive).toHaveBeenCalledOnce() })
    f.watches.at(0)!.end()
    await vi.waitFor(() => { expect(f.remote.watch).toHaveBeenCalledTimes(2) })
    f.watches.at(1)!.end()
    await f.watches.at(1)!.closed.promise
    await new Promise(resolve => setImmediate(resolve))
    await f.transport.dispose()
    expect(f.remote.watch).toHaveBeenCalledTimes(2)
  })

  it('follows Connection snapshots and suppresses updates after unsubscribe', async () => {
    const f = fixture()
    const receive = vi.fn<(list: AgentList) => void>()
    const stop = f.transport.watchAgentTerminals(sessionId, receive)
    const list: AgentList = [{ uuid, title: 'Agent shell', command: 'pwsh', exited: false }]
    f.watches.at(0)!.push(list)
    await vi.waitFor(() => { expect(receive).toHaveBeenCalledWith(list) })
    f.connection.set(undefined)
    f.watches.at(0)!.fail(new RemoteStreamCarrierError('watch lost'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    f.connection.set(2)
    await vi.waitFor(() => { expect(f.remote.watch).toHaveBeenCalledTimes(2) })
    f.watches.at(1)!.push([])
    await vi.waitFor(() => { expect(receive).toHaveBeenLastCalledWith([]) })
    stop()
    f.watches.at(1)!.push(list)
    await f.transport.dispose()
    expect(receive).toHaveBeenCalledTimes(2)
    expect(f.connection.listeners.size).toBe(0)
    expect(f.watches.every(feed => feed.signal?.aborted)).toBe(true)
  })

  it('keeps watch lifetimes independent and contains unavailability and throwing callbacks', async () => {
    const f = fixture()
    const failed = vi.fn(() => { throw new Error('subscriber failed') })
    const live = vi.fn()
    f.transport.watchAgentTerminals(sessionId, failed)
    f.transport.watchAgentTerminals('other' as SidebarTerminalSessionId, live)
    f.watches.at(0)!.push([])
    f.watches.at(1)!.push([])
    await vi.waitFor(() => { expect(live).toHaveBeenCalledWith([]) })
    await vi.waitFor(() => { expect(failed).toHaveBeenCalledOnce() })
    f.watches.at(0)!.push([])
    await vi.waitFor(() => { expect(failed).toHaveBeenCalledTimes(2) })
    f.watches.at(1)!.fail(new RemoteError('sidebarTerminals/unavailable', 'missing provider', {}))
    await f.watches.at(1)!.closed.promise
    await f.transport.dispose()
    expect(f.remote.watch).toHaveBeenCalledTimes(2)
  })

  it('cancels watches waiting on Connection and permits a fresh subscription after unsubscribe', async () => {
    const f = fixture()
    const stop = f.transport.watchAgentTerminals(sessionId, vi.fn())
    f.connection.set(undefined)
    f.watches.at(0)!.fail(new RemoteStreamCarrierError('offline'))
    await vi.waitFor(() => { expect(f.connection.listeners.size).toBe(1) })
    stop()
    f.connection.set(2)
    const list = vi.fn()
    f.transport.watchAgentTerminals(sessionId, list)
    f.watches.at(1)!.push([])
    await vi.waitFor(() => { expect(list).toHaveBeenCalledWith([]) })
    await f.transport.dispose()
    expect(f.remote.watch).toHaveBeenCalledTimes(2)
    expect(f.connection.listeners.size).toBe(0)
  })
})
