// @vitest-environment jsdom
/** Online reminders use real state transitions without replaying disconnected intervals. */
import { expect, it } from 'vitest'
import { ApprovalSchema, DesktopSchema } from '@cinlan/mobile-relay/protocol'
import { DesktopActivity, loadNotificationPreferences } from '../src/transport/activity'

const desktop = (running: boolean, hostId = 'desktop') => DesktopSchema.parse({
  hostId, name: 'Desktop', os: 'Windows', workspaces: [],
  sessions: [{ id: 'session', title: 'Review', cwd: '', running, updatedAt: 0 }],
})

it('reports only observed running-to-idle transitions in the same host', () => {
  const activity = new DesktopActivity()
  expect(activity.update(desktop(false))).toEqual([])
  expect(activity.update(desktop(true))).toEqual([])
  expect(activity.update(desktop(false))).toEqual([{ hostId: 'desktop', sessionId: 'session', kind: 'idle' }])
  expect(activity.update(desktop(false))).toEqual([])
  activity.baseline(desktop(true))
  expect(activity.update(desktop(false, 'other-desktop'))).toEqual([])
})

it('does not turn a reconnect snapshot or a removed session into a completion', () => {
  const activity = new DesktopActivity()
  activity.baseline(desktop(true))
  activity.baseline(undefined)
  activity.baseline(desktop(false))
  expect(activity.update(desktop(false))).toEqual([])
  activity.baseline(desktop(true))
  expect(activity.update({ ...desktop(false), sessions: [] })).toEqual([])
})

it('deduplicates pending approvals through automatic reconnect and releases settled entries', () => {
  const activity = new DesktopActivity()
  const hostId = desktop(false).hostId
  const approval = ApprovalSchema.parse({ approvalId: 'approval', sessionId: 'session', toolName: 'shell', reason: 'Review', createdAt: 0 })
  expect(activity.approval(hostId, approval)).toEqual({ hostId: 'desktop', sessionId: 'session', kind: 'approval' })
  activity.baseline(undefined)
  activity.baseline(desktop(false))
  expect(activity.approval(hostId, approval)).toBeNull()
  activity.settle('approval')
  expect(activity.approval(hostId, approval)).not.toBeNull()
})

it('distinguishes the default enabled reminder state from an explicit user choice', () => {
  expect(loadNotificationPreferences()).toMatchObject({ enabled: true, configured: false })
  localStorage.setItem('cinlan-mobile:notifications-enabled', 'false')
  expect(loadNotificationPreferences()).toMatchObject({ enabled: false, configured: true })
  localStorage.setItem('cinlan-mobile:notifications-enabled', 'true')
  expect(loadNotificationPreferences()).toMatchObject({ enabled: true, configured: true })
})
