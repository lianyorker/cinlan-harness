/** Remote-result and generation races use deferred promises instead of elapsed time. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { McpManagementSnapshot, McpSaveResult } from '@deepseek-ai/dsh-api-mcp-controller/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { McpSettingsSource, canRefreshTools } from '../src/client/source.ts'
import { remoteFixture, snapshot, record, failure, serverId } from './fixture.client.ts'

function setup() {
  const fixture = remoteFixture()
  const source = new McpSettingsSource(fixture.remote)
  onTestFinished(async () => { await source.dispose() })
  return { source, ...fixture }
}
const ready = async (source: McpSettingsSource) => { await vi.waitFor(() =>{  expect(source.state.getSnapshot().status).toBe('ready') }) }

describe('MCP readback lifetime', () => {
  it.each(['frame', 'throw'] as const)('discards a superseded watch that settles with a late %s', async (settlement) => {
    const { source, remote } = setup()
    const gate = Promise.withResolvers<undefined>()
    remote.watch.mockImplementationOnce(async function* () {
      await gate.promise
      if (settlement === 'throw') throw new Error('OLD_PRIVATE_ERROR')
      yield snapshot({ revision: 99 })
    })
    source.connect(1)
    try {
      await ready(source)
      source.connect(2)
      await ready(source)
    } finally { gate.resolve(undefined) }
    await source.dispose()
    expect(source.state.getSnapshot().snapshot?.revision).toBe(1)
    expect(source.state.getSnapshot().readError).toBeNull()
  })

  it.each([false, true])('ignores late snapshot rejection after newer readback or disconnect (%s)', async (disconnect) => {
    const { source, remote } = setup()
    const pending = Promise.withResolvers<RemoteResult<McpManagementSnapshot>>()
    remote.snapshot.mockReturnValueOnce(pending.promise)
    source.connect(1)
    try {
      await ready(source)
      if (disconnect) source.connect(undefined)
    } finally { pending.reject(new Error('OLD_SNAPSHOT_ERROR')) }
    await source.dispose()
    expect(source.state.getSnapshot().readError).toBeNull()
  })

  it('keeps a stable observable and ignores a late initial snapshot after watch publication', async () => {
    const { source, remote, push } = setup()
    const initial = Promise.withResolvers<RemoteResult<McpManagementSnapshot>>()
    remote.snapshot.mockReturnValueOnce(initial.promise)
    const observable = source.state
    source.connect(1)
    await ready(source)
    push(snapshot({ revision: 4, reconciling: true }))
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().snapshot?.revision).toBe(4) })
    initial.resolve({ ok: true, value: snapshot({ revision: 1 }) })
    await initial.promise
    expect(source.state).toBe(observable)
    const state = source.state.getSnapshot()
    expect(source.state.getSnapshot()).toBe(state)
    expect(state.snapshot?.reconciling).toBe(true)
    push(snapshot({ revision: 2 }))
    await Promise.resolve()
    expect(source.state.getSnapshot().snapshot?.revision).toBe(4)
  })

  it('aborts old streams on loss, replaces the baseline on reconnect and waits for disposal', async () => {
    const { source, signals, done, subscribers, remote, push } = setup()
    source.connect(1)
    source.connect(1)
    await ready(source)
    expect(remote.watch).toHaveBeenCalledTimes(1)
    push(snapshot({ revision: 9 }))
    await vi.waitFor(() => { expect(source.state.getSnapshot().snapshot?.revision).toBe(9) })
    source.connect(undefined)
    expect(signals[0]?.aborted).toBe(true)
    expect(source.state.getSnapshot().status).toBe('offline')
    await done[0]
    expect(subscribers.size).toBe(0)
    push(snapshot({ revision: 1 }))
    source.connect(2)
    await ready(source)
    expect(source.state.getSnapshot().snapshot?.revision).toBe(1)
    await source.dispose()
    expect(signals.every(signal => signal.aborted)).toBe(true)
    expect(subscribers.size).toBe(0)
  })

  it('renders safe stream errors and permits explicit retry', async () => {
    const { source, fail, remote } = setup()
    source.connect(1)
    await ready(source)
    fail('stopped')
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().readError).toBe('stopped') })
    expect(JSON.stringify(source.state.getSnapshot())).not.toContain('RAW_PRIVATE')
    source.restart()
    await ready(source)
    expect(remote.watch).toHaveBeenCalledTimes(2)
  })

  it('shows unexpected stream termination and transport exceptions', async () => {
    const { source, remote } = setup()
    remote.watch.mockImplementationOnce(async function* () { throw new Error('PRIVATE') })
    source.connect(1)
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().readError).toBe('unavailable') })
    remote.watch.mockImplementationOnce(async function* () { return })
    source.restart()
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().status).toBe('error') })
    expect(source.state.getSnapshot().readError).toBe('unavailable')
  })

  it('shows snapshot Remote failures and rejected reads until a stream baseline arrives', async () => {
    const { source, remote } = setup()
    const gate = Promise.withResolvers<undefined>()
    remote.watch.mockImplementationOnce(async function* (signal = new AbortController().signal) {
      const abort = () => { gate.resolve(undefined) }
      signal.addEventListener('abort', abort, { once: true })
      try { await gate.promise; if (!signal.aborted) yield snapshot() }
      finally { signal.removeEventListener('abort', abort) }
    })
    remote.snapshot.mockResolvedValueOnce(failure('not-ready'))
    source.connect(1)
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().readError).toBe('not-ready') })
    gate.resolve(undefined)
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().snapshot).not.toBeNull() })
    remote.snapshot.mockRejectedValueOnce(new Error('PRIVATE'))
    remote.watch.mockImplementationOnce(async function* (signal = new AbortController().signal) {
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    })
    source.restart()
    await vi.waitFor(() =>{  expect(source.state.getSnapshot().readError).toBe('unavailable') })
  })
})

describe('MCP commands', () => {
  it('maps unrelated Remote codes to fixed copy and ignores late transport rejections', async () => {
    const { source, remote } = setup()
    source.connect(1)
    await ready(source)
    remote.probe.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'PRIVATE_MESSAGE', {}) })
    expect(await source.probe({ id: serverId })).toBe(false)
    expect(source.state.getSnapshot().actionError).toBe('unavailable')
    const pending = Promise.withResolvers<RemoteResult<McpSaveResult>>()
    remote.save.mockReturnValueOnce(pending.promise)
    const save = source.save({ record: record(), expectedRevision: 1 })
    source.connect(undefined)
    pending.reject(new Error('OLD_ACTION_ERROR'))
    expect(await save).toBe(false)
    expect(source.state.getSnapshot().actionError).toBe('cancelled')
  })

  it.each(['conflict', 'invalid-config', 'not-found', 'disabled', 'not-ready', 'storage-failed', 'stopped', 'probe-failed', 'close-failed'] as const)(
    'reports %s without accepting a Remote error as success', async (code) => {
      const { source, remote } = setup()
      source.connect(1)
      await ready(source)
      remote.save.mockResolvedValueOnce(failure(code))
      expect(await source.save({ record: record(), expectedRevision: 1 })).toBe(false)
      expect(source.state.getSnapshot()).toMatchObject({ pending: false, actionError: code })
      expect(JSON.stringify(source.state.getSnapshot())).not.toContain('RAW_PRIVATE')
    })

  it('serializes pending gestures and ignores a save completed after connection loss', async () => {
    const { source, remote } = setup()
    source.connect(1)
    await ready(source)
    const pending = Promise.withResolvers<RemoteResult<McpSaveResult>>()
    remote.save.mockReturnValueOnce(pending.promise)
    const saved = source.save({ record: record(), expectedRevision: 1 })
    try {
      expect(source.state.getSnapshot().pending).toBe(true)
      expect(await source.reconnect({ id: serverId })).toBe(false)
      expect(remote.reconnect).not.toHaveBeenCalled()
      source.connect(undefined)
      expect(source.state.getSnapshot()).toMatchObject({ pending: false, actionError: 'cancelled' })
    } finally { pending.resolve({ ok: true, value: { id: serverId, snapshot: snapshot({ revision: 3 }) } }) }
    expect(await saved).toBe(false)
    expect(source.state.getSnapshot().snapshot?.revision).toBe(1)
    expect(await source.remove({ id: serverId, expectedRevision: 1 })).toBe(false)
    expect(source.state.getSnapshot().actionError).toBe('unavailable')
  })

  it('publishes accepted operations without overwriting newer watch observations', async () => {
    const { source, remote, push } = setup()
    source.connect(1)
    await ready(source)
    const pending = Promise.withResolvers<RemoteResult<McpManagementSnapshot>>()
    remote.setEnabled.mockReturnValueOnce(pending.promise)
    const operation = source.setEnabled({ id: serverId, expectedRevision: 1, enabled: false })
    try {
      push(snapshot({ revision: 2, reconciling: true }))
      await vi.waitFor(() =>{  expect(source.state.getSnapshot().snapshot?.revision).toBe(2) })
    } finally { pending.resolve({ ok: true, value: snapshot({ revision: 2, reconciling: false }) }) }
    expect(await operation).toBe(true)
    expect(source.state.getSnapshot().snapshot?.reconciling).toBe(true)
    expect(await source.reconnect({ id: serverId })).toBe(true)
    expect(await source.probe({ id: serverId })).toBe(true)
    expect(remote.probe.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(await source.remove({ id: serverId, expectedRevision: 2 })).toBe(true)
  })

  it('redacts unexpected command failures and rejects locally invalid drafts visibly', async () => {
    const { source, remote } = setup()
    source.connect(1)
    await ready(source)
    remote.probe.mockRejectedValueOnce(new Error('SECRET'))
    expect(await source.probe({ id: serverId })).toBe(false)
    expect(source.state.getSnapshot()).toMatchObject({ actionError: 'unavailable', pending: false })
    source.invalidDraft()
    expect(source.state.getSnapshot().actionError).toBe('invalid-config')
  })

  it('limits Refresh tools to enabled ready or error rows and leaves active-handle admission to the Host', () => {
    for (const phase of ['ready', 'error', 'connecting', 'backoff', 'stopped'] as const) {
      const row = { record: record(), observed: { phase, attempt: 0, tools: [] }, applying: false }
      expect(canRefreshTools(row)).toBe(phase === 'ready' || phase === 'error')
      expect(canRefreshTools({ ...row, applying: true })).toBe(false)
      expect(canRefreshTools({ ...row, record: record({ enabled: false }) })).toBe(false)
    }
  })
})
