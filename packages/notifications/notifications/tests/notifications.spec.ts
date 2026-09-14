import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Notifications from '../src/index.ts'
import { NOTIFICATIONS_SETTINGS_NAMESPACE } from '../src/index.ts'
import { MemorySettings } from '../../../settings/settings/tests/memory.ts'

describe('notifications Host registration', () => {
  it('registers the durable defaults', async () => {
    const ctx = new Context()
    const provider = ctx.plugin(MemorySettings)
    await provider
    const fiber = ctx.plugin(Notifications)
    await fiber
    expect(ctx.settings.get(NOTIFICATIONS_SETTINGS_NAMESPACE)).toEqual({
      enabled: false, agentCompletion: false, terminalBell: false, sound: 'system', suppressWhenFocused: false, customSoundName: '',
    })
    await fiber.dispose()
    await provider.dispose()
  })
})
