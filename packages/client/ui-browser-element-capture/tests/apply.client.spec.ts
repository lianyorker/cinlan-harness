// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { TestRemote, RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientRemote, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { BrowserElementCaptureSection } from '../src/client/BrowserElementCaptureSection.tsx'
import type { CaptureInjected } from '../src/client/contract.ts'
import { capture, pages, selection } from './fixtures.client.ts'

async function bench(withBrowser = true) {
  const ctx = new Context()
  const scope = ctx.plugin(() => {}).ctx
  onTestFinished(() => ctx.fiber.dispose())
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const addImageDraft = vi.fn((_image: Parameters<Context['conversation']['addImageDraft']>[0]) => true)
  ctx.provide('conversation', { addImageDraft } as never)
  const sessions = { scope: vi.fn((id: SessionId): Context | undefined => id === 'source' ? scope : undefined) }
  ctx.provide('sessions', sessions as never)
  const browser = {
    pages: vi.fn<ClientRemote['browser']['pages']>().mockResolvedValue({ ok: true, value: pages }),
    selectElement: vi.fn<ClientRemote['browser']['selectElement']>().mockResolvedValue({ ok: true, value: selection }),
    captureElement: vi.fn<ClientRemote['browser']['captureElement']>().mockResolvedValue({ ok: true, value: capture }),
  }
  const mountBrowser = () => ctx.plugin({ apply(owner: Context) { new TestRemote(owner, { browser }) } })
  if (withBrowser) await mountBrowser().await()
  await ctx.plugin(SlotRegistry).await()
  return { ctx, locale, browser, sessions, addImageDraft, mountBrowser, slots: ctx.slots }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

function operations(slots: SlotRegistry): CaptureInjected {
  const entry = slots.entries('settings.section')[0]
  if (entry?.inject === undefined) throw new Error('Capture entry did not provide its operations')
  // Registry inspection erases the contribution-specific injected fields.
  return entry.inject() as Record<string, unknown> & CaptureInjected
}

describe('ui-browser-element-capture registration', () => {
  it('registers localized metadata and removes it with the settings declaration', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])
    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(BrowserElementCaptureSection)
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'browser-element-capture', groupId: 'tools' }])
    expect(resolveSlotLabel(section.options.label)).toBe('元素捕获')
    expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.anchorId)).toEqual([
      'capture-availability', 'capture-page', 'capture-selection', 'capture-image', 'capture-permissions',
    ])
    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Element capture')
    release()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  })

  it('waits for the Browser namespace and follows its unload and remount', async () => {
    const b = await bench(false)
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    expect(b.slots.entries('settings.section')).toEqual([])
    const provider = b.mountBrowser()
    await provider.await()
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(1)
    await provider.dispose()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toEqual([]) })
    await b.mountBrowser().await()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
  })

  it('forwards requests and cancellation and appends only to the named existing draft', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const actions = operations(b.slots)
    const signal = new AbortController().signal
    expect(await actions.pages(signal)).toBe(pages)
    expect(await actions.select(selection.pageId, signal)).toBe(selection)
    const command = { pageId: selection.pageId, selectionId: selection.selectionId }
    expect(await actions.capture(command, signal)).toBe(capture)
    expect(b.browser.pages).toHaveBeenCalledWith(signal)
    expect(b.browser.selectElement).toHaveBeenCalledWith({ pageId: selection.pageId }, signal)
    expect(b.browser.captureElement).toHaveBeenCalledWith(command, signal)
    actions.attach('source' as SessionId, capture)
    expect(b.sessions.scope).toHaveBeenCalledWith('source')
    expect(b.addImageDraft).toHaveBeenCalledWith({ mediaType: 'image/png', data: capture.data, name: 'browser-element.png' })
    b.addImageDraft.mockReturnValueOnce(false)
    expect(() => actions.attach('source' as SessionId, capture)).toThrow('草稿正在提交')
    expect(() => actions.attach('removed' as SessionId, capture)).toThrow('发起操作的会话已不可用')
    expect(b.addImageDraft).toHaveBeenCalledTimes(2)
    b.browser.pages.mockResolvedValueOnce({ ok: false, error: new RemoteError('browser/operation-failed', 'page closed', {}) })
    await expect(actions.pages(signal)).rejects.toThrow('浏览器操作失败：page closed')
  })
})
