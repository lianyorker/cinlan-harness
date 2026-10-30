/** Settings shell registration: slot declaration injection, the ledger projections, and HMR recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import type { SettingsRootInjected } from '../src/client/shell-contract.ts'
import { SettingsRoot } from '../src/client/SettingsRoot.tsx'

const SELF = '@deepseek-ai/dsh-client-ui-settings-general'
const SIDEBAR = '@deepseek-ai/dsh-client-ui-sidebar'
const it = createClientTest({ roster: webApp })
const withoutSettingsAccess = createClientTest({ roster: webApp }, { access: action => action !== 'settings/describe' })
/** The whole roster's first boot pays the cold module transform of every plugin package. */
const COLD_BOOT_TIMEOUT_MS = 60_000

function injectedOf(slots: SlotRegistry): SettingsRootInjected {
  const entry = slots.entries('sidebar.settings')[0]!
  return (entry.inject as () => SettingsRootInjected)()
}

/** The shell's child declarations (chrome, actions, sections, icons, and onboarding overlays). */
const CHILD_SPECS = {
  'settings.launcher': { kind: 'single', scope: 'root' },
  'settings.trigger': { kind: 'single', scope: 'root' },
  'settings.header': { kind: 'single', scope: 'root' },
  'settings.action': { kind: 'list', scope: 'root' },
  'settings.close': { kind: 'single', scope: 'root' },
  'settings.section': { kind: 'list', scope: 'root' },
  'settings.section.icon': { kind: 'keyed', scope: 'root' },
  'settings.onboarding': { kind: 'list', scope: 'root' },
} as const

