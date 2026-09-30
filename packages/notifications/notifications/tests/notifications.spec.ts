import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Notifications from '../src/index.ts'
import { NotificationSettingsSchema } from '../src/index.ts'

describe('notifications Host registration', () => {
  it('registers disabled defaults and the local overnight interval', () => {
    const resolved = NotificationSettingsSchema({})
    expect(resolved).toEqual({
      enabled: false, agentCompletion: false, terminalBell: false, sound: 'system', suppressWhenFocused: false, customSoundName: '',
      quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00',
    })
  })

  it('configures settings presentation on apply', async () => {
    const ctx = new Context()
    let configured = false
    class MockSettings {
      static name = 'settings'
      constructor(c: Context) {
        c.provide('settings', this)
      }
      configure(policy: { auto?: boolean }) {
        configured = policy.auto ?? false
        return () => {}
      }
    }
    await ctx.plugin(MockSettings)
    await ctx.plugin(Notifications)
    expect(configured).toBe(true)
  })

  it.each(['quietHoursStart', 'quietHoursEnd'] as const)('refuses malformed persisted %s', (field) => {
    for (const value of ['', '24:00', '12:60', '7:00', '12:00:30']) {
      expect(() => NotificationSettingsSchema({ [field]: value } as never)).toThrow()
    }
  })

  it.each([['23:59', '00:00'], ['00:00', '00:00'], ['08:30', '17:15']] as const)(
    'accepts the complete %s–%s interval', (start, end) => {
      const resolved = NotificationSettingsSchema({
        quietHoursEnabled: true,
        quietHoursStart: start,
        quietHoursEnd: end,
      })
      expect(resolved.quietHoursStart).toBe(start)
      expect(resolved.quietHoursEnd).toBe(end)
    },
  )
})
