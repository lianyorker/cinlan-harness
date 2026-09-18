// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { IntegrationsSection, type IntegrationsSectionInjected } from '../src/client/IntegrationsSection.tsx'
import { en, zh } from '../src/client/locales.ts'

async function bench() {
  const ctx = new Context()
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const integrationPreflight = {
    check: vi.fn(async (_req: { provider: string }) => ({
      ok: true as const,
      value: { provider: 'github', status: 'connected', reason: 'connected', account: 'octocat' },
    })),
  }
  ctx.provide('remote', { integrationPreflight, $host: { home: undefined, isLoopback: true }, $on: () => () => {} } as never)
  ctx.provide('remote.integrationPreflight', integrationPreflight as never)
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, slots: ctx.slots, integrationPreflight }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.section.icon': { kind: 'keyed', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-integrations registration', () => {
  it('declares the Remote namespaces it reads', () => {
    expect(inject).toEqual(['settingsMetadata', 'slots', 'locale', 'remote', 'remote.integrationPreflight'])
  })

  it('registers one localized section and icon, without eager reads', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(IntegrationsSection)
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'integrations', groupId: 'development' }])
    expect(section.options).toMatchObject({ id: 'integrations', order: 40 })
    expect(section.locale).toBe('settings.integrations')
    expect(resolveSlotLabel(section.options.label)).toBe(zh.nav)

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe(en.nav)

    expect(b.integrationPreflight.check).not.toHaveBeenCalled()
    expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
      'integrations-github', 'integrations-gitlab', 'integrations-gitee', 'integrations-refresh',
    ])
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(en.githubTitle)

    const icons = b.slots.entries('settings.section.icon')
    expect(icons).toHaveLength(1)
    expect(icons[0]!.options.key).toBe('integrations')
    expect(icons[0]!.component).toBe(IconLinkOutline16)

    hostApply()
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(b.slots.entries('settings.section.icon')).toEqual([])
    await b.ctx.fiber.dispose()
  })
})

describe('IntegrationsSection injected face', () => {
  it('calls remote.integrationPreflight.check and returns the snapshot', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const section = b.slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => IntegrationsSectionInjected)()

    const signal = new AbortController().signal
    const result = await injected.check('github', signal)
    expect(result).toEqual({ provider: 'github', status: 'connected', reason: 'connected', account: 'octocat' })
    expect(b.integrationPreflight.check).toHaveBeenCalledWith({ provider: 'github' }, signal)
    await b.ctx.fiber.dispose()
  })

  it('surfaces a Remote failure message from the check callback', async () => {
    const ctx = new Context()
    new SettingsMetadataService(ctx)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const integrationPreflight = {
      check: vi.fn(async () => ({ ok: false as const, error: { code: 'gateway/internal', message: 'probe offline', details: {} } })),
    }
    ctx.provide('remote', { integrationPreflight, $host: { home: undefined, isLoopback: true }, $on: () => () => {} } as never)
    ctx.provide('remote.integrationPreflight', integrationPreflight as never)
    await ctx.plugin(SlotRegistry).await()
    declare(ctx.slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const section = ctx.slots.entries('settings.section')[0]!
    const injected = (section.inject as unknown as () => IntegrationsSectionInjected)()
    await expect(injected.check('gitlab', new AbortController().signal)).rejects.toThrow('probe offline')
    await ctx.fiber.dispose()
  })
})
