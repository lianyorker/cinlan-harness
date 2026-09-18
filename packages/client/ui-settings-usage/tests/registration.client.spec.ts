/** Effect lifetime, localized metadata and honest Remote availability. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { UsageSection, type UsageSectionInjected } from '../src/client/UsageSection.tsx'
import { report, request } from './fixtures.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  await ctx.plugin({ apply: (inner: Context) => { new SettingsMetadataService(inner) } }).await()
  return { ctx, locale, slots: ctx.get('slots') as SlotRegistry }
}
function declare(slots: SlotRegistry) {
  return slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
}
function face(slots: SlotRegistry) {
  const entry = slots.entries('settings.section')[0]!
  return (entry.inject as unknown as () => UsageSectionInjected)()
}

describe('Usage registration', () => {
  it('registers after the owner declaration and keeps labels/search copy locale-owned', async () => {
    const { ctx, locale, slots } = await bench()
    hostApply(ctx)
    await ctx.plugin({ inject, apply }).await()
    expect(slots.entries('settings.section')).toEqual([])
    const close = declare(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(UsageSection)
    expect(entry.options).toMatchObject({ id: 'usage' })
    expect(entry.locale).toBe('settings.usage')
    expect(resolveSlotLabel(entry.options.label)).toBe('Usage')
    expect(ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'usage', groupId: 'experimental' }])
    expect(ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
      'usage-filters', 'usage-overview', 'usage-coverage', 'usage-export',
    ])
    const version = slots.getVersion('settings.section')
    locale.setLocale('zh')
    expect(resolveSlotLabel(entry.options.label)).toBe('使用统计')
    expect(ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe('统计筛选')
    expect(slots.getVersion('settings.section')).toBe(version)
    close()
    await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().sections).toEqual([]) })
    declare(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
  })

  it('cleans section, metadata, dictionaries and source work on plugin disposal', async () => {
    const { ctx, slots, locale } = await bench()
    declare(slots)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    const injected = face(slots)
    expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'unavailable' })
    await fiber.dispose()
    expect(slots.entries('settings.section')).toEqual([])
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(() => locale.register('settings.usage', 'en', {})).not.toThrow()
    await injected.load(request)
    expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'unavailable' })
  })

  it('uses the injected real method signature only during Remote availability', async () => {
    const { ctx, slots } = await bench()
    declare(slots)
    await ctx.plugin({ inject, apply }).await()
    const injected = face(slots)
    await injected.load(request)
    expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'unavailable' })
    const query = vi.fn<ClientRemote['usage']['query']>(async () => ({ ok: true, value: report() }))
    const provider = ctx.plugin({ apply: (inner: Context) => { new TestRemote(inner, { usage: { query } }) } })
    await provider.await()
    await vi.waitFor(() => { expect(injected.hooks.usage.getSnapshot().status).toBe('ready') })
    expect(query.mock.calls[0]![0]).toEqual(request)
    expect(query.mock.calls[0]![1]).toBeInstanceOf(AbortSignal)
    expect(face(slots).hooks.usage).toBe(injected.hooks.usage)
    query.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'private fixture failure', {}) })
    await injected.load(request)
    expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'error' })
    await injected.load(request)
    expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'ready', result: report() })
    await provider.dispose()
    await vi.waitFor(() => { expect(injected.hooks.usage.getSnapshot()).toEqual({ status: 'unavailable' }) })
    expect(slots.entries('settings.section')).toHaveLength(1)
  })
})