describe('ui-settings apply', () => {
  it('declares only the slot registry (a pure composition face, no locale)', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'remote', 'remote.settings', 'configForms', 'settingsScope', 'settingsMetadata',
    ])
  })

  it('registers the shell and declares every child slot, before or after the declaration', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const beforeEntry = before.slots.entries('sidebar.settings')[0]!
    expect(beforeEntry.component).toBe(SettingsRoot)
    expect(beforeEntry.locale).toBe('settings')
    expect(before.slots.entries('settings.section.icon')[0]).toMatchObject({
      component: IconSettingsOutline16,
      options: { key: 'general' },
    })
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(before.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    expect(after.slots.entries('sidebar.settings')).toHaveLength(0)
    declare(after.slots)
    await Promise.resolve()
    expect(after.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsRoot)
    // The self-inflicted ledger notifications hit the duplicate guard.
    expect(after.slots.entries('sidebar.settings')).toHaveLength(1)
  })

  it('projects the section ledger into ordered nav rows with option defaults', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { sections } = injectedOf(b.slots).hooks
    // This package registers the General section itself; every other section
    // arrives from a feature registrant.
    const GENERAL = { id: 'general', order: 0, label: 'general.nav', title: 'general.nav', description: 'general.description', groupId: 'personal', items: [] }
    expect(sections.getSnapshot()).toEqual([GENERAL])
    b.slots.register({ name: 'settings.section', id: 'z', order: 20, label: 'Z' } as never, () => null)
    // No order and no label: both projection defaults apply.
    b.slots.register({ name: 'settings.section', id: 'a' } as never, () => null)
  it('declares its services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'remote.settings', 'configForms', 'shortcuts', 'modules', 'remoteAccess'])
  })

  it('occupies sidebar.settings, declared by ui-sidebar, and declares every child slot', async ({ start }) => {
    const c = await start()
    expect(c.ctx.slots.entries('sidebar.settings').map(entry => entry.component)).toEqual([SettingsRoot])
    for (const name of CHILD_NAMES) expect(c.ctx.slots.spec(name)).toEqual(CHILD_SPECS[name])
  }, COLD_BOOT_TIMEOUT_MS)

  withoutSettingsAccess('leaves sidebar.settings unoccupied while the current Peer may not read the settings description', async ({ start }) => {
    const c = await start()
    expect(c.ctx.slots.entries('sidebar.settings')).toEqual([])
  }, COLD_BOOT_TIMEOUT_MS)

  it('projects the section ledger: product sections in order, defaults for bare rows, stable snapshots', async ({ start }) => {
    const c = await start()
    const { sections } = injectedOf(c).hooks
    const product = sections.getSnapshot()
    expect(product.map(row => row.id)).toEqual(PRODUCT_SECTIONS)
    c.ctx.slots.register({ name: 'settings.section', id: 'z', order: 1_000, label: 'Z' } as never, () => null)
    // No order and no label: both projection defaults apply, and order 0 sorts among the product rows.
    c.ctx.slots.register({ name: 'settings.section', id: 'a' } as never, () => null)
    const rows = sections.getSnapshot()
    expect(rows).toEqual([
      GENERAL,
      { id: 'a', order: 0, label: '', title: '', groupId: 'tools', items: [] },
      { id: 'z', order: 20, label: 'Z', title: 'Z', groupId: 'tools', items: [] },
    ])
    // Snapshot identity is stable until the ledger moves (uSES contract).
    expect(sections.getSnapshot()).toBe(rows)
    const listener = vi.fn()
    const off = sections.subscribe(listener)
    b.slots.register({ name: 'settings.section', id: 'b', order: 1, label: 'B' } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalled()
    expect(sections.getSnapshot()).not.toBe(rows)
    off()
  })

  it('joins field metadata only to mounted sections and republishes changes', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { sections } = injectedOf(b.slots).hooks
    const listener = vi.fn()
    const off = sections.subscribe(listener)
    const metadata = b.ctx.settingsMetadata
    const remove = metadata.registerItems('optional', [{ id: 'connection', anchorId: 'connection', title: () => 'Connection' }])
    expect(sections.getSnapshot()).toHaveLength(1)
    const unregister = b.slots.register({ name: 'settings.section', id: 'optional', label: 'Optional' } as never, () => null)
    expect(sections.getSnapshot().find(row => row.id === 'optional')?.items[0]?.title).toBe('Connection')
    remove()
    expect(sections.getSnapshot().find(row => row.id === 'optional')?.items).toEqual([])
    expect(listener).toHaveBeenCalled()
    unregister()
    expect(sections.getSnapshot()).toHaveLength(1)
    off()
  it('shows Account first only while signed in and removes it on sign-out', async ({ start }) => {
    const c = await start()
    const { sections } = injectedOf(c).hooks
    await c.mock.streams.opened('account/watch', 1)
    expect(sections.getSnapshot().map(row => row.id)).toEqual(PRODUCT_SECTIONS)
    c.mock.streams.push('account/watch', { status: 'credential-stored', attempt: null })
    await vi.waitFor(() => {
      expect(sections.getSnapshot().map(row => row.id)).toEqual(['account', ...PRODUCT_SECTIONS])
    })
    c.mock.streams.push('account/watch', { status: 'credential-stored', attempt: null })
    await vi.waitFor(() => { expect(sections.getSnapshot().filter(row => row.id === 'account')).toHaveLength(1) })
    c.mock.streams.push('account/watch', { status: 'signed-out', attempt: null })
    await vi.waitFor(() => { expect(sections.getSnapshot().map(row => row.id)).toEqual(PRODUCT_SECTIONS) })
  })

  it('projects the roster Connection control without copying its state; reconnect opens a new $events generation', async ({ start }) => {
    const c = await start()
    const injected = injectedOf(c)
    expect(injected.hooks.connectionState).toBe(c.connection.state)
    expect(injected.hooks.connectionState.getSnapshot()).toBe('connected')
    injected.reconnect()
    await c.mock.streams.opened('$events', 2)
    await vi.waitFor(() => { expect(c.connection.state.getSnapshot()).toBe('connected') })
  })

  it('projects onboarding entries into stable coordinator order', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const { onboardingSteps } = injectedOf(b.slots).hooks
    b.slots.register({ name: 'settings.onboarding', id: 'credential', order: 0 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'welcome', order: -100 } as never, () => null)
    b.slots.register({ name: 'settings.onboarding', id: 'default-order' } as never, () => null)
    const steps = onboardingSteps.getSnapshot()
    expect(steps).toEqual([
      { id: 'welcome', order: -100 },
      { id: 'credential', order: 0 },
      { id: 'default-order', order: 0 },
    ])
    expect(onboardingSteps.getSnapshot()).toBe(steps)
    const listener = vi.fn()
    const off = onboardingSteps.subscribe(listener)
    b.slots.register({ name: 'settings.onboarding', id: 'later', order: 10 } as never, () => null)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
    off()
  })

  it('re-registers after an HMR collapse re-declares the slot (stale disposer must not block)', async () => {
    const b = await bench()
    const redeclare = declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(1)
    // Declarer unload: the cascade removes our entry and every child
    // declaration while our local disposer variable goes stale.
    redeclare()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(b.slots.spec('settings.trigger')).toBeUndefined()
    expect(b.slots.entries('settings.section.icon')).toHaveLength(0)
    declare(b.slots)
    await Promise.resolve()
    expect(b.slots.entries('sidebar.settings')[0]!.component).toBe(SettingsRoot)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toEqual(CHILD_SPECS[name])
    }
  })

  it('unregisters the shell and collapses every child slot on teardown', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.settings')).toHaveLength(0)
    expect(b.slots.entries('settings.section.icon')).toHaveLength(0)
    for (const name of Object.keys(CHILD_SPECS) as Array<keyof typeof CHILD_SPECS>) {
      expect(b.slots.spec(name)).toBeUndefined()
    }
  })
})
