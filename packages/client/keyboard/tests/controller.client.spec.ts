import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { KeyboardController } from '../src/client/controller.ts'
import { bindingIdentity, bindingIssue, bindingLabel, captureBinding } from '../src/client/bindings.ts'
import { KeybindingsSettingsSchema } from '../src/settings-schema.ts'
import type { KeyBinding, KeyEventFacts, KeybindingsSettings } from '../src/types.ts'

declare module '../src/client/index.ts' {
  interface KeyboardCommandMap {
    'test.alpha': { scope: 'editor' }
    'test.beta': { scope: 'editor' }
    'test.popup': { scope: 'composer-popup' }
    'test.composer': { scope: 'composer' }
  }
}

const key = (letter: string, modifiers: KeyBinding['modifiers'] = {}): KeyBinding => ({ key: letter, modifiers })
const event = (letter: string, patch: Partial<KeyEventFacts> = {}): KeyEventFacts => ({
  key: letter, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
  isComposing: false, repeat: false, defaultPrevented: false, ...patch,
})

function bench(overrides: KeybindingsSettings['overrides'] = [], mac = false) {
  const source = stubSettingsScope<KeybindingsSettings>()
  const settings = { ...source, set: vi.spyOn(source.scope, 'set'), unset: vi.spyOn(source.scope, 'unset') }
  settings.publish({ status: 'ready', writable: true, revision: 1, base: { overrides: [] },
    user: overrides.length > 0 ? { overrides } : undefined, value: { overrides } })
  settings.set.mockImplementation(async (_field: string, value: unknown) => {
    const overrides = value as KeybindingsSettings['overrides']
    settings.publish({ user: { overrides }, value: KeybindingsSettingsSchema(structuredClone({ overrides })),
      revision: settings.scope.getSnapshot().revision! + 1 })
  })
  settings.unset.mockImplementation(async () => {
    settings.publish({ user: undefined, value: settings.scope.getSnapshot().base as KeybindingsSettings,
      revision: settings.scope.getSnapshot().revision! + 1 })
  })
  const keyboard = new KeyboardController(settings.scope, mac)
  onTestFinished(() => { keyboard.dispose() })
  const release = keyboard.register({ id: 'test.alpha', scope: 'editor', label: () => 'Alpha', description: () => 'Save',
    defaultBindings: [key('s', { mod: true })] })
  keyboard.register({ id: 'test.beta', scope: 'editor', label: () => 'Beta', description: () => 'Find',
    defaultBindings: [key('f', { mod: true })] })
  keyboard.register({ id: 'test.popup', scope: 'composer-popup', label: () => 'Popup', description: () => 'Popup',
    defaultBindings: [key('s', { mod: true })], allowRepeat: true })
  return { keyboard, settings, release }
}

describe('logical shortcuts', () => {
  it('normalizes aliases, exact modifiers, portable primary keys, and platform labels', () => {
    expect(bindingIdentity(key('Esc'), false)).toBe(bindingIdentity(key('Escape'), false))
    expect(bindingIdentity(key('S', { mod: true }), false)).toBe(bindingIdentity(key('s', { ctrl: true }), false))
    expect(bindingIdentity(key('S', { mod: true }), true)).toBe(bindingIdentity(key('s', { meta: true }), true))
    expect(bindingLabel(key('s', { mod: true }), true)).toBe('⌘ + S')
    expect(bindingLabel(key(' ', { alt: true }), false)).toBe('Alt + ␣')
    const { keyboard } = bench([], true)
    expect(keyboard.matches('test.alpha', event('S', { metaKey: true }))).toBe(true)
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
    expect(keyboard.matches('test.alpha', event('s', { metaKey: true, shiftKey: true }))).toBe(false)
  })

  it.each(['l', 't', 'w', 'r', 'q', 'Tab'])('refuses the browser reservation Mod+%s', (letter) => {
    expect(bindingIssue(key(letter, { mod: true }), false)).toBe('reserved')
    expect(bindingIssue(key(letter, { mod: true }), true)).toBe('reserved')
  })

  it('does not capture compositions, modifier-only keys, or repeat keydowns', () => {
    for (const facts of [event('Control'), event('s', { isComposing: true }), event('s', { keyCode: 229 }),
      event('s', { altGraph: true }), event('s', { defaultPrevented: true }), event('s', { repeat: true })]) {
      expect(captureBinding(facts, false)).toEqual({ kind: 'ignored' })
    }
    expect(captureBinding(event('Dead'), false)).toEqual({ kind: 'invalid' })
    expect(captureBinding(event('l', { ctrlKey: true }), false)).toEqual({ kind: 'reserved' })
    expect(captureBinding(event('p', { metaKey: true }), true)).toMatchObject({ kind: 'binding', binding: { modifiers: { mod: true, meta: false } } })
  })

  it('preserves IME and prior-handler ownership and allows repeat only for an owner that opts in', () => {
    const { keyboard } = bench()
    for (const patch of [{ isComposing: true }, { keyCode: 229 }, { altGraph: true }, { defaultPrevented: true }, { repeat: true }]) {
      expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true, ...patch }))).toBe(false)
    }
    expect(keyboard.matches('test.popup', event('s', { ctrlKey: true, repeat: true }))).toBe(true)
  })
})

