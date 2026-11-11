// @vitest-environment jsdom
/**
 * Ownerless-copy registrations inside the assembled web client: the five
 * seats, the `settings` dictionaries, the locale-following nav label, the
 * loopback-only document action over the real settings mirror, and recovery
 * across Loader rebuilds of the declaring chain.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, onTestFinished, vi } from 'vitest'
import { IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { ok, type RemoteMock } from '@deepseek-ai/dsh-remote-mock'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import { createClientTest, type TestClient, webApp } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/index.ts'
import { graphFromRoster } from '@deepseek-ai/dsh-client-test-runtime/src/assembly/roster.ts'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '@deepseek-ai/dsh-client-locale/src/locale-settings.ts'
import { apply, inject } from '../src/client/index.ts'
import type { DeveloperToolsRowInjected } from '../src/client/DeveloperToolsRow.tsx'
import { HostReleasePrompt, type HostReleasePromptInjected } from '../src/client/HostReleasePrompt.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import type { SettingsDocumentActionInjected } from '../src/client/SettingsDocumentAction.tsx'

// These specs assert the shipped Chinese copy. The lane has no jsdom `window`,
// so browser-language detection never runs and a fresh LocaleRuntime opens on
// FALLBACK_LOCALE (en); bench stages zh explicitly on the locale instead.

const SELF = '@deepseek-ai/dsh-client-ui-settings-general'
const SIDEBAR = '@deepseek-ai/dsh-client-ui-sidebar'
const it = createClientTest({ roster: webApp })
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000
/** Dictionary namespace this plugin owns; every seat it fills declares it. */
const NS = 'settings'

/** The seats this plugin fills for a loopback browser (slot name → expected component). */
const SEATS = [
  ['settings.trigger', TriggerContent],
  ['settings.header', HeaderContent],
  ['settings.action', SettingsDocumentAction],
  ['settings.close', CloseLabel],
  ['settings.section', GeneralSection],
] as const

/** One Host view of the locale preference, including its revision fence. */
function localeView(preference: string, revision = 0): SettingsNamespaceView {
  return {
    ns: LOCALE_SETTINGS_NAMESPACE,
    // The Remote wire serializes nested Schema values before the client rehydrates them.
    schema: JSON.parse(JSON.stringify(LocaleSettingsSchema.toJSON())) as SettingsNamespaceView['schema'],
    value: { preference },
    autoGenerate: true, applies: 'live',
    secrets: [],
    revision,
  }
}

async function client(mock: RemoteMock, start: () => Promise<TestClient>, hasDocument = false) {
  const settings = mock.remote.settings
  settings.describe.mockResolvedValue(ok({ writable: true, hasDocument, namespaces: [localeView('zh')] }))
  const c = await start()
  // The locale adopts the Host preference once the describe mirror holds the document.
  await c.ctx.configForms.describe().ensure()
  return { c, settings }
}

/** Unit bench: a bare Context with the slots registry, a zh locale, and the real ui-settings shell over a scripted TestRemote. */
async function bench(isLoopback = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const settingsDescribe = vi.fn(() => Promise.resolve({
    ok: true as const,
    value: {
      writable: true,
      hasDocument: true,
      namespaces: [],
    },
  }))
  const settingsOpenDocument = vi.fn(() => Promise.resolve({
    ok: true as const, value: { opened: true as const },
  }))
  const remote = new TestRemote(ctx, {
    settings: { describe: settingsDescribe, openSettingsDocument: settingsOpenDocument },
  })
  // The fixed Host facts the shell reads its loopback-only action from.
  remote.$host = { home: undefined, isLoopback }
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, settingsDescribe, settingsOpenDocument }
}

/** This plugin's rows in a seat: the list seats also carry feature-owned rows (the product's other sections and actions). */
function ownEntries(c: TestClient, name: (typeof SEATS)[number][0]) {
  return c.ctx.slots.entries(name).filter(entry => entry.locale === NS)
}

function generalEntry(c: TestClient) {
  return ownEntries(c, 'settings.section').find(entry => entry.component === GeneralSection)!
}

function generalLabel(c: TestClient): string | undefined {
  return resolveSlotLabel(generalEntry(c).options.label)
}

function developerToolsRowOf(c: TestClient): DeveloperToolsRowInjected {
  const developerRow = c.ctx.slots.entries('settings.general.item').find(row => row.options.id === 'developer-tools')!
  return (developerRow.inject as unknown as () => DeveloperToolsRowInjected)()
}

function expectSeated(c: TestClient): void {
  for (const [name, component] of SEATS) {
    expect(ownEntries(c, name).map(entry => entry.component)).toEqual([component])
  }
}

