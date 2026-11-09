import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { t } from '../src/client/locales.ts'
import { createSidebarStore } from '../src/client/state.ts'
import { SidebarPreferencesController } from '../src/client/preferences-controller.ts'
import { SIDEBAR_PREFS_DEFAULTS, type SidebarPrefs } from '../src/prefs-shared.ts'

/** Minimal in-memory scope used to exercise the controller's adapter contract. */
function stubScope(initial: SidebarPrefs = { ...SIDEBAR_PREFS_DEFAULTS }) {
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
  const publish = (value: SidebarPrefs): void => {
    snapshot = { ...snapshot, value, user: value, revision: (snapshot.revision ?? 0) + 1 }
    for (const listener of listeners) listener()
  }
  const mutate = vi.fn(async (ops: readonly SettingsPathOpView[]): Promise<boolean> => {
    const next = { ...snapshot.value! }
    for (const operation of ops) {
      if (operation.op === 'set') Object.assign(next, { [operation.path[0]]: operation.value })
    }
    publish(next)
    return true
  })
  const scope: SettingsScope<SidebarPrefs> = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate,
    set: async (field, value) => {
      await mutate([{ op: 'set', path: [field], value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'] }])
    },
    unset: async () => {},
  }
  return { scope, mutate, publish }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('SidebarPreferencesController', () => {
  it('serializes writes and adopts canonical scope values after pending patches settle', async () => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)
    const started = deferred<undefined>()
    const firstWrite = deferred<undefined>()
    host.mutate.mockImplementationOnce(async () => {
      started.resolve(undefined)
      await firstWrite.promise
      return true
    })

    expect(store.getPrefs().defaultWidthPercent).toBe(SIDEBAR_PREFS_DEFAULTS.defaultWidthPercent)
    const first = controller.patch({ defaultWidthPercent: 44 })
    const second = controller.patch({ openByDefault: true })
    await started.promise
    expect(host.mutate).toHaveBeenCalledTimes(1)
    host.publish({ ...SIDEBAR_PREFS_DEFAULTS, defaultWidthPercent: 40 })
    expect(store.getPrefs()).toMatchObject({ defaultWidthPercent: 44, openByDefault: true })
    firstWrite.resolve(undefined)
    await Promise.all([first, second])
    expect(host.mutate.mock.calls).toEqual([
      [[{ op: 'set', path: ['defaultWidthPercent'], value: 44 }]],
      [[{ op: 'set', path: ['openByDefault'], value: true }]],
    ])
    expect(store.getPrefs()).toMatchObject({ defaultWidthPercent: 40, openByDefault: true })

    host.publish({ ...store.getPrefs(), defaultWidthPercent: 51 })
    expect(store.getPrefs().defaultWidthPercent).toBe(51)
    controller.dispose()
  })

  it.each([30, 44])('rejects refusal with recovered width %i and accepts the next write', async (recoveredWidth) => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)
    host.mutate.mockImplementationOnce(async () => {
      host.publish({ ...SIDEBAR_PREFS_DEFAULTS, defaultWidthPercent: recoveredWidth })
      return false
    })

    const rejected = controller.patch({ defaultWidthPercent: 44 })
    expect(store.getPrefs().defaultWidthPercent).toBe(44)
    await expect(rejected).rejects.toThrow(t('settingsWriteRejected'))
    expect(store.getPrefs().defaultWidthPercent).toBe(recoveredWidth)

    await expect(controller.patch({ openByDefault: true })).resolves.toBeUndefined()
    expect(host.mutate).toHaveBeenCalledTimes(2)
    expect(store.getPrefs()).toMatchObject({ defaultWidthPercent: recoveredWidth, openByDefault: true })
    controller.dispose()
  })

  it('persists every field in a patch through one atomic mutation', async () => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)

    await controller.patch({ defaultWidthPercent: 44, openByDefault: true })
    expect(host.mutate).toHaveBeenCalledTimes(1)
    expect(host.mutate).toHaveBeenCalledWith([
      { op: 'set', path: ['defaultWidthPercent'], value: 44 },
      { op: 'set', path: ['openByDefault'], value: true },
    ])
    expect(store.getPrefs()).toMatchObject({ defaultWidthPercent: 44, openByDefault: true })
    controller.dispose()
  })

  it('merges one plugin settings blob without dropping sibling keys', async () => {
    const store = createSidebarStore()
    const host = stubScope()
    const controller = new SidebarPreferencesController(host.scope, store)

    await controller.updatePluginSettings('editor', blob => ({ ...blob, openWith: 'url' }))
    await controller.updatePluginSettings('editor', blob => ({ ...blob, pinned: ['url'] }))

    expect(host.mutate.mock.calls).toEqual([
      [[{ op: 'set', path: ['pluginSettings'], value: { editor: { openWith: 'url' } } }]],
      [[{ op: 'set', path: ['pluginSettings'], value: { editor: { openWith: 'url', pinned: ['url'] } } }]],
    ])
    expect(store.getPrefs().pluginSettings).toEqual({
      editor: { openWith: 'url', pinned: ['url'] },
    })
    controller.dispose()
  })
})