describe('effective command registry', () => {
  it('keeps snapshots stable between publications and reflects live bindings, null, and owner removal', () => {
    const { keyboard, settings, release } = bench([{ commandId: 'legacy.action', binding: key('x') }])
    const first = keyboard.getSnapshot()
    expect(keyboard.getSnapshot()).toBe(first)
    expect(first.commands.find(command => command.id === 'legacy.action')).toMatchObject({ registered: false, status: 'unavailable' })
    settings.publish({ value: { overrides: [{ commandId: 'test.alpha', binding: null }] }, user: { overrides: [{ commandId: 'test.alpha', binding: null }] } })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
    release()
    expect(keyboard.getSnapshot().commands.find(command => command.id === 'test.alpha')).toMatchObject({ status: 'unavailable', registered: false })
    release()
  })

  it('waits for authoritative settings and still dispatches read-only accepted bindings', () => {
    const { keyboard, settings } = bench()
    settings.publish({ status: 'loading' })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
    settings.publish({ status: 'ready', writable: false })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(true)
    settings.publish({ status: 'unavailable' })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
  })

  it('rejects same-scope default conflicts while permitting another focused owner to share a chord', async () => {
    const { keyboard, settings } = bench()
    await expect(keyboard.setBinding('test.alpha', key('f', { mod: true }))).resolves.toEqual({ ok: false, reason: 'conflict' })
    expect(settings.set).not.toHaveBeenCalled()
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(true)
    expect(keyboard.matches('test.popup', event('s', { ctrlKey: true }))).toBe(true)
    settings.publish({ value: { overrides: [{ commandId: 'test.beta', binding: key('s', { mod: true }) }] } })
    expect(keyboard.getSnapshot().commands.slice(0, 2).map(command => command.status)).toEqual(['conflict', 'conflict'])
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
  })

  it('rejects reserved, invalid, unavailable, and intrinsic composer newline choices', async () => {
    const { keyboard } = bench()
    keyboard.register({ id: 'test.composer', scope: 'composer', label: () => 'Send', description: () => '', defaultBindings: [key('Enter')] })
    await expect(keyboard.setBinding('test.alpha', key('l', { ctrl: true }))).resolves.toEqual({ ok: false, reason: 'reserved' })
    await expect(keyboard.setBinding('test.alpha', key('Dead'))).resolves.toEqual({ ok: false, reason: 'invalid' })
    await expect(keyboard.setBinding('legacy.action', key('p'))).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(keyboard.setBinding('test.composer', key('Enter', { shift: true }))).resolves.toEqual({ ok: false, reason: 'reserved' })
  })

  it('tracks owner availability and removes its subscription on disposal', () => {
    const { keyboard } = bench()
    let available = false
    let changed = () => {}
    const off = vi.fn()
    const release = keyboard.register({ id: 'test.composer', scope: 'composer', label: () => 'Send', description: () => '',
      defaultBindings: [key('Enter')], available: { getSnapshot: () => available, subscribe: (listener) => { changed = listener; return off } } })
    expect(keyboard.matches('test.composer', event('Enter'))).toBe(false)
    available = true
    changed()
    expect(keyboard.matches('test.composer', event('Enter'))).toBe(true)
    release()
    expect(off).toHaveBeenCalledOnce()
    expect(keyboard.getSnapshot().commands.some(command => command.id === 'test.composer')).toBe(false)
  })
})

