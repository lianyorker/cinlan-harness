import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Notifications from '../src/index.ts'
import { NOTIFICATIONS_SETTINGS_NAMESPACE } from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

async function bench() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(MemorySettings)
  const fiber = ctx.plugin(Notifications)
  await fiber
  return { ctx, fiber }
}

describe('notifications Host registration', () => {
  it('registers disabled defaults and the local overnight interval, then unregisters with its owner', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.settings.get(NOTIFICATIONS_SETTINGS_NAMESPACE)).toEqual({
      enabled: false, agentCompletion: false, terminalBell: false, sound: 'system', suppressWhenFocused: false, customSoundName: '',
      quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00',
    })
    await fiber.dispose()
    expect(ctx.settings.get(NOTIFICATIONS_SETTINGS_NAMESPACE)).toBeUndefined()
  })

  it.each(['quietHoursStart', 'quietHoursEnd'] as const)('refuses malformed persisted %s without changing accepted preferences', async (field) => {
    const { ctx } = await bench()
    const before = ctx.settings.describe()
    for (const value of ['', '24:00', '12:60', '7:00', '12:00:30']) {
      await expect(ctx.settings.mutate(NOTIFICATIONS_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['quietHoursEnabled'], value: true },
        { op: 'set', path: [field], value },
      ])).rejects.toThrow()
      expect(ctx.settings.describe()).toEqual(before)
    }
  })

  it.each([['23:59', '00:00'], ['00:00', '00:00'], ['08:30', '17:15']] as const)(
    'accepts the complete %s–%s interval in one revision', async (start, end) => {
      const { ctx } = await bench()
      const before = ctx.settings.describe()[0]!
      await ctx.settings.mutate(NOTIFICATIONS_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['quietHoursEnabled'], value: true },
        { op: 'set', path: ['quietHoursStart'], value: start },
        { op: 'set', path: ['quietHoursEnd'], value: end },
      ], before.revision)
      expect(ctx.settings.describe()[0]).toMatchObject({
        revision: before.revision + 1,
        user: { quietHoursEnabled: true, quietHoursStart: start, quietHoursEnd: end },
        value: { quietHoursEnabled: true, quietHoursStart: start, quietHoursEnd: end },
      })
    },
  )
})
