// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { PluginManagerTab } from '../src/client/PluginManagerTab.tsx'
import type { PluginManagerFace } from '../src/client/manager-store.ts'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function bench(remotes = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const list = vi.fn().mockResolvedValue({ ok: true, value: { entries: [], managementAvailable: true } })
  const remote = remotes ? new TestRemote(ctx, {
    pluginInventory: { list },
    pluginManager: {
      listBundles: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      listPlugins: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
  }) : undefined
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, list, remote }
}

function declare(slots: SlotRegistry) {
  return slots.register({ name: 'root', children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } } } as never, () => null)
}

function face(slots: SlotRegistry): PluginManagerFace {
  return (slots.entries('settings.plugins.tab').find(entry => entry.options.id === 'management')!.inject as unknown as () => PluginManagerFace)()
}

describe('Settings management registration', () => {
  it.each([
    { url: 'dsh-app://app/index.html', native: true },
    { url: 'https://app/index.html', native: false },
    { url: 'dsh-app://app:42/index.html', native: false },
    { url: 'dsh-app://shell/plugin-manager.html', native: false },
  ])('uses the native opener only in the app renderer: $url', async ({ url, native }) => {
    vi.stubGlobal('location', new URL(url))
    const openPlugins = vi.fn(async () => {})
    vi.stubGlobal('dshDesktop', { protocolVersion: 1, openPlugins })
    const b = await bench()
    try {
      declare(b.slots)
      await b.ctx.plugin({ inject, apply }).await()
      const injected = face(b.slots)
      injected.ensure()
      await vi.waitFor(() => { expect(injected.hooks.pluginManager.getSnapshot().status).toBe('ready') })
      injected.openInstall()
      expect(openPlugins).toHaveBeenCalledTimes(native ? 1 : 0)
      expect(injected.hooks.pluginManager.getSnapshot().install.open).toBe(!native)
    } finally { await b.ctx.fiber.dispose() }
  })

  it('keeps the Host entry inert and does not require remote availability', () => {
    expect(hostApply).not.toThrow()
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers after existing tabs, reads lazily, refreshes on Host changes and disposes', async () => {
    const b = await bench()
    try {
      declare(b.slots)
      b.slots.register({ name: 'settings.plugins.tab', id: 'configurable', order: 0 }, () => null)
      b.slots.register({ name: 'settings.plugins.tab', id: 'all', order: 10 }, () => null)
      const fiber = b.ctx.plugin({ inject, apply })
      await fiber.await()
      expect(b.slots.entries('settings.plugins.tab').map(entry => entry.options.id)).toEqual(['configurable', 'all', 'management'])
      const entry = b.slots.entries('settings.plugins.tab')[2]!
      expect(entry.component).toBe(PluginManagerTab)
      expect(entry.options.order).toBe(20)
      expect(resolveSlotLabel(entry.options.label)).toBe('管理')
      expect(b.slots.spec('plugins.row.config')).toMatchObject({ kind: 'keyed', scope: 'root' })
      expect(b.list).not.toHaveBeenCalled()
      const injected = face(b.slots)
      injected.ensure()
      await vi.waitFor(() => { expect(injected.hooks.pluginManager.getSnapshot().status).toBe('ready') })
      b.remote!.emit('plugin-manager/changed', [{ reason: 'bundle' }])
      await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(2) })
      b.ctx.emit('connection/reset')
      await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(3) })
      b.locale.setLocale('en')
      expect(resolveSlotLabel(entry.options.label)).toBe('Management')
      await fiber.dispose()
      expect(b.slots.entries('settings.plugins.tab').map(row => row.options.id)).toEqual(['configurable', 'all'])
      expect(b.slots.spec('plugins.row.config')).toBeUndefined()
    } finally { await b.ctx.fiber.dispose() }
  })

  it('keeps the tab available without remote services and survives slot redeclaration', async () => {
    const b = await bench(false)
    try {
      const fiber = b.ctx.plugin({ inject, apply })
      await fiber.await()
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
      const stop = declare(b.slots)
      await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
      const injected = face(b.slots)
      injected.ensure()
      await vi.waitFor(() => { expect(injected.hooks.pluginManager.getSnapshot().status).toBe('unavailable') })
      stop()
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
      declare(b.slots)
      await vi.waitFor(() => { expect(b.slots.entries('settings.plugins.tab')).toHaveLength(1) })
      await fiber.dispose()
      expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    } finally { await b.ctx.fiber.dispose() }
  })
})