describe('accepted preference mutations', () => {
  it('serializes edits, preserves legacy records, and restores bindings by unsetting the final override leaf', async () => {
    const legacy = { commandId: 'conversation.newLine', binding: key('Enter', { shift: true }) }
    const { keyboard, settings } = bench([legacy])
    await expect(Promise.all([keyboard.setBinding('test.alpha', key('a', { alt: true })), keyboard.setBinding('test.beta', null)]))
      .resolves.toEqual([{ ok: true }, { ok: true }])
    expect(settings.scope.getSnapshot().user).toEqual({ overrides: [legacy,
      { commandId: 'test.alpha', binding: key('a', { alt: true }) }, { commandId: 'test.beta', binding: null }] })
    expect(keyboard.matches('test.alpha', event('a', { altKey: true }))).toBe(true)
    await expect(keyboard.resetBinding('test.alpha')).resolves.toEqual({ ok: true })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(true)
    await keyboard.resetBinding('test.beta')
    await expect(keyboard.resetBinding('conversation.newLine')).resolves.toEqual({ ok: true })
    expect(settings.unset).toHaveBeenLastCalledWith('overrides')
    expect(keyboard.getSnapshot().hasOverrides).toBe(false)
  })

  it('keeps raw default-valued overrides resettable and accepts a real no-op without a revision bump', async () => {
    const overrides = [{ commandId: 'test.alpha', binding: key('s', { mod: true }) }]
    const { keyboard, settings } = bench(overrides)
    expect(keyboard.getSnapshot().commands[0]!.overridden).toBe(true)
    await expect(keyboard.setBinding('test.alpha', key('s', { mod: true }))).resolves.toEqual({ ok: true })
    expect(settings.set).not.toHaveBeenCalled()
    await expect(keyboard.resetAll()).resolves.toEqual({ ok: true })
    expect(settings.scope.getSnapshot().user).toBeUndefined()
  })

  it('refuses a swallowed Host failure even when the effective preference already equals the requested value', async () => {
    const inherited = [{ commandId: 'test.alpha', binding: key('p', { alt: true }) }]
    const { keyboard, settings } = bench()
    settings.publish({ base: { overrides: inherited }, value: { overrides: inherited }, user: undefined })
    settings.set.mockResolvedValue(undefined)
    await expect(keyboard.setBinding('test.alpha', key('p', { alt: true }))).resolves.toEqual({ ok: false, reason: 'failed' })
    expect(keyboard.getSnapshot().hasOverrides).toBe(false)
  })

  it('rejects a late accepted result after disposal and skips the queued successor', async () => {
    const { keyboard, settings } = bench()
    let release = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    settings.set.mockImplementationOnce(async () => {
      await gate
      settings.publish({ user: { overrides: [{ commandId: 'test.alpha', binding: null }] },
        value: { overrides: [{ commandId: 'test.alpha', binding: null }] }, revision: 2 })
    })
    const first = keyboard.setBinding('test.alpha', null)
    const second = keyboard.setBinding('test.beta', null)
    await Promise.resolve()
    expect(settings.set).toHaveBeenCalledOnce()
    keyboard.dispose()
    release()
    await expect(first).resolves.toEqual({ ok: false, reason: 'unavailable' })
    await expect(second).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(settings.set).toHaveBeenCalledOnce()
    expect(settings.listenerCount()).toBe(0)
  })

  it('does not accept a stale revision, rejected write, inconsistent effective echo, or disposed owner', async () => {
    const { keyboard, settings } = bench()
    settings.set.mockRejectedValueOnce(new Error('write failed'))
    await expect(keyboard.setBinding('test.alpha', null)).resolves.toEqual({ ok: false, reason: 'failed' })
    settings.set.mockImplementationOnce(async (_field: string, value: unknown) => { settings.publish({ user: { overrides: value }, value: { overrides: value as KeybindingsSettings['overrides'] } }) })
    await expect(keyboard.setBinding('test.alpha', null)).resolves.toEqual({ ok: false, reason: 'failed' })
    settings.publish({ user: undefined, value: { overrides: [] } })
    settings.set.mockImplementationOnce(async (_field: string, value: unknown) => {
      settings.publish({ user: { overrides: value }, revision: 2 })
    })
    await expect(keyboard.setBinding('test.alpha', null)).resolves.toEqual({ ok: false, reason: 'failed' })
    keyboard.dispose()
    await expect(keyboard.resetAll()).resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(keyboard.matches('test.alpha', event('s', { ctrlKey: true }))).toBe(false)
  })
})