/** The page authority the `connection` plugin classifies at apply, reconfigured through the jsdom instance vitest exposes. */
function setPageUrl(url: string): void {
  (globalThis as unknown as { jsdom: { reconfigure(settings: { url: string }): void } }).jsdom.reconfigure({ url })
}

/** Declare the shell's child slots the way ui-settings' entry does. */
function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.trigger': { kind: 'single', scope: 'root' },
        'settings.header': { kind: 'single', scope: 'root' },
        'settings.action': { kind: 'list', scope: 'root' },
        'settings.close': { kind: 'single', scope: 'root' },
        'settings.section': { kind: 'list', scope: 'root' },
        'settings.section.icon': { kind: 'keyed', scope: 'root' },
        'settings.onboarding': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

function generalSlotEntry(slots: SlotRegistry) {
  return slots.entries('settings.section').find(e => e.component === GeneralSection)
}

describe('ui-settings-general apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.settings', 'configForms', 'shortcuts', 'modules', 'remoteAccess', 'settingsScope', 'settingsMetadata'])
  })

  it('fills all five seats for declarations before or after apply', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    for (const [name, component] of SEATS) {
      expect(before.slots.entries(name)[0]!.component).toBe(component)
    }
    const entry = generalSlotEntry(before.slots)!
    expect(entry.options).toMatchObject({ id: 'general', order: 0 })
    const icon = before.slots.entries('settings.section.icon')[0]!
    expect(icon.component).toBe(IconSettingsOutline16)
    expect(icon.options.key).toBe('general')
    // The nav label is a locale-following thunk; owners resolve at read time.
    expect(resolveSlotLabel(entry.options.label)).toBe('通用设置')
    expect(before.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    expect(before.slots.entries('settings.general.item').map(e => e.options.id)).toEqual(['developer-tools', 'current-version'])
    // The onboarding hole stays declared for feature-owned steps; this plugin
    // no longer seats one.
    expect(before.slots.entries('settings.onboarding')).toEqual([])
    const action = before.slots.entries('settings.action')[0]!
    const actionInjected = (action.inject as unknown as () => SettingsDocumentActionInjected)()
    expect(actionInjected.controller.store.getSnapshot().status).toBe('idle')
    expect(actionInjected.hooks.snapshot).toBe(actionInjected.controller.store)
    // Copy rides the standard locale seat: every seat declares the namespace.
    for (const [name] of SEATS) {
      expect(before.slots.entries(name)[0]!.locale).toBe('settings')
    }
    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const [name] of SEATS) expect(after.slots.entries(name)).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    for (const [name, component] of SEATS) {
      expect(after.slots.entries(name)[0]!.component).toBe(component)
      // The self-inflicted ledger notifications hit the duplicate guard.
      expect(after.slots.entries(name)).toHaveLength(1)
    }
    expect(after.slots.entries('settings.section.icon')[0]!.component).toBe(IconSettingsOutline16)
    await vi.waitFor(() => {
      expect(after.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    })
  })

  it('reports a Coding Tools toggle only when a known value changes to the requested one', async ({ mock, start }) => {
    const { c } = await client(mock, start)
    const track = vi.fn()
    c.ctx.provide('productAnalytics', { enabled: true, track } as never)
    const form = c.ctx.configForms.get<{ enabled: boolean }>('ui-settings')
    const snapshot = form.getSnapshot()
    let value: { enabled: boolean } | undefined = { enabled: false }
    let accepted = true
    let now = 100
    const reads = vi.spyOn(form, 'getSnapshot').mockImplementation(() => ({ ...snapshot, value }))
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const write = vi.spyOn(c.ctx.configForms.developerTools, 'setEnabled').mockImplementation(async (enabled) => {
      now += 50
      if (accepted) value = { enabled }
    })
    onTestFinished(() => {
      reads.mockRestore()
      clock.mockRestore()
      write.mockRestore()
    })
    const row = developerToolsRowOf(c)

    // The event carries the click time, before the write settles.
    await row.setEnabled(true)
    expect(track).toHaveBeenCalledExactlyOnceWith('code_work_view_toggle', { is_enabled: true }, 100)

    // Requesting the current value writes but changes nothing.
    await row.setEnabled(true)
    expect(write).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenCalledOnce()

    // A write that settles without the requested value is not a toggle.
    accepted = false
    await row.setEnabled(false)
    expect(value).toEqual({ enabled: true })
    expect(track).toHaveBeenCalledOnce()

    // A rejected write reports its failure and no toggle.
    accepted = true
    write.mockRejectedValueOnce(new Error('not accepted'))
    await expect(row.setEnabled(false)).rejects.toThrow('not accepted')
    expect(track).toHaveBeenCalledOnce()

    // Without a known previous value the change cannot be attributed.
    value = undefined
    await row.setEnabled(false)
    expect(value).toEqual({ enabled: false })
    expect(track).toHaveBeenCalledOnce()

    value = { enabled: true }
    now = 300
    await row.setEnabled(false)
    expect(track).toHaveBeenCalledTimes(2)
    expect(track).toHaveBeenLastCalledWith('code_work_view_toggle', { is_enabled: false }, 300)
  }, COLD_BOOT_TIMEOUT_MS)

  it('registers the zh/en settings dictionaries and frees the seats when its row unloads', async ({ mock, start }) => {
    const { c, settings } = await client(mock, start)
    const english = localeView('en', 1)
    settings.mutate.mockResolvedValueOnce(ok(english))
    const t = c.ctx.locale.bind(NS)
    expect(t('title')).toBe('设置')
    expect(t('connection.error')).toBe('连接异常，刷新重试')
    expect(t('connection.connecting')).toBe('重新连接中')
    expect(t('connection.connected')).toBe('连接成功')
    c.ctx.locale.setLocale('en')
    expect(t('close')).toBe('Close')
    expect(t('connection.reconnect')).toBe('Disconnected, reconnect now')
    expect(t('connection.connecting')).toBe('Reconnecting')
    await vi.waitFor(() => {
      expect(settings.mutate.mock.calls).toEqual([
        [LOCALE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['preference'], value: 'en' }], 0],
      ])
      expect(c.ctx.configForms.describe().getSnapshot().view?.namespaces).toEqual([english])
    })
    await c.unload(SELF)
    await c.flush()
    // The (ns, locale) seats are free again — the dictionary disposer ran.
    expect(() => { c.ctx.locale.register(NS, 'zh', {})() }).not.toThrow()
    expect(() => { c.ctx.locale.register(NS, 'en', {})() }).not.toThrow()
  })

  it('registers the zh/en settings dictionaries and frees the seats on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.locale.bind('settings')('title')).toBe('设置')
    b.locale.setLocale('en')
    expect(b.locale.bind('settings')('close')).toBe('Back to app')
    expect(b.locale.bind('settings')('search.placeholder')).toBe('Search settings...')
    b.locale.setLocale('zh')
    await fiber.dispose()
    // The (ns, locale) seats are free again — the dictionary disposer ran.
    expect(() => b.locale.register('settings', 'zh', {})).not.toThrow()
    expect(() => b.locale.register('settings', 'en', {})).not.toThrow()
  })

  it('the nav label thunk follows the active locale without re-registration', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const zhVersions = SEATS.map(([name]) => b.slots.getVersion(name))
    b.locale.setLocale('en')
    // No ledger churn: freshness rides the thunk (and the renderer's locale
    // subscription), not re-registration.
    SEATS.forEach(([name], i) => {
      expect(b.slots.getVersion(name)).toBe(zhVersions[i]!)
      expect(b.slots.entries(name)).toHaveLength(1)
    })
    expect(resolveSlotLabel(generalSlotEntry(b.slots)!.options.label)).toBe('General')
    b.locale.setLocale('zh')
    expect(resolveSlotLabel(generalSlotEntry(b.slots)!.options.label)).toBe('通用设置')
  })

  it('reads availability from the shared mirror and follows its reconnect refresh', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.action')[0]!
    const { controller } = (entry.inject as unknown as () => SettingsDocumentActionInjected)()
    // The mirror read once at its own boot; the action's load adds no read.
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledOnce() })
    await controller.load()
    expect(b.settingsDescribe).toHaveBeenCalledOnce()
    expect(controller.store.getSnapshot().status).toBe('ready')
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(b.settingsDescribe).toHaveBeenCalledTimes(2) })
  })

  it('keeps Host preferences off-loopback and withholds only the native document action', async ({ mock, start }) => {
    const loopbackUrl = location.href
    setPageUrl('http://198.51.100.7:3000/')
    onTestFinished(() => { setPageUrl(loopbackUrl) })
    const { c, settings } = await client(mock, start)
    expect(c.connection.isLoopback).toBe(false)
    // The stored Host locale applies off-loopback; only the native document
    // action stays loopback-only.
    expect(c.ctx.locale.getSnapshot().active).toBe('zh')
    expect(ownEntries(c, 'settings.action')).toEqual([])
    const english = localeView('en', 1)
    settings.mutate.mockResolvedValueOnce(ok(english))
    c.ctx.locale.setLocale('en')
    await vi.waitFor(() => {
      expect(settings.mutate.mock.calls).toEqual([
        [LOCALE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['preference'], value: 'en' }], 0],
      ])
    })
    await c.unload(SELF)
    await c.flush()
    for (const [name] of SEATS) expect(ownEntries(c, name)).toEqual([])
  })

  it('updates remote locale consumers after Host commits and reconnects', async ({ mock, start }) => {
    const originalUrl = location.href
    setPageUrl('http://198.51.100.7:3000/')
    onTestFinished(() => { setPageUrl(originalUrl) })
    const { c, settings } = await client(mock, start)
    expect(c.connection.isLoopback).toBe(false)
    expect(c.ctx.locale.getSnapshot().active).toBe('zh')
    settings.describe.mockResolvedValue(ok({
      writable: true, hasDocument: false, namespaces: [localeView('en', 1)],
    }))
    await c.mock.streams.opened('$events', 1)
    c.mock.streams.push('$events', {
      type: 'emit', event: 'settings/document-updated', args: [LOCALE_SETTINGS_NAMESPACE, 1],
    })
    await vi.waitFor(() => {
      expect(c.ctx.locale.getSnapshot().active).toBe('en')
      expect(generalLabel(c)).toBe('General')
    })
    settings.describe.mockResolvedValue(ok({
      writable: true, hasDocument: false, namespaces: [localeView('zh', 2)],
    }))
    c.connection.reconnect()
    await c.mock.streams.opened('$events', 2)
    await vi.waitFor(() => {
      expect(c.ctx.locale.getSnapshot().active).toBe('zh')
      expect(generalLabel(c)).toBe('通用设置')
    })
    expect(settings.mutate).not.toHaveBeenCalled()
  })

  it('re-registers after a Loader rebuild of the declaring chain (stale disposers must not block)', async ({ mock, start }) => {
    const { c, settings } = await client(mock, start)
    const before = SEATS.map(([name]) => ownEntries(c, name)[0])
    await c.reload(SIDEBAR)
    await c.flush()
    expectSeated(c)
    SEATS.forEach(([name], index) => {
      expect(ownEntries(c, name)[0]).not.toBe(before[index])
    })
    expect(c.ctx.slots.spec('settings.general.item')).toEqual({ kind: 'list', scope: 'root' })
    expect(c.ctx.slots.entries('settings.general.item').filter(row => row.locale === NS).map(row => row.options.id)).toEqual(['developer-tools', 'current-version'])
    // The recovered registrations still ride the locale path.
    const english = localeView('en', 1)
    const chinese = localeView('zh', 2)
    settings.mutate.mockResolvedValueOnce(ok(english)).mockResolvedValueOnce(ok(chinese))
    c.ctx.locale.setLocale('en')
    expect(generalLabel(c)).toBe('General')
    c.ctx.locale.setLocale('zh')
    expect(generalLabel(c)).toBe('通用设置')
    await vi.waitFor(() => {
      expect(settings.mutate.mock.calls).toEqual([
        [LOCALE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['preference'], value: 'en' }], 0],
        [LOCALE_SETTINGS_NAMESPACE, [{ op: 'set', path: ['preference'], value: 'zh' }], 1],
      ])
      expect(c.ctx.configForms.describe().getSnapshot().view?.namespaces).toEqual([chinese])
    })
  })

  it('removes every seat and the item declaration on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.spec('settings.general.item')).toBeDefined()
    await fiber.dispose()
    for (const [name] of SEATS) expect(b.slots.entries(name)).toHaveLength(0)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(0)
    expect(b.slots.spec('settings.general.item')).toBeUndefined()
  })

  it('asks about another Host release in the shell overlay and stops asking once dismissed', async ({ mock, start }) => {
    const { c } = await client(mock, start)
    const overlay = () => c.ctx.slots.entries('shell.overlay').find(row => row.options.id === 'host-release-change')
    expect(overlay()?.component).toBe(HostReleasePrompt)
    expect(overlay()?.locale).toBe(NS)
    const face = overlay()!.inject!()
    const { dismissRelease, reloadPage, hooks } = face
    if (typeof dismissRelease !== 'function' || typeof reloadPage !== 'function' || typeof hooks !== 'object' || hooks === null) {
      throw new TypeError('host-release-change inject face is incomplete')
    }
    const injected = { dismissRelease, reloadPage, hooks } as HostReleasePromptInjected
    expect(injected.hooks.releaseChange).toBe(c.ctx.modules.entries.releaseChange)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const release = { version: '2.0.0' }
    await c.ctx.modules.entries.sync({ ...graphFromRoster(webApp.rows), release })
    expect(injected.hooks.releaseChange.getSnapshot()).toEqual({ page: undefined, previous: undefined, host: release })
    expect(warn).toHaveBeenCalledOnce()
    injected.dismissRelease()
    expect(injected.hooks.releaseChange.getSnapshot()).toBeUndefined()
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    onTestFinished(() => { vi.unstubAllGlobals() })
    injected.reloadPage()
    expect(reload).toHaveBeenCalledOnce()
    await c.unload(SELF)
    await c.flush()
    expect(overlay()).toBeUndefined()
  })
})
