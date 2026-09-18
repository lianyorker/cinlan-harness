/** App-window lifetime and accepted preference effects, independent of rendering. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceSettings } from '../src/types.ts'
import type { FloatingWindowEnvironment, OwnedAppWindow } from '../src/client/window-environment.ts'
import { FloatingRuntime } from '../src/client/runtime.ts'
import { floatingRoute } from '../src/client/window-route.ts'

const defaults: FloatingWorkspaceSettings = {
  enabled: true, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300,
}
const owned: FloatingRuntime[] = []
afterEach(async () => { await Promise.all(owned.splice(0).map(runtime => runtime.dispose())) })

function fixture(options: { child?: boolean; supported?: boolean; enabled?: boolean; writable?: boolean } = {}) {
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
  let closed = false
  const target = { get closed() { return closed }, close: vi.fn(() => { closed = true }) } satisfies OwnedAppWindow
  const restore = vi.fn(), stopWatching = vi.fn(), offExit = vi.fn(), closeSelf = vi.fn()
  const closeWatchers: Array<() => void> = []
  let exit: () => void = () => {}
  const open = vi.fn<FloatingWindowEnvironment['open']>(() => target)
  const environment: FloatingWindowEnvironment = {
    child: options.child ?? false, supported: options.supported ?? true,
    readWindowId: () => options.child === true ? floatingRoute(new URL('https://app.test/?dsh-floating-workspace=1&dsh-floating-owner=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))?.owner : undefined,
    open, closeSelf, captureFocus: () => restore,
    observeClosed: (_target, callback) => { closeWatchers.push(callback); return stopWatching },
    onPageExit: (callback) => { exit = callback; return offExit },
  }
  const runtime = new FloatingRuntime(scope, environment)
  owned.push(runtime)
  return { runtime, scope, publish, mutate, open, target, restore, stopWatching, offExit, closeSelf, watchers,
    closeWatchers, exit: () => { exit() }, externalClose: () => { closed = true }, reopen: () => { closed = false } }
}

describe('floating app-window runtime', () => {
  it('waits for an explicit gesture and uses dimensions from accepted preferences', async () => {
    const f = fixture()
    const first = f.runtime.getSnapshot()
    expect(f.runtime.getSnapshot()).toBe(first)
    expect(f.open).not.toHaveBeenCalled()
    expect(f.runtime.available()).toBe(true)
    f.runtime.toggle()
    expect(f.open).toHaveBeenCalledWith(400, 300)
    expect(f.runtime.getSnapshot().phase).toBe('open')
    await f.runtime.set('floatDefaultWidth', 650)
    expect(f.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['floatDefaultWidth'], value: 650 }])
    expect(f.open).toHaveBeenCalledTimes(1)
    expect(f.runtime.getSnapshot().writeFailed).toBe(false)
    f.runtime.toggle()
    expect(f.target.close).toHaveBeenCalledOnce()
    expect(f.stopWatching).toHaveBeenCalledOnce()
    expect(f.restore).toHaveBeenCalledOnce()
    f.reopen(); f.runtime.toggle()
    expect(f.open).toHaveBeenLastCalledWith(650, 300)
  })

  it('disabling closes only the owned window after the setting is accepted', async () => {
    const f = fixture()
    f.runtime.toggle()
    let finish: ((accepted: boolean) => void) | undefined
    f.mutate.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const write = f.runtime.set('enabled', false)
    expect(f.runtime.getSnapshot().writing).toBe(true)
    expect(f.target.close).not.toHaveBeenCalled()
    await f.runtime.set('floatDefaultWidth', 600)
    expect(f.mutate).toHaveBeenCalledOnce()
    f.publish({ value: { ...defaults, enabled: false }, user: { enabled: false } })
    finish?.(true)
    await write
    expect(f.target.close).toHaveBeenCalledOnce()
    expect(f.runtime.available()).toBe(false)
    f.runtime.toggle()
    expect(f.open).toHaveBeenCalledOnce()
  })

  it('reports blocked or unsupported opening and permits a later explicit retry', () => {
    const f = fixture()
    f.open.mockReturnValueOnce(null)
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('blocked')
    f.open.mockImplementationOnce(() => { throw new DOMException('unsupported') })
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('unavailable')
    f.runtime.toggle()
    expect(f.runtime.getSnapshot().phase).toBe('open')
  })

  it('does not launch from disabled, unsupported, unavailable, or loading preferences', () => {
    const disabled = fixture({ enabled: false })
    disabled.runtime.toggle(); expect(disabled.open).not.toHaveBeenCalled()
    const unsupported = fixture({ supported: false })
    unsupported.runtime.toggle(); unsupported.runtime.close()
    expect(unsupported.runtime.getSnapshot().phase).toBe('unavailable')
    expect(unsupported.open).not.toHaveBeenCalled()
    const loading = fixture()
    loading.publish({ status: 'loading', value: undefined })
    loading.runtime.toggle(); expect(loading.open).not.toHaveBeenCalled()
    loading.publish({ status: 'unavailable' })
    expect(loading.runtime.available()).toBe(false)
  })

  it('a child only closes itself and follows accepted disable without registering another window', () => {
    const f = fixture({ child: true })
    expect(f.runtime.available()).toBe(false)
    f.runtime.toggle()
    expect(f.closeSelf).toHaveBeenCalledOnce()
    expect(f.open).not.toHaveBeenCalled()
    f.publish({ value: { ...defaults, enabled: false } })
    expect(f.closeSelf).toHaveBeenCalledTimes(2)
    f.runtime.setTargetUnavailable(true)
    expect(f.runtime.getSnapshot().targetUnavailable).toBe(true)
    f.exit()
    expect(f.closeSelf).toHaveBeenCalledTimes(3)
  })

  it('closes a child whose preference was already disabled before the runtime mounted', () => {
    const f = fixture({ child: true, enabled: false })
    expect(f.closeSelf).toHaveBeenCalledOnce()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.runtime.terminalContext()?.status).toBe('unavailable')
  })

  it('observes external close, ignores stale observers, and returns source focus once', () => {
    const f = fixture()
    f.runtime.toggle()
    const old = f.closeWatchers[0]
    f.externalClose(); old?.()
    expect(f.target.close).not.toHaveBeenCalled()
    expect(f.restore).toHaveBeenCalledOnce()
    expect(f.runtime.getSnapshot().phase).toBe('closed')
    f.runtime.close()
    expect(f.restore).toHaveBeenCalledOnce()
    f.open.mockReturnValueOnce({ closed: false, close: vi.fn() })
    f.runtime.toggle()
    old?.()
    expect(f.runtime.getSnapshot().phase).toBe('open')
  })

  it('drops a known-closed handle before opening and avoids focus during page exit', () => {
    const f = fixture()
    f.runtime.toggle(); f.externalClose(); f.runtime.toggle()
    expect(f.open).toHaveBeenCalledTimes(2)
    f.exit()
    expect(f.restore).not.toHaveBeenCalled()
    expect(f.stopWatching).toHaveBeenCalledTimes(2)
  })

  it('does not open if a settings subscriber disables the feature during a close transition', () => {
    const f = fixture()
    let intervened = false
    f.runtime.subscribe(() => {
      if (intervened) return
      intervened = true
      f.publish({ value: { ...defaults, enabled: false } })
    })
    f.runtime.toggle()
    expect(f.open).not.toHaveBeenCalled()
  })

  it('does not write a no-op, unsupported directory, or read-only preference', async () => {
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

  it('publishes floating identity before settings load and captures only accepted ready directory values', async () => {
    const f = fixture({ child: true })
    const windowId = f.runtime.terminalContext()?.windowId
    expect(windowId).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    f.publish({ status: 'loading', value: undefined })
    expect(f.runtime.terminalContext()).toEqual({ windowId, status: 'loading' })
    f.publish({ status: 'unavailable' })
    expect(f.runtime.terminalContext()).toEqual({ windowId, status: 'unavailable' })
    f.publish({ status: 'ready', value: { ...defaults, enabled: false } })
    expect(f.runtime.terminalContext()).toEqual({ windowId, status: 'unavailable' })
    f.publish({ value: { ...defaults, terminalDirectory: '/work/child' } })
    expect(f.runtime.terminalContext()).toEqual({ windowId, status: 'ready', directory: '/work/child' })
    const before = f.runtime.terminalContext()
    f.runtime.setDirectorySupported(true)
    expect(f.runtime.getSnapshot().directorySupported).toBe(true)
    await f.runtime.set('terminalDirectory', '/work/other')
    expect(f.runtime.terminalContext()).toEqual({ windowId, status: 'ready', directory: '/work/other' })
    expect(before).toEqual({ windowId, status: 'ready', directory: '/work/child' })
    f.runtime.setDirectorySupported(false)
    expect(f.runtime.getSnapshot().directorySupported).toBe(false)
    expect(fixture().runtime.terminalContext()).toBeUndefined()
    await f.runtime.dispose()
    expect(f.runtime.terminalContext()).toBeUndefined()
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
    expect(f.open).not.toHaveBeenCalled()
  })

  it('disposal closes the exact window, removes listeners, awaits in-flight writes and suppresses late publication', async () => {
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
    expect(f.target.close).toHaveBeenCalledOnce()
    expect(f.watchers.size).toBe(0)
    expect(f.offExit).toHaveBeenCalledOnce()
    await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    off(); finish?.(false)
    await Promise.all([write, disposed])
    expect(f.runtime.getSnapshot()).toBe(last)
    expect(f.runtime.available()).toBe(false)
    await f.runtime.set('enabled', false)
    f.runtime.toggle()
    expect(f.open).toHaveBeenCalledOnce()
  })
})
