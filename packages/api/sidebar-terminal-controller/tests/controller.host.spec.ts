/** Controller behavior through real Loader-discovered Remote methods, not generated artifacts. */
import { once } from 'node:events'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalErrorCode, SidebarTerminalOpenRequest, SidebarTerminalSessionId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { ATTACHMENT, PROCESS, createHarness, OPEN, result } from './harness.ts'

const WINDOW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function ready() { return { type: 'ready', attachmentId: ATTACHMENT, processId: PROCESS, pid: 123, cwd: '.', shellName: 'fixture-shell' } as const }

describe('sidebar terminal Remote composition', () => {
  it('exposes the stable namespace and preserves main, floating, and agent targets', async () => {
    const h = await createHarness()
    expect(remoteMethods(h.ctx.sidebarTerminalController).map(method => [method.method, method.mode]))
      .toEqual([['capability', undefined], ['shells', undefined], ['open', 'stream'], ['input', undefined], ['resize', undefined], ['ack', undefined], ['release', undefined], ['inspectUi', undefined], ['closeUi', undefined], ['watch', 'stream'], ['closeAgent', undefined]])
    expect(await result(await h.rpc('capability'))).toEqual({ ok: true, value: { status: 'available', shellName: 'fixture-shell' } })
    expect(await result(await h.rpc('shells'))).toEqual({ ok: true, value: [{ path: '/bin/fixture-shell', name: 'fixture-shell' }] })
    for (const target of [
      OPEN.target,
      { ...OPEN.target, tabId: 'terminal:' + ATTACHMENT, shellPath: '/bin/zsh' },
      { ...OPEN.target, tabId: 'terminal:tlz0qabc123fallback' },
      { ...OPEN.target, tabId: 'terminal:' + WINDOW + ':0', floating: { windowId: WINDOW, directory: '.' } },
      { kind: 'agent', uuid: ATTACHMENT },
    ]) {
      const request = { ...OPEN, target, cols: 1, rows: 1024 }
      const stream = await h.stream('open', { request })
      expect((await stream.next()).value).toEqual(ready())
      expect(h.provider.open).toHaveBeenLastCalledWith(request, expect.any(AbortSignal))
      await stream.return?.()
    }
    const watch = await h.stream('watch', { sessionId: 'opaque-session' })
    expect((await watch.next()).value).toEqual([])
    expect(h.provider.watch).toHaveBeenCalledWith('opaque-session', expect.any(AbortSignal))
    await watch.return?.()
    expect(h.provider.returned).toHaveBeenCalledTimes(6)
  })

  it('forwards data and exit frames to natural completion without retaining the iterator', async () => {
    const h = await createHarness()
    const finished = vi.fn()
    h.provider.open.mockImplementation(async function* () {
      try {
        yield ready()
        yield { type: 'data', attachmentId: ATTACHMENT, sequence: 1, data: 'terminal output' }
        yield { type: 'exit', attachmentId: ATTACHMENT, exitCode: 0 }
      } finally { finished() }
    })
    const request = { ...OPEN, target: {
      ...OPEN.target, sessionId: 's'.repeat(256), tabId: 'terminal:' + WINDOW + ':9007199254740991',
      floating: { windowId: WINDOW, directory: 'd'.repeat(4096) },
    } }
    const stream = await h.stream('open', { request })
    expect((await stream.next()).value).toEqual(ready())
    expect((await stream.next()).value).toEqual({ type: 'data', attachmentId: ATTACHMENT, sequence: 1, data: 'terminal output' })
    expect((await stream.next()).value).toEqual({ type: 'exit', attachmentId: ATTACHMENT, exitCode: 0 })
    expect(await stream.next()).toMatchObject({ done: true })
    expect(finished).toHaveBeenCalledOnce()
    await h.setEnabled(false)
    expect(finished).toHaveBeenCalledOnce()
  })

  it('routes input, resize, ACK, release, and agent close to the same provider', async () => {
    const h = await createHarness()
    for (const [method, request] of [
      ['input', { attachmentId: ATTACHMENT, data: 'hello\r' }],
      ['resize', { attachmentId: ATTACHMENT, cols: 1024, rows: 1 }],
      ['ack', { attachmentId: ATTACHMENT, sequence: 0 }],
      ['ack', { attachmentId: ATTACHMENT, sequence: Number.MAX_SAFE_INTEGER }],
      ...(['disconnect', 'park', 'close'] as const).map(mode => ['release', { attachmentId: ATTACHMENT, mode }] as const),
    ] as const) {
      expect(await result(await h.rpc(method, { request }))).toMatchObject({ ok: true })
      expect(h.provider[method]).toHaveBeenLastCalledWith(request)
    }
    expect(await result(await h.rpc('closeAgent', { uuid: ATTACHMENT }))).toMatchObject({ ok: true })
    expect(h.provider.closeAgent).toHaveBeenCalledWith(ATTACHMENT)
  })

  it('looks up existing UI identity and closes the observed process through authenticated calls', async () => {
    const h = await createHarness()
    for (const tabId of ['terminal:0', 'terminal:oldOpaque', 'terminal:' + WINDOW + ':1']) {
      const request = { sessionId: OPEN.target.sessionId, tabId }
      expect(await result(await h.rpc('inspectUi', { request }))).toEqual({ ok: true, value: PROCESS })
      expect(h.provider.inspectUi).toHaveBeenLastCalledWith(request)
      expect(await result(await h.rpc('closeUi', { request: { ...request, processId: PROCESS } }))).toMatchObject({ ok: true })
      expect(h.provider.closeUi).toHaveBeenLastCalledWith({ ...request, processId: PROCESS })
    }
    h.provider.inspectUi.mockReturnValue(null)
    expect(await result(await h.rpc('inspectUi', { request: { sessionId: 'missing', tabId: 'terminal:none' } })))
      .toEqual({ ok: true, value: null })
    expect(h.provider.open).not.toHaveBeenCalled()
  })

  it.each([
    null, {}, { sessionId: '', tabId: 'terminal:1' }, { sessionId: 'session', tabId: 'agent:' + ATTACHMENT },
    { sessionId: 'session', tabId: 'terminal:' + WINDOW + ':01' },
    { sessionId: 'session', tabId: 'terminal:1', cwd: '/outside' },
  ])('rejects malformed readonly UI lookup %# before provider entry', async (request) => {
    const h = await createHarness()
    expect(await result(await h.rpc('inspectUi', { request }))).toMatchObject({ ok: false, error: { code: 'sidebarTerminals/invalid-request' } })
    expect(h.provider.inspectUi).not.toHaveBeenCalled()
  })

  it.each([null, {}, { ...OPEN.target, processId: PROCESS },
    { sessionId: 'session', tabId: 'terminal:1', processId: 'old' },
    { sessionId: 'session', tabId: 'terminal:' + WINDOW + ':1:extra', processId: PROCESS },
  ])('rejects unfenced UI close %# before provider entry', async (request) => {
    const h = await createHarness()
    expect(await result(await h.rpc('closeUi', { request }))).toMatchObject({ ok: false, error: { code: 'sidebarTerminals/invalid-request' } })
    expect(h.provider.closeUi).not.toHaveBeenCalled()
  })

  it.each([
    null, [], {}, { ...OPEN, cols: 0 }, { ...OPEN, rows: 1025 }, { ...OPEN, cols: 1.5 },
    { ...OPEN, rows: '24' }, { ...OPEN, extra: 'unbounded metadata' },
    ...['', 'x'.repeat(257), 'session\n', 'session\u0085'].map(sessionId => ({ ...OPEN, target: { ...OPEN.target, sessionId } })),
    ...['', 'terminal:', 'terminal:path/escape', 'terminal:' + 'x'.repeat(129), 'terminal:' + WINDOW + ':0'].map(tabId => ({ ...OPEN, target: { ...OPEN.target, tabId } })),
    { ...OPEN, target: { kind: 'unknown' } },
    ...['', 42, 'x'.repeat(4097), 'shell\0path'].map(shellPath => ({ ...OPEN, target: { ...OPEN.target, shellPath } })),
    { ...OPEN, target: { kind: 'agent', uuid: ATTACHMENT, shellPath: '/bin/sh' } },
    { ...OPEN, target: { kind: 'agent', uuid: ATTACHMENT.toUpperCase() } },
    { ...OPEN, target: { kind: 'agent', uuid: ATTACHMENT, floating: {} } },
    { ...OPEN, target: { ...OPEN.target, floating: { windowId: WINDOW, directory: '.' } } },
    { ...OPEN, target: { ...OPEN.target, tabId: 'terminal:' + WINDOW + ':1', floating: { windowId: WINDOW.toUpperCase(), directory: '.' } } },
    ...['-1', '01', '9007199254740992'].map(counter => ({ ...OPEN, target: {
      ...OPEN.target, tabId: 'terminal:' + WINDOW + ':' + counter, floating: { windowId: WINDOW, directory: '.' },
    } })),
  ])('rejects malformed wire open request %# before provider entry', async (request) => {
    const h = await createHarness()
    const iterator = await h.stream('open', { request })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
    expect(h.provider.open).not.toHaveBeenCalled()
  })

  it.each([null, 42, 'x'.repeat(4097), 'private\0path'])('returns actionable directory diagnostics for malformed directory %#', async (directory) => {
    const h = await createHarness()
    const request = { ...OPEN, target: { ...OPEN.target, tabId: 'terminal:' + WINDOW + ':1', floating: { windowId: WINDOW, directory } } }
    const stream = await h.stream('open', { request })
    await expect(stream.next()).rejects.toMatchObject({
      code: 'sidebarTerminals/invalid-directory', message: 'Choose an existing directory inside the session workspace', details: {},
    })
    expect(h.provider.open).not.toHaveBeenCalled()
  })

  it.each<[string, unknown]>([
    ['input', null], ['input', { attachmentId: ATTACHMENT, data: 3 }],
    ['input', { attachmentId: ATTACHMENT.toUpperCase(), data: '' }],
    ['input', { attachmentId: ATTACHMENT, data: '', hidden: 'extra' }],
    ['resize', { attachmentId: ATTACHMENT, cols: -1, rows: 24 }],
    ['resize', { attachmentId: 'missing', cols: 80, rows: 24 }],
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1'].map((sequence): [string, unknown] => ['ack', { attachmentId: ATTACHMENT, sequence }]),
    ['release', { attachmentId: ATTACHMENT, mode: 'kill' }],
  ])('rejects malformed unary %s before provider entry', async (method, request) => {
    const h = await createHarness()
    await expect(h.call(method, { request })).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
    expect(h.provider.input).not.toHaveBeenCalled()
    expect(h.provider.resize).not.toHaveBeenCalled()
    expect(h.provider.ack).not.toHaveBeenCalled()
    expect(h.provider.release).not.toHaveBeenCalled()
  })

  it('bounds complete UTF-8 input requests including JSON escaping and attachment metadata', async () => {
    const h = await createHarness()
    const overhead = Buffer.byteLength(JSON.stringify({ attachmentId: ATTACHMENT, data: '' }))
    const room = 64 * 1024 - overhead
    for (const [unit, bytes] of [['a', 1], ['界', 3], ['\u0000', 6]] as const) {
      const data = unit.repeat(Math.floor(room / bytes)) + 'a'.repeat(room % bytes)
      expect(Buffer.byteLength(JSON.stringify({ attachmentId: ATTACHMENT, data }))).toBe(64 * 1024)
      await h.call('input', { request: { attachmentId: ATTACHMENT, data } })
      expect(h.provider.input).toHaveBeenLastCalledWith({ attachmentId: ATTACHMENT, data })
      await expect(h.call('input', { request: { attachmentId: ATTACHMENT, data: data + 'a' } })).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
    }
    await expect(h.call('input', { request: { attachmentId: ATTACHMENT, data: 'a'.repeat(65537) } })).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
  })

  it('refuses invalid watch and agent identities at the wire', async () => {
    const h = await createHarness()
    for (const sessionId of ['', 123, 'x'.repeat(257), 'private\n']) {
      const iterator = await h.stream('watch', { sessionId })
      await expect(iterator.next()).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
    }
    await expect(h.call('closeAgent', { uuid: 'invalid' })).rejects.toMatchObject({ code: 'sidebarTerminals/invalid-request' })
    expect(h.provider.watch).not.toHaveBeenCalled()
    expect(h.provider.closeAgent).not.toHaveBeenCalled()
  })

  it.each(['invalid-request', 'invalid-directory', 'invalid-shell', 'unavailable', 'not-found', 'stale-attachment', 'output-overflow', 'ack-timeout'] satisfies SidebarTerminalErrorCode[])
  ('normalizes provider %s failures from unary and deferred stream execution', async (code) => {
    const h = await createHarness()
    h.provider.input.mockImplementation(() => { throw new SidebarTerminalError(code, 'private path and shell diagnostics') })
    const unary = await result(await h.rpc('input', { request: { attachmentId: ATTACHMENT, data: '' } }))
    expect(unary).toMatchObject({ ok: false, error: { code: 'sidebarTerminals/' + code, details: {} } })
    h.provider.open.mockImplementation(async function* () { yield ready(); throw new SidebarTerminalError(code, 'private path and shell diagnostics') })
    const stream = await h.stream('open', { request: OPEN })
    await stream.next()
    await expect(stream.next()).rejects.toMatchObject(unary.ok ? {} : unary.error)
    expect(JSON.stringify(unary)).not.toContain('private path')
  })

  it('sanitizes unknown failures from provider entry and iterator cleanup', async () => {
    const h = await createHarness()
    h.provider.capability.mockImplementation(() => { throw new Error('private shell executable path') })
    const failure = { code: 'sidebarTerminals/operation-failed', message: 'Terminal operation failed; reopen the terminal and check the configured shell', details: {} }
    expect(await result(await h.rpc('capability'))).toEqual({ ok: false, error: failure })
    h.provider.open.mockImplementation(() => { throw new Error('private entry failure') })
    await expect((await h.stream('open', { request: OPEN })).next()).rejects.toMatchObject(failure)
    h.provider.watch.mockImplementation(async function* () { try { yield [] } finally { throw new Error('private cleanup failure') } })
    const stream = await h.stream('watch', { sessionId: 'session' })
    await stream.next()
    await expect(stream.return?.()).rejects.toMatchObject(failure)
  })

  it('checks cancellation before provider entry and forwards live abort signals', async () => {
    const h = await createHarness()
    const abort = new AbortController()
    abort.abort()
    const request = OPEN as SidebarTerminalOpenRequest
    await expect(h.ctx.sidebarTerminalController.open(request, abort.signal)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: 'AbortError' })
    await expect(h.ctx.sidebarTerminalController.watch('session' as SidebarTerminalSessionId, abort.signal)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.provider.open).not.toHaveBeenCalled()
    expect(h.provider.watch).not.toHaveBeenCalled()
    const live = new AbortController()
    const stream = await h.stream('open', { request: OPEN }, live.signal)
    await stream.next()
    const pending = expect(stream.next()).rejects.toMatchObject({ code: 'gateway/cancelled' })
    live.abort()
    await pending
    expect(h.provider.signals[0]?.aborted).toBe(true)
    expect(h.provider.returned).toHaveBeenCalledOnce()
  })

  it('withdraws endpoints and awaits provider iterator cleanup even when the client is paused', async () => {
    const h = await createHarness()
    const old = h.ctx.sidebarTerminalController
    const stream = await h.stream('open', { request: OPEN })
    await stream.next()
    await h.setEnabled(false)
    expect(h.provider.signals[0]?.aborted).toBe(true)
    expect(h.provider.returned).toHaveBeenCalledOnce()
    expect(h.ctx.get('sidebarTerminalController')).toBeUndefined()
    const response = await h.rpc('capability')
    expect(response.status).toBe(404)
    await response.text()
    expect(() => old.capability()).toThrow()
    await stream.return?.()
    await h.setEnabled(true)
    expect(await result(await h.rpc('capability'))).toMatchObject({ ok: true })
  })

  it('does not finish disposal until pending provider cleanup settles', async () => {
    const h = await createHarness()
    const cleaning = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    h.provider.open.mockImplementation(async function* (_request, signal) {
      try {
        yield ready()
        await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
      } finally {
        cleaning.resolve(undefined)
        await release.promise
      }
    })
    const stream = await h.stream('open', { request: OPEN })
    await stream.next()
    const pending = expect(stream.next()).rejects.toMatchObject({ name: 'AbortError' })
    let disposed = false
    const disposing = h.setEnabled(false).then(() => { disposed = true })
    try {
      await cleaning.promise
      expect(disposed).toBe(false)
    } finally { release.resolve(undefined) }
    await disposing
    await pending
    expect(disposed).toBe(true)
  })

  it('rejects missing or tampered Web credentials before unary or stream provider entry', async () => {
    const h = await createHarness(true)
    const cookie = h.cookie()
    for (const credentials of [undefined, cookie + 'tampered']) {
      const response = await h.rpc('capability', {}, credentials)
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('unauthorized')
      const socket = h.socket(credentials)
      socket.on('error', () => { /* A refused HTTP upgrade aborts the ws client. */ })
      const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
      const [, rejected] = await once(socket, 'unexpected-response') as [ClientRequest, IncomingMessage]
      expect(rejected.statusCode).toBe(401)
      rejected.resume()
      socket.terminate()
      await closed
    }
    expect(h.provider.capability).not.toHaveBeenCalled()
    expect(h.provider.open).not.toHaveBeenCalled()
    expect(h.provider.watch).not.toHaveBeenCalled()
    expect(await result(await h.rpc('capability', {}, cookie))).toMatchObject({ ok: true })
  })

  it('carries a full 1 MiB control-character replay in acknowledged 16 KiB terminal frames with default budgets', async () => {
    const { default: events } = await import('node:events')
    type Frame = import('@deepseek-ai/dsh-sidebar-terminals/types').SidebarTerminalFrame
    const h = await createHarness(true)
    const cookie = h.cookie()
    const socket = h.socket(cookie)
    const messages = events.on(socket, 'message', { close: ['close'] })
    const streamId = 'full-replay'
    const transcript = '\u0000'.repeat(1 << 20)
    const frameBytes = 16 * 1024
    let gate = Promise.withResolvers<undefined>()
    let produced = 0
    let acknowledged = -1
    let receivedBytes = 0
    let receivedCharacters = 0
    let maxCarrierBytes = 0
    const chunks: string[] = []
    h.provider.ack.mockImplementation((request) => {
      expect(request).toEqual({ attachmentId: ATTACHMENT, sequence: produced })
      expect(request.sequence).toBe(acknowledged + 1)
      acknowledged = request.sequence
      gate.resolve(undefined)
    })
    h.provider.open.mockImplementation(async function* (_request, signal) {
      h.provider.signals.push(signal)
      const aborted = (): void => { gate.resolve(undefined) }
      signal.addEventListener('abort', aborted, { once: true })
      try {
        yield ready()
        await gate.promise
        signal.throwIfAborted()
        for (let offset = 0; offset < transcript.length;) {
          expect(acknowledged).toBe(produced)
          produced++
          gate = Promise.withResolvers<undefined>()
          const empty = { type: 'data' as const, attachmentId: ATTACHMENT, sequence: produced, data: '' }
          const overhead = Buffer.byteLength(JSON.stringify(empty))
          const characters = Math.floor((frameBytes - overhead) / 6)
          const data = transcript.slice(offset, offset + characters)
          offset += data.length
          yield { ...empty, data }
          await gate.promise
          signal.throwIfAborted()
        }
        yield { type: 'exit', attachmentId: ATTACHMENT, exitCode: 0 }
      } finally {
        signal.removeEventListener('abort', aborted)
        h.provider.returned()
      }
    })
    const readMessage = async (): Promise<{ type: string; streamId: string; value?: Frame }> => {
      const next = await messages.next()
      if (next.done) throw new Error('Replay carrier closed before its terminal stream ended.')
      const [data] = next.value as [import('ws').RawData]
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
      maxCarrierBytes = Math.max(maxCarrierBytes, bytes.byteLength)
      receivedBytes += bytes.byteLength
      const message = JSON.parse(bytes.toString('utf8')) as { type: string; streamId: string; value?: Frame }
      expect(message.streamId).toBe(streamId)
      if (message.type === 'item') {
        const terminalBytes = Buffer.byteLength(JSON.stringify(message.value))
        expect(terminalBytes).toBeLessThanOrEqual(frameBytes)
        if (message.value?.type === 'data') {
          receivedCharacters += message.value.data.length
          if (receivedCharacters < transcript.length) expect(frameBytes - terminalBytes).toBeLessThan(6)
        }
      }
      return message
    }
    try {
      await once(socket, 'open')
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'sidebarTerminals/open', payload: { args: { request: OPEN } } }))
      expect(await readMessage()).toEqual({ type: 'item', streamId, value: ready() })
      let sequence = 0
      for (;;) {
        const request = { attachmentId: ATTACHMENT, sequence }
        expect(await result(await h.rpc('ack', { request }, cookie))).toMatchObject({ ok: true })
        expect(h.provider.ack).toHaveBeenLastCalledWith(request)
        const message = await readMessage()
        expect(message.type).toBe('item')
        const frame = message.value
        if (frame?.type === 'exit') {
          expect(frame).toEqual({ type: 'exit', attachmentId: ATTACHMENT, exitCode: 0 })
          break
        }
        expect(frame).toMatchObject({ type: 'data', attachmentId: ATTACHMENT, sequence: ++sequence })
        if (frame?.type !== 'data') throw new Error('Replay carrier did not deliver terminal data.')
        chunks.push(frame.data)
      }
      expect(await readMessage()).toEqual({ type: 'end', streamId })
      expect(chunks.join('')).toBe(transcript)
      expect(transcript.length).toBe(1 << 20)
      expect(receivedBytes).toBeGreaterThan(6 * (1 << 20))
      expect(receivedCharacters).toBe(1 << 20)
      expect(maxCarrierBytes).toBeGreaterThan(frameBytes)
      expect(sequence).toBe(produced)
      expect(acknowledged).toBe(produced)
      expect(h.provider.ack).toHaveBeenCalledTimes(sequence + 1)
      expect(h.provider.open).toHaveBeenCalledOnce()
      expect(h.provider.returned).toHaveBeenCalledOnce()
      await h.setEnabled(false)
      expect(h.ctx.get('sidebarTerminalController')).toBeUndefined()
      expect(h.provider.returned).toHaveBeenCalledOnce()
    } finally {
      await messages.return?.()
      if (socket.readyState !== socket.CLOSED) {
        const closed = once(socket, 'close')
        socket.close()
        await closed
      }
    }
  }, 30_000)

  it('multiplexes authenticated open/watch and carries control unaries to the same service', async () => {
    const h = await createHarness(true)
    const cookie = h.cookie()
    const socket = h.socket(cookie)
    const frames: unknown[] = []
    socket.on('message', (data) => {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? Buffer.from(data) : data
      frames.push(JSON.parse(bytes.toString('utf8')) as unknown)
    })
    await once(socket, 'open')
    for (const [streamId, method, args] of [['terminal', 'open', { request: OPEN }], ['agents', 'watch', { sessionId: 'session' }]] as const) {
      socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'sidebarTerminals/' + method, payload: { args } }))
    }
    await vi.waitFor(() => { expect(frames).toEqual(expect.arrayContaining([
      { type: 'item', streamId: 'terminal', value: ready() }, { type: 'item', streamId: 'agents', value: [] },
    ])) })
    for (const [method, request] of [
      ['input', { attachmentId: ATTACHMENT, data: 'hello' }], ['resize', { attachmentId: ATTACHMENT, cols: 100, rows: 30 }],
      ['ack', { attachmentId: ATTACHMENT, sequence: 1 }], ['release', { attachmentId: ATTACHMENT, mode: 'park' }],
    ] as const) {
      expect(await result(await h.rpc(method, { request }, cookie))).toMatchObject({ ok: true })
      expect(h.provider[method]).toHaveBeenCalledWith(request)
    }
    socket.send(JSON.stringify({ type: 'cancel', streamId: 'terminal' }))
    await vi.waitFor(() => { expect(h.provider.returned).toHaveBeenCalledTimes(1) })
    expect(h.provider.signals.map(signal => signal.aborted)).toEqual([true, false])
    await h.setEnabled(false)
    expect(h.provider.signals.map(signal => signal.aborted)).toEqual([true, true])
    expect(h.provider.returned).toHaveBeenCalledTimes(2)
  })
})
