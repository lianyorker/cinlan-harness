// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import type { WorkItemsSectionInjected } from '../src/client/WorkItemsSection.tsx'
import type { WorkItemsSettings } from '../src/types.ts'
import { en, zh } from '../src/client/locales.ts'

async function harness() {
  const ctx = new Context()
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const scope = stubSettingsScope<WorkItemsSettings>()
  scope.publish({ status: 'ready', value: { githubVisible: true, gitlabVisible: true, linearVisible: true }, writable: true, user: { githubVisible: true } })
  const remote = {
    list: vi.fn().mockResolvedValue({ ok: true, value: { items: [], truncated: false } }),
    get: vi.fn(), associate: vi.fn(), disassociate: vi.fn(),
    prepareWrite: vi.fn(), confirmWrite: vi.fn(), cancelWrite: vi.fn(), listWrites: vi.fn(),
  }
  const integrationPreflight = {
    check: vi.fn().mockResolvedValue({ ok: true, value: { provider: 'github', status: 'connected', reason: 'connected', account: 'private-account' } }),
  }
  ctx.provide('remote', { workItems: remote, integrationPreflight } as unknown as TypertClientRemote)
  ctx.provide('remote.workItems', remote as unknown as TypertClientRemote['workItems'])
  ctx.provide('remote.integrationPreflight', integrationPreflight as unknown as TypertClientRemote['integrationPreflight'])
  ctx.provide('settingsScope', { bind: vi.fn(() => scope.scope) } as never)
  ctx.provide('settings', { register: vi.fn() } as never)
  await ctx.plugin(SlotRegistry).await()
  const declare = () => ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
  return { ctx, locale, scope, remote, integrationPreflight, declare }
}
function callbacks(ctx: Context): WorkItemsSectionInjected {
  const entry = ctx.slots.entries('settings.section').find(row => row.options.id === 'workItems')!
  return (entry.inject as unknown as () => WorkItemsSectionInjected)()
}

