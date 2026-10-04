/** Panel lifetime and accepted preference effects, independent of rendering. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceWindowId } from '@deepseek-ai/dsh-sidebar-terminals/types'
import type { FloatingWorkspaceSettings } from '../src/types.ts'
import type { FloatingPanelEnvironment } from '../src/client/runtime.ts'
import { FloatingRuntime } from '../src/client/runtime.ts'

const WINDOW_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as FloatingWorkspaceWindowId
const defaults: FloatingWorkspaceSettings = {
  enabled: true, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300,
}
const owned: FloatingRuntime[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(runtime => runtime.dispose())) })

function fixture(options: { supported?: boolean; enabled?: boolean; writable?: boolean; windowId?: boolean } = {}) {
  let settings: SettingsScopeSnapshot<FloatingWorkspaceSettings> = {
    status: 'ready', value: { ...defaults, enabled: options.enabled ?? true }, user: {}, base: {}, revision: 1,
    mode: 'host', writable: options.writable ?? true,
  }
  const watchers = new Set<() => void>()
  const publish = (patch: Partial<SettingsScopeSnapshot<FloatingWorkspaceSettings>>) => {
    settings = { ...settings, ...patch }
    for (const watch of watchers) watch()
  }
  const mutate = vi.fn<SettingsScope<FloatingWorkspaceSettings>['mutate']>(async (ops) => {
    const values = { ...settings.value }
    const raw = { ...settings.user as Record<string, unknown> }
    for (const op of ops) {
      if (op.op === 'set' && op.path[0] !== undefined) {
        Reflect.set(values, op.path[0], op.value)
        Reflect.set(raw, op.path[0], op.value)
      }
    }
    publish({ value: values as FloatingWorkspaceSettings, user: raw, revision: (settings.revision ?? 0) + 1 })
    return true
  })
  const scope: SettingsScope<FloatingWorkspaceSettings> = {
    getSnapshot: () => settings,
    subscribe: (listener) => { watchers.add(listener); return () => { watchers.delete(listener) } },
    mutate, set: vi.fn(async () => {}), unset: vi.fn(async () => {}),
  }
  const environment: FloatingPanelEnvironment = {
    supported: options.supported ?? true,
    readWindowId: () => options.windowId === true ? WINDOW_ID : undefined,
  }
  const runtime = new FloatingRuntime(scope, environment)
  owned.push(runtime)
  return { runtime, scope, publish, mutate, watchers }
}

describe('floating panel runtime', () => {
  it('starts closed, publishes one identity until a fact moves, and opens on an explicit gesture only', () => {
    const f = fixture()
    const first = f.runtime.getSnapshot()
    expect(f.runtime.getSnapshot()).toBe(first)
    expect(first.phase).toBe('closed')
    expect(first.open).toBe(false)
    expect(f.runtime.available()).toBe(true)
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('open')
    expect(f.runtime.getSnapshot().open).toBe(true)
    f.runtime.close(false)
    expect(f.runtime.getSnapshot().phase).toBe('closed')
    expect(f.runtime.getSnapshot().open).toBe(false)
  })

  it('closes instead of reopening while the panel is on screen', () => {
    const f = fixture()
    f.runtime.toggle()
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('closed')
    f.runtime.close()
    expect(f.runtime.getSnapshot().phase).toBe('closed')
  })

  it('does not open from disabled, unsupported, unavailable, or loading preferences', () => {
    const disabled = fixture({ enabled: false })
    disabled.runtime.toggle()
    expect(disabled.runtime.getSnapshot().phase).toBe('closed')
    expect(disabled.runtime.available()).toBe(false)
    const unsupported = fixture({ supported: false })
    unsupported.runtime.toggle()
    expect(unsupported.runtime.getSnapshot().phase).toBe('unavailable')
    expect(unsupported.runtime.available()).toBe(false)
    unsupported.runtime.close()
    expect(unsupported.runtime.getSnapshot().phase).toBe('unavailable')
    const loading = fixture()
    loading.publish({ status: 'loading', value: undefined })
    loading.runtime.toggle()
    expect(loading.runtime.getSnapshot().phase).toBe('closed')
    loading.publish({ status: 'unavailable' })
    expect(loading.runtime.available()).toBe(false)
  })

  it('closes an open panel after the feature is disabled in accepted preferences', () => {
    const f = fixture()
    f.runtime.toggle()
    f.publish({ value: { ...defaults, enabled: false }, user: { enabled: false } })
    expect(f.runtime.getSnapshot().phase).toBe('closed')
    expect(f.runtime.available()).toBe(false)
  })

  it('writes accepted preferences without relaunching the panel', async () => {
    const f = fixture()
    f.runtime.toggle()
    await f.runtime.set('floatDefaultWidth', 650)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['floatDefaultWidth'], value: 650 }])
    expect(f.runtime.getSnapshot().writeFailed).toBe(false)
    expect(f.runtime.getSnapshot().phase).toBe('open')
  })

  it('does not write a no-op, an unsupported directory, or a read-only preference', async () => {
    const f = fixture()
    await f.runtime.set('enabled', true)
    expect(f.mutate).not.toHaveBeenCalled()
    await f.runtime.set('terminalDirectory', '/outside')
    expect(f.runtime.getSnapshot().writeFailed).toBe(true)
    f.publish({ writable: false })
    await f.runtime.set('enabled', false)
    f.publish({ status: 'loading' })
    await f.runtime.set('enabled', false)
    expect(f.mutate).not.toHaveBeenCalled()
  })

  it('ignores later writes while one is in flight', async () => {
    const f = fixture()
    let finish: ((accepted: boolean) => void) | undefined
    f.mutate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const write = f.runtime.set('floatDefaultWidth', 500)
    await f.runtime.set('floatDefaultHeight', 500)
    expect(f.mutate).toHaveBeenCalledOnce()
    finish?.(true)
    await write
  })

  it('publishes identity only for a renderer that reports one', async () => {
    const main = fixture()
    expect(main.runtime.terminalContext()).toBeUndefined()
    const floating = fixture({ windowId: true })
    expect(floating.runtime.terminalContext()).toMatchObject({ windowId: WINDOW_ID, status: 'ready' })
    floating.publish({ status: 'loading', value: undefined })
    expect(floating.runtime.terminalContext()).toMatchObject({ status: 'loading' })
    floating.publish({ status: 'unavailable' })
    expect(floating.runtime.terminalContext()).toMatchObject({ status: 'unavailable' })
    floating.publish({ status: 'ready', value: { ...defaults, enabled: false } })
    expect(floating.runtime.terminalContext()).toMatchObject({ status: 'unavailable' })
    floating.publish({ value: { ...defaults, terminalDirectory: '/work/child' } })
    expect(floating.runtime.terminalContext()).toMatchObject({ status: 'ready', directory: '/work/child' })
    floating.runtime.setDirectorySupported(true)
    expect(floating.runtime.getSnapshot().directorySupported).toBe(true)
    await floating.runtime.set('terminalDirectory', '/work/other')
    expect(floating.runtime.terminalContext()).toMatchObject({ directory: '/work/other' })
    floating.runtime.setDirectorySupported(false)
    expect(floating.runtime.getSnapshot().directorySupported).toBe(false)
    await floating.runtime.dispose()
    expect(floating.runtime.terminalContext()).toBeUndefined()
  })

  it.each(['refused', 'rejected', 'no-echo', 'raw-mismatch'] as const)('keeps accepted state after a %s write', async (failure) => {
    const f = fixture()
    if (failure === 'refused') f.mutate.mockResolvedValueOnce(false)
    if (failure === 'rejected') f.mutate.mockRejectedValueOnce(new Error('transport'))
    if (failure === 'no-echo') f.mutate.mockResolvedValueOnce(true)
    if (failure === 'raw-mismatch') f.mutate.mockImplementationOnce(async () => {
      f.publish({ value: { ...defaults, floatDefaultWidth: 500 }, user: undefined })
      return true
    })
    await f.runtime.set('floatDefaultWidth', 500)
    expect(f.runtime.getSnapshot().writing).toBe(false)
    expect(f.runtime.getSnapshot().writeFailed).toBe(true)
  })

  it('disposal closes the panel, removes listeners, awaits in-flight writes, and suppresses late publication', async () => {
    const f = fixture()
    const listener = vi.fn()
    const off = f.runtime.subscribe(listener)
    f.runtime.toggle()
    let finish: ((accepted: boolean) => void) | undefined
    f.mutate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const write = f.runtime.set('floatDefaultHeight', 500)
    const last = f.runtime.getSnapshot()
    const done = vi.fn()
    const disposed = f.runtime.dispose().then(done)
    expect(f.watchers.size).toBe(0)
    await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    off(); finish?.(false)
    await Promise.all([write, disposed])
    expect(f.runtime.getSnapshot()).toBe(last)
    expect(f.runtime.available()).toBe(false)
    await f.runtime.set('enabled', false)
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('open')
  })
})
