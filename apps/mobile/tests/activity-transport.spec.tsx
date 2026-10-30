// @vitest-environment jsdom
/** Exercise the production hook with transport callbacks, without opening a network connection. */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApprovalSchema, DesktopSchema } from '@cinlan/mobile-relay/protocol'
import { MobileClient, SavedHostSchema } from '../src/transport/client'
import { useDesktops } from '../src/transport/use-desktops'
import type { MobileActivity } from '../src/transport/activity'

const transport = vi.hoisted(() => ({
  callbacks: [] as ConstructorParameters<typeof MobileClient>[],
  close: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
}))
vi.mock('../src/transport/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/transport/client')>()
  return {
    ...actual,
    loadHosts: transport.load,
    saveHosts: transport.save,
    MobileClient: class {
      constructor(...args: ConstructorParameters<typeof MobileClient>) { transport.callbacks.push(args) }
      connect = vi.fn(async () => {})
      close = transport.close
      request = vi.fn(async () => ({}))
    },
  }
})
const saved = SavedHostSchema.parse({ hostId: 'desktop', name: 'Desktop', publicKey: 'a'.repeat(44),
  deviceId: 'device', token: 'b'.repeat(43), relayToken: 'c'.repeat(43), directUrl: 'ws://localhost/' })
const desktop = (running: boolean) => DesktopSchema.parse({ hostId: 'desktop', name: 'Desktop', os: 'Windows',
  workspaces: [], sessions: [{ id: 'session', title: 'Review', cwd: '', running, updatedAt: 0 }] })
const approval = ApprovalSchema.parse({ approvalId: 'approval', sessionId: 'session', toolName: 'shell',
  reason: 'Review', createdAt: 0 })

beforeEach(() => {
  transport.callbacks.length = 0
  transport.load.mockReturnValue([saved])
  transport.save.mockClear()
  transport.close.mockClear()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('delivers live desktop and approval events while retaining reconnect baselines and deduplication', () => {
  const notify = vi.fn<(activity: MobileActivity) => void>()
  const { result } = renderHook(() => useDesktops(notify))
  const [, status, event, enrolled] = transport.callbacks[0]
  act(() => { enrolled(saved, desktop(true)); status('paired') })
  expect(notify).not.toHaveBeenCalled()
  act(() => {
    event({ type: 'event', event: 'desktop', value: desktop(false) })
    event({ type: 'event', event: 'desktop', value: desktop(false) })
    event({ type: 'event', event: 'approval', value: approval })
    event({ type: 'event', event: 'approval', value: approval })
  })
  expect(notify.mock.calls.map(([notice]) => notice.kind)).toEqual(['idle', 'approval'])
  expect(result.current.approvals.desktop).toEqual([approval])
  act(() => {
    status('reconnecting')
    enrolled(saved, desktop(false))
    status('paired')
    event({ type: 'event', event: 'desktop', value: desktop(false) })
    event({ type: 'event', event: 'approval', value: approval })
  })
  expect(notify).toHaveBeenCalledTimes(2)
  act(() => { event({ type: 'event', event: 'approval-settled', value: { approvalId: approval.approvalId } }) })
  expect(result.current.approvals.desktop).toEqual([])
  act(() => { event({ type: 'event', event: 'approval', value: approval }) })
  expect(notify).toHaveBeenCalledTimes(3)
})

it('uses the latest UI listener and isolates listener errors from transport state updates', () => {
  const first = vi.fn()
  const second = vi.fn(() => { throw new Error('UI callback failed') })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { result, rerender } = renderHook(({ listener }) => useDesktops(listener), { initialProps: { listener: first } })
  const [, , event, enrolled] = transport.callbacks[0]
  act(() => { enrolled(saved, desktop(true)) })
  rerender({ listener: second })
  act(() => { event({ type: 'event', event: 'desktop', value: desktop(false) }) })
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
  expect(result.current.hosts.desktop?.desktop.sessions[0]?.running).toBe(false)
  expect(log).toHaveBeenCalledWith('mobile_activity_listener_failed')
})

it('ignores obsolete clients after replacement and events after unmount', async () => {
  const notify = vi.fn()
  const { result, unmount } = renderHook(() => useDesktops(notify))
  const [, , oldEvent, oldEnrolled] = transport.callbacks[0]
  act(() => { oldEnrolled(saved, desktop(true)) })
  await act(async () => { await result.current.reconnect('desktop') })
  const [, , event, enrolled] = transport.callbacks[1]
  act(() => {
    enrolled(saved, desktop(false))
    oldEvent({ type: 'event', event: 'desktop', value: desktop(false) })
    oldEvent({ type: 'event', event: 'approval', value: approval })
  })
  expect(notify).not.toHaveBeenCalled()
  unmount()
  event({ type: 'event', event: 'approval', value: approval })
  expect(notify).not.toHaveBeenCalled()
  expect(transport.close).toHaveBeenCalled()
})
