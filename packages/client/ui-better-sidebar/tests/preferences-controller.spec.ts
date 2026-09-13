import { describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSidebarStore } from '../src/client/state.ts'
import { SidebarPreferencesController } from '../src/client/preferences-controller.ts'
import { SIDEBAR_PREFS_DEFAULTS, type SidebarPrefs } from '../src/prefs-shared.ts'

/** Minimal in-memory scope used to exercise the controller's adapter contract. */
function stubScope(initial: SidebarPrefs = { ...SIDEBAR_PREFS_DEFAULTS }): {
  scope: SettingsScope<SidebarPrefs>
  writes: Array<[string, unknown]>
  publish: (value: SidebarPrefs) => void
} {
  let snapshot: SettingsScopeSnapshot<SidebarPrefs> = {
    status: 'ready',
    value: initial,
    base: undefined,
    user: initial,
    revision: 0,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const writes: Array<[string, unknown]> = []
  const publish = (value: SidebarPrefs): void => {
    snapshot = { ...snapshot, value, user: value, revision: (snapshot.revision ?? 0) + 1 }
    for (const listener of listeners) listener()
  }
  const scope: SettingsScope<SidebarPrefs> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: async (field, value) => {
      writes.push([field, value])
      publish({ ...snapshot.value!, [field]: value })
    },
    unset: async () => {},
  }
  return { scope, writes, publish }
}

describe('SidebarPreferencesController', () => {
  it('adopts the scope value and serializes top-level writes', async () => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)

    expect(store.getPrefs().defaultWidthPercent).toBe(SIDEBAR_PREFS_DEFAULTS.defaultWidthPercent)
    const first = controller.patch({ defaultWidthPercent: 44 })
    const second = controller.patch({ openByDefault: true })
    await Promise.all([first, second])
    expect(host.writes).toEqual([
      ['defaultWidthPercent', 44],
      ['openByDefault', true],
    ])
    expect(store.getPrefs()).toMatchObject({ defaultWidthPercent: 44, openByDefault: true })

    host.publish({ ...store.getPrefs(), defaultWidthPercent: 51 })
    expect(store.getPrefs().defaultWidthPercent).toBe(51)
    controller.dispose()
  })

  it('merges one plugin settings blob without dropping sibling keys', async () => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)

    await controller.updatePluginSettings('editor', blob => ({ ...blob, openWith: 'url' }))
    await controller.updatePluginSettings('editor', blob => ({ ...blob, pinned: ['url'] }))

    expect(host.writes.map(([, value]) => value)).toEqual([
      { editor: { openWith: 'url' } },
      { editor: { openWith: 'url', pinned: ['url'] } },
    ])
    expect(store.getPrefs().pluginSettings).toEqual({
      editor: { openWith: 'url', pinned: ['url'] },
    })
    controller.dispose()
  })
})
