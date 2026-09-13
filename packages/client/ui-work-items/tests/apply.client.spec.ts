// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { WorkItemsSectionInjected } from '../src/client/WorkItemsSection.tsx'

describe('Work Items registration', () => {
  it('calls the generated Remote face and releases the Settings entry on unload', async () => {
    const ctx = new Context()
    try {
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)
      const remote = {
        list: vi.fn().mockResolvedValue({ ok: true, value: { items: [], truncated: false } }),
        get: vi.fn(), associate: vi.fn(), disassociate: vi.fn(),
        prepareWrite: vi.fn(), confirmWrite: vi.fn(), cancelWrite: vi.fn(), listWrites: vi.fn(),
      }
      ctx.provide('remote', { workItems: remote } as unknown as TypertClientRemote)
      ctx.provide('remote.workItems', remote as unknown as TypertClientRemote['workItems'])
      await ctx.plugin(SlotRegistry).await()
      ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
      const fiber = ctx.plugin({ inject, apply })
      await fiber.await()
      const entry = ctx.slots.entries('settings.section').find(row => row.options.id === 'workItems')!
      const callbacks = (entry.inject as unknown as () => WorkItemsSectionInjected)()
      const signal = new AbortController().signal
      await expect(callbacks.list({ source: 'github' }, signal)).resolves.toEqual({ items: [], truncated: false })
      expect(remote.list).toHaveBeenCalledWith({ source: 'github' }, signal)
      remote.list.mockResolvedValue({ ok: false, error: { code: 'work-items/operation-failed', message: 'unavailable', details: { providerCode: 'configured-missing' } } })
      await expect(callbacks.list({}, signal)).rejects.toThrow('check Provider configuration')
      remote.get.mockResolvedValue({ ok: false, error: { code: 'work-items/operation-failed', message: 'forbidden', details: { providerCode: 'forbidden' } } })
      await expect(callbacks.get({ id: 'github:one' as never }, signal)).rejects.toThrow('forbidden')
      hostApply()
      await fiber.dispose()
      expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
