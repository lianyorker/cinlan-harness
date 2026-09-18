import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote, TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '../src/client/index.ts'
import { KeybindingsSettingsSchema } from '../src/settings-schema.ts'
import type { KeyEventFacts } from '../src/types.ts'

declare module '../src/client/index.ts' { interface KeyboardCommandMap { 'lifecycle.save': { scope: 'editor' } } }

type Op = { op: 'set' | 'unset'; path: string[]; value?: unknown }
const cleanup: (() => unknown)[] = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function bench() {
  const ctx = new Context()
  const slots = ctx.plugin(SlotRegistry)
  cleanup.push(() => slots.dispose())
  await slots.await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  ctx.provide('sessions', new TestSessions(async (fn) => { await fn() }, ctx))
  const base = KeybindingsSettingsSchema({ overrides: [] })
  const user: Record<string, unknown> = { overrides: [{ commandId: 'legacy.action', binding: null }] }
  let revision = 1
  let reject = false
  const namespace = () => ({ ns: 'keybindings', schema: KeybindingsSettingsSchema.toJSON(), base,
    user: structuredClone(user), value: KeybindingsSettingsSchema(structuredClone({ ...base, ...user })), revision, applies: 'live', secrets: [] })
  const describe = vi.fn(async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace()] } }))
  const mutate = vi.fn(async (_ns: string, ops: Op[], expectedRevision: number) => {
    if (reject || revision !== expectedRevision) {
      reject = false
      return { ok: false, error: { code: 'settings/conflict', message: 'refused', details: {} } }
    }
    const before = JSON.stringify(user)
    for (const op of ops) {
      if (op.op === 'unset') Reflect.deleteProperty(user, op.path[0]!)
      else user[op.path[0]!] = structuredClone(op.value)
    }
    if (JSON.stringify(user) !== before) revision++
    return { ok: true, value: namespace() }
  })
  const remote = new TestRemote(ctx, { settings: { describe, mutate } })
  remote.$host = { home: undefined, isLoopback: true }
  const settings = ctx.plugin({ inject: [...settingsInject], apply: settingsApply })
  cleanup.push(() => settings.dispose())
  await settings.await()
  const feature = ctx.plugin({ inject: [...inject], apply })
  cleanup.push(() => feature.dispose())
  await feature.await()
  await vi.waitFor(() => { expect(ctx.keyboard.getSnapshot().status).toBe('ready') })
  return { ctx, feature, locale, user, mutate, rejectNext: () => { reject = true } }
}

const saveEvent: KeyEventFacts = { key: 's', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false,
  isComposing: false, repeat: false, defaultPrevented: false }

describe('keyboard plugin lifetime and real SettingsScope', () => {
  it('disposes registrations with their owner, updates labels from locale, and publishes removal on HMR', async () => {
    const b = await bench()
    let title = 'Save'
    const owner = b.ctx.plugin({ inject: ['keyboard'], apply: (ctx: Context) => {
      ctx.effect(() => ctx.keyboard.register({ id: 'lifecycle.save', scope: 'editor', label: () => title, description: () => '',
        defaultBindings: [{ key: 's', modifiers: { mod: true } }] }))
    } })
    cleanup.push(() => owner.dispose())
    await owner.await()
    expect(b.ctx.keyboard.matches('lifecycle.save', saveEvent)).toBe(true)
    title = '保存'
    b.locale.setLocale('zh')
    expect(b.ctx.keyboard.getSnapshot().commands.find(command => command.id === 'lifecycle.save')?.label).toBe('保存')
    await owner.dispose()
    expect(b.ctx.keyboard.matches('lifecycle.save', saveEvent)).toBe(false)
    expect(b.ctx.keyboard.getSnapshot().commands.some(command => command.id === 'lifecycle.save')).toBe(false)
    await b.feature.dispose()
    expect(b.ctx.get('keyboard')).toBeUndefined()
  })

  it('uses accepted revisions, preserves legacy overrides, detects recovered refusal, and resets by unset', async () => {
    const b = await bench()
    b.ctx.keyboard.register({ id: 'lifecycle.save', scope: 'editor', label: () => 'Save', description: () => '',
      defaultBindings: [{ key: 's', modifiers: { mod: true } }] })
    b.rejectNext()
    await expect(b.ctx.keyboard.setBinding('lifecycle.save', { key: 's', modifiers: { mod: true } }))
      .resolves.toEqual({ ok: false, reason: 'failed' })
    expect(b.ctx.keyboard.matches('lifecycle.save', saveEvent)).toBe(true)
    await expect(b.ctx.keyboard.setBinding('lifecycle.save', null)).resolves.toEqual({ ok: true })
    expect(b.user).toEqual({ overrides: [{ commandId: 'legacy.action', binding: null }, { commandId: 'lifecycle.save', binding: null }] })
    expect(b.ctx.keyboard.matches('lifecycle.save', saveEvent)).toBe(false)
    await expect(b.ctx.keyboard.resetAll()).resolves.toEqual({ ok: true })
    expect(b.mutate).toHaveBeenLastCalledWith('keybindings', [{ op: 'unset', path: ['overrides'] }], 2)
    expect(b.user).toEqual({})
    expect(b.ctx.keyboard.matches('lifecycle.save', saveEvent)).toBe(true)
  })
})