describe('Work Items registration', () => {
  it('registers localized public fields only while the section declaration is live', async () => {
    const { ctx, locale, declare } = await harness()
    try {
      const fiber = ctx.plugin({ inject, apply })
      await fiber.await()
      expect(ctx.settingsMetadata.getSnapshot().items).toEqual([])
      let removeOwner = declare()
      await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(17) })
      const english = ctx.settingsMetadata.getSnapshot()
      expect(english.sections).toEqual([{ sectionId: 'workItems', groupId: 'development' }])
      expect(english.items.find(item => item.id === 'write-state')).toMatchObject({ anchorId: 'work-items-write-state', title: en.writeStateValue, description: en.writeStateHelp })
      expect(new Set(english.items.map(item => item.anchorId)).size).toBe(17)
      locale.setLocale('zh')
      await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().items.find(item => item.id === 'write-state')?.title).toBe(zh.writeStateValue) })
      expect(JSON.stringify(ctx.settingsMetadata.getSnapshot())).not.toContain('private-account')
      for (let round = 0; round < 2; round++) {
        removeOwner()
        await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] }) })
        removeOwner = declare()
        await vi.waitFor(() => { expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(17) })
      }
      await fiber.dispose()
      expect(ctx.slots.entries('settings.section')).toHaveLength(0)
      expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
      const reloaded = ctx.plugin({ inject, apply })
      await reloaded.await()
      expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(17)
      expect(ctx.settingsMetadata.getSnapshot().items.find(item => item.id === 'source')?.title).toBe(zh.source)
      hostApply(ctx)
    } finally { await ctx.fiber.dispose() }
  })

  it('forwards exact Remote requests and cancellation, including classified errors', async () => {
    const { ctx, remote, integrationPreflight, declare } = await harness()
    try {
      declare()
      await ctx.plugin({ inject, apply }).await()
      const injected = callbacks(ctx)
      const signal = new AbortController().signal
      await expect(injected.list({ source: 'gitlab', query: 'bug', cursor: '2' }, signal)).resolves.toEqual({ items: [], truncated: false })
      expect(remote.list).toHaveBeenCalledWith({ source: 'gitlab', query: 'bug', cursor: '2' }, signal)
      for (const method of ['get', 'associate', 'disassociate', 'prepareWrite', 'confirmWrite', 'cancelWrite', 'listWrites'] as const) {
        const request = { id: 'issue', operationId: 'preview', source: 'linear', limit: 20 } as never
        remote[method].mockResolvedValue({ ok: true, value: { receipt: method } })
        await expect(injected[method](request, signal)).resolves.toEqual({ receipt: method })
        expect(remote[method]).toHaveBeenCalledWith(request, signal)
      }
      await injected.checkIntegration('github', signal)
      expect(integrationPreflight.check).toHaveBeenCalledWith({ provider: 'github' }, signal)
      remote.list.mockResolvedValue({ ok: false, error: { code: 'work-items/operation-failed', message: 'unavailable', details: { providerCode: 'configured-missing' } } })
      await expect(injected.list({}, signal)).rejects.toThrow(en.unavailable)
      remote.get.mockResolvedValue({ ok: false, error: { code: 'work-items/operation-failed', message: 'forbidden', details: { providerCode: 'forbidden' } } })
      await expect(injected.get({ id: 'github:one' as never }, signal)).rejects.toThrow('forbidden')
      integrationPreflight.check.mockResolvedValue({ ok: false, error: { code: 'unavailable', message: 'offline' } })
      await expect(injected.checkIntegration('gitlab', signal)).rejects.toThrow('offline')
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses success when a rejected visibility request already matches the snapshot', async () => {
    const { ctx, scope, declare } = await harness()
    try {
      declare()
      await ctx.plugin({ inject, apply }).await()
      const injected = callbacks(ctx)
      const mutate = vi.spyOn(scope.scope, 'mutate').mockResolvedValue(false)
      await expect(injected.setVisibility('githubVisible', true)).rejects.toThrow(en.visibilityFailed)
      mutate.mockImplementationOnce(async () => { scope.publish({ user: undefined }); return false })
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow(en.visibilityFailed)
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow(en.visibilityFailed)
      mutate.mockRejectedValueOnce(new Error('transport failed'))
      await expect(injected.setVisibility('githubVisible', true)).rejects.toThrow('transport failed')
      mutate.mockRejectedValueOnce(new Error('transport failed'))
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow('transport failed')
    } finally { await ctx.fiber.dispose() }
  })

  it('requires raw and effective readback after acceptance, including reset absence', async () => {
    const { ctx, scope, declare } = await harness()
    try {
      declare()
      await ctx.plugin({ inject, apply }).await()
      const injected = callbacks(ctx)
      const mutate = vi.spyOn(scope.scope, 'mutate').mockResolvedValue(true)
      await expect(injected.setVisibility('githubVisible', false)).rejects.toThrow(en.visibilityFailed)
      await expect(injected.setVisibility('githubVisible', true)).resolves.toBeUndefined()
      scope.publish({ user: { githubVisible: false } })
      await expect(injected.setVisibility('githubVisible', true)).rejects.toThrow(en.visibilityFailed)
      scope.publish({ user: undefined })
      await expect(injected.setVisibility('githubVisible', true)).rejects.toThrow(en.visibilityFailed)
      scope.publish({ user: { githubVisible: true } })
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow(en.visibilityFailed)
      scope.publish({ user: undefined })
      await expect(injected.resetVisibility('githubVisible')).resolves.toBeUndefined()
      scope.publish({ status: 'unavailable' })
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow(en.visibilityFailed)
      expect(mutate).toHaveBeenCalledTimes(7)
    } finally { await ctx.fiber.dispose() }
  })

  it('checks accepted visibility after settlement and resets by clearing the user override', async () => {
    const { ctx, scope, declare } = await harness()
    try {
      declare()
      await ctx.plugin({ inject, apply }).await()
      const injected = callbacks(ctx)
      expect(injected.hooks.settings).toBe(scope.scope)
      const mutate = vi.spyOn(scope.scope, 'mutate').mockResolvedValue(false)
      await expect(injected.setVisibility('githubVisible', false)).rejects.toThrow(en.visibilityFailed)
      expect(mutate).toHaveBeenCalledWith([{ op: 'set', path: ['githubVisible'], value: false }])
      mutate.mockImplementationOnce(async () => {
        scope.publish({ value: { githubVisible: false, gitlabVisible: true, linearVisible: true }, user: { githubVisible: false } })
        return true
      })
      await expect(injected.setVisibility('githubVisible', false)).resolves.toBeUndefined()
      await expect(injected.resetVisibility('githubVisible')).rejects.toThrow(en.visibilityFailed)
      mutate.mockImplementationOnce(async () => {
        scope.publish({ user: undefined, value: { githubVisible: true, gitlabVisible: true, linearVisible: true } })
        return true
      })
      await expect(injected.resetVisibility('githubVisible')).resolves.toBeUndefined()
      expect(mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['githubVisible'] }])
      expect(scope.scope.getSnapshot().value?.githubVisible).toBe(true)
      expect(scope.set).not.toHaveBeenCalled()
      expect(scope.unset).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})
