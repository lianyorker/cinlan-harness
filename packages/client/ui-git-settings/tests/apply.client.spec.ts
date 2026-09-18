/** Git section and public metadata follow the same declaration and locale lifetime. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { apply, inject } from '../src/client/index.ts'
import { GitSettingsSection, type GitSettingsSectionInjected } from '../src/client/GitSettingsSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import { settingsFixture } from './settings-fixture.client.ts'

it('declares only the services the contributor uses', () => {
  expect(inject).toEqual(['settingsMetadata', 'slots', 'locale', 'settingsScope'])
})

describe('Git settings contribution', () => {
  it('registers six localized field targets and releases them on declaration collapse and plugin disposal', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    new SettingsMetadataService(ctx)
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const fixture = settingsFixture()
    ctx.provide('settingsScope', { bind: () => fixture.scope } as never)
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    const declare = () => slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
    } } as never, () => null)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    const release = declare()
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(GitSettingsSection)
    expect(entry.options).toMatchObject({ id: 'git-source-control', order: 36 })
    const face = (entry.inject as unknown as () => GitSettingsSectionInjected)()
    expect(face.hooks.settings).toBe(fixture.scope)
    expect(ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'git-source-control', groupId: 'development' }])
    expect(ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
      'git-branch-prefix', 'git-custom-prefix', 'git-update-base', 'git-group-order', 'git-upstream', 'git-attribution',
    ])
    locale.setLocale('en')
    expect(ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(en.branchPrefixTitle)
    locale.setLocale('zh')
    expect(ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.branchPrefixTitle)
    expect(fixture.mutate).not.toHaveBeenCalled()
    release()
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    declare()
    expect(ctx.settingsMetadata.getSnapshot().items).toHaveLength(6)
    await fiber.dispose()
    expect(ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(slots.entries('settings.section.icon')).toEqual([])
  })
})
