// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import * as SettingsPlugin from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import { ArchivedSessionsSection } from '../src/client/ArchivedSessionsSection.tsx'
import type { ArchivedSessionsSectionInjected } from '../src/client/ArchivedSessionsSection.tsx'
import { apply as hostApply } from '../src/index.ts'

usePinnedBrowserLanguages('zh-CN')
const contexts: Context[] = []
afterEach(async () => {
  cleanup()
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const unarchiveSession = vi.fn<(sessionId: SessionId) => Promise<void>>(async () => {})
  ctx.provide('uiWorkspace', { unarchiveSession })
  new TestRemote(ctx, { settings: { describe: async () => ({
    ok: true, value: { namespaces: [], hasDocument: false, writable: true },
  }) } })
  await ctx.plugin(SettingsPlugin).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, unarchiveSession }
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

describe('ui-settings-unarchive-sessions browser plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the services used by the page and the archive write', () => {
    expect(inject).toEqual(['slots', 'locale', 'uiWorkspace', 'settingsMetadata'])
  })

  it('registers the archived-session page last with localized copy', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const entry = b.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(ArchivedSessionsSection)
    expect(entry.options).toMatchObject({ id: 'archived-sessions', order: 25 })
    expect(entry.locale).toBe('settings.archivedSessions')
    expect(resolveSlotLabel(entry.options.label)).toBe('已归档会话')
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({
      sections: [{ sectionId: 'archived-sessions', groupId: 'personal' }],
      items: [{
        sectionId: 'archived-sessions', id: 'restore', anchorId: 'archived-sessions-search',
        title: '已归档会话', description: '搜索已归档会话', keywords: ['取消归档', '恢复会话'],
      }],
    })
    expect(b.slots.entries('settings.section.icon')).toHaveLength(1)

    b.locale.setLocale('en')
    expect(resolveSlotLabel(b.slots.entries('settings.section')[0]!.options.label)).toBe('Archived sessions')
    expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.keywords).toEqual(['Unarchive', 'Restore sessions'])

    const injected = (entry.inject as unknown as () => ArchivedSessionsSectionInjected)()
    await expect(injected.unarchive('session-one' as SessionId)).resolves.toBeUndefined()
    expect(b.unarchiveSession).toHaveBeenCalledWith('session-one')
    await b.ctx.fiber.dispose()
  })

  it('follows a late declaration and a declarer reload', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const stop = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })

    stop()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    declare(b.slots)
    await vi.waitFor(() => {
      expect(b.slots.entries('settings.section')[0]?.component).toBe(ArchivedSessionsSection)
    })

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(0)
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(() => b.locale.register('settings.archivedSessions', 'zh', {})).not.toThrow()
    await b.ctx.fiber.dispose()
  })
})
