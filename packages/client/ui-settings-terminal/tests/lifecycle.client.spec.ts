// @vitest-environment jsdom
/** Registration lifetime and mutation confirmation for the terminal settings contribution. */
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { SIDEBAR_PREFS_DEFAULTS } from '@deepseek-ai/dsh-client-ui-better-sidebar/src/prefs-shared.ts'
import * as plugin from '../src/client/index.ts'
import type { TerminalSettingsInjected } from '../src/client/TerminalSettingsSection.tsx'

async function bench() {
  const ctx = new Context()
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const snapshot: SettingsScopeSnapshot<SidebarPrefs> = {
    status: 'ready', mode: 'host', writable: true, revision: 3, value: { ...SIDEBAR_PREFS_DEFAULTS }, base: undefined, user: {},
  }
  const mutate = vi.fn(async (..._args: unknown[]) => false)
  ctx.provide('settingsScope', {
    bind: () => ({ getSnapshot: () => snapshot, subscribe: () => () => {}, mutate }),
  } as never)
  ctx.provide('betterSidebar', { getTerminalCapability: async () => ({ status: 'available' }) } as never)
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({ name: 'root', children: {
    'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
  } } as never, () => null)
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  await vi.waitFor(() => { expect(ctx.slots.entries('settings.section')).toHaveLength(1) })
  const entry = ctx.slots.entries('settings.section')[0]!
  const injected = (entry.inject as unknown as () => TerminalSettingsInjected)()
  return { ctx, locale, snapshot, mutate, fiber, entry, injected }
}

describe('terminal settings registration', () => {
  it('localizes public metadata and removes the page, icons, and search items on disposal', async () => {
    const b = await bench()
    try {
      expect(resolveSlotLabel(b.entry.options.label)).toBe('Terminal')
      expect(b.ctx.settingsMetadata.getSnapshot().sections).toContainEqual({ sectionId: 'terminal', groupId: 'experimental' })
      expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toContain('shell-arguments')
      b.locale.setLocale('zh')
      expect(resolveSlotLabel(b.entry.options.label)).toBe('终端')
      await b.fiber.dispose()
      expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
      expect(b.ctx.slots.entries('settings.section.icon')).toHaveLength(0)
      expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    } finally { await b.ctx.fiber.dispose() }
  })

  it('requires queue acceptance and matching raw values; no-op choices do not save', async () => {
    const b = await bench()
    try {
      await expect(b.injected.save({ terminalFontSize: 13 }, 3)).rejects.toThrow()
      b.snapshot.user = { terminalShell: '/custom/shell' }
      await expect(b.injected.reset(3)).rejects.toThrow()
      b.mutate.mockImplementationOnce(async () => {
        b.snapshot.value = { ...b.snapshot.value!, terminalFontSize: 20 }
        b.snapshot.user = { terminalFontSize: 20 }
        return true
      })
      await expect(b.injected.save({ terminalFontSize: 20 }, 3)).resolves.toBe(true)
      expect(b.mutate).toHaveBeenLastCalledWith([{ op: 'set', path: ['terminalFontSize'], value: 20 }], 3)
      const calls = b.mutate.mock.calls.length
      await expect(b.injected.save({ terminalFontSize: 20 }, 4)).resolves.toBe(false)
      expect(b.mutate).toHaveBeenCalledTimes(calls)
      b.mutate.mockImplementationOnce(async () => { b.snapshot.user = { openByDefault: true }; return true })
      await expect(b.injected.reset(4)).resolves.toBe(true)
      expect(b.mutate.mock.lastCall?.[0]).toEqual(expect.arrayContaining([{ op: 'unset', path: ['terminalShell'] }]))
      await expect(b.injected.reset(5)).resolves.toBe(false)
      expect(b.snapshot.user).toEqual({ openByDefault: true })
    } finally { await b.ctx.fiber.dispose() }
  })
})
