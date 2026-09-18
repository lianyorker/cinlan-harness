import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote, TestSessions } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NotificationSettingsSchema } from '@deepseek-ai/dsh-notifications/src/settings.ts'
import { apply, inject } from '../src/client/index.ts'
import type { NotificationsSectionInjected } from '../src/client/NotificationsSection.tsx'
import { en, zh } from '../src/client/locales.ts'

type FieldOp = { op: 'set' | 'unset'; path: string[]; value?: unknown }
type Refusal = 'conflict' | 'transport' | 'conflict-after-external-update'
const disposers: (() => unknown)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.unstubAllGlobals()
})

async function bench(isLoopback = true, writable = true) {
  const ctx = new Context()
  const slotFiber = ctx.plugin(SlotRegistry)
  disposers.push(() => slotFiber.dispose())
  await slotFiber.await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  ctx.provide('sessions', new TestSessions(async (fn) => { await fn() }, ctx))
  const base = NotificationSettingsSchema({
    enabled: true, agentCompletion: false, terminalBell: false, sound: 'pop', suppressWhenFocused: false, customSoundName: '',
    quietHoursEnabled: true, quietHoursStart: '21:00', quietHoursEnd: '07:30',
  })
  const user: Record<string, unknown> = { enabled: true, terminalBell: true, sound: 'ding', customSoundName: 'private-sound.wav' }
  let revision = 4
  let fail: Refusal | undefined
  const namespace = () => ({
    ns: 'notifications', schema: NotificationSettingsSchema.toJSON(),
    value: { ...base, ...user }, base, user: { ...user }, revision, applies: 'live', secrets: [],
  })
  const describe = vi.fn(async () => ({ ok: true, value: { writable, hasDocument: true, namespaces: [namespace()] } }))
  const mutate = vi.fn(async (_namespace: string, ops: FieldOp[], expectedRevision: number) => {
    const failure = fail
    fail = undefined
    if (failure === 'transport') throw new Error('transport unavailable')
    if (failure === 'conflict' || expectedRevision !== revision) {
      return { ok: false, error: { code: 'settings/conflict', message: 'revision changed', details: {} } }
    }
    const before = JSON.stringify(user)
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'unset') Reflect.deleteProperty(user, field)
      else user[field] = op.value
    }
    if (JSON.stringify(user) !== before) revision += 1
    if (failure === 'conflict-after-external-update') {
      return { ok: false, error: { code: 'settings/conflict', message: 'another writer committed', details: {} } }
    }
    return { ok: true, value: namespace() }
  })
  const remote = new TestRemote(ctx, { settings: { describe, mutate } })
  remote.$host = { home: undefined, isLoopback }
  const settingsFiber = ctx.plugin({ inject: [...settingsInject], apply: settingsApply })
  disposers.push(() => settingsFiber.dispose())
  await settingsFiber.await()
  const slots = ctx.get('slots') as SlotRegistry
  const declare = () => {
    const release = slots.register({
      name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } },
    } as never, () => null)
    disposers.push(release)
    return release
  }
  const feature = ctx.plugin({ inject: [...inject], apply })
  disposers.push(() => feature.dispose())
  await feature.await()
  const face = () => (slots.entries('settings.section')[0]!.inject as unknown as () => NotificationsSectionInjected)()
  return { ctx, locale, slots, declare, feature, face, describe, mutate, user, base, failNext: (value: Refusal) => { fail = value } }
}

describe('notification settings registration and persistence', () => {
  it('keeps localized metadata with its slot through late declaration, collapse, and disposal', async () => {
    const b = await bench()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    const release = b.declare()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(11) })
    const snapshot = b.ctx.settingsMetadata.getSnapshot()
    expect(snapshot.sections).toEqual([{ sectionId: 'notifications', groupId: 'personal' }])
    expect(snapshot.items.map(item => [item.id, item.anchorId, item.title])).toEqual([
      ['enabled', 'notifications-enabled', en.enabled],
      ['agent-completion', 'notifications-agent-completion', en.agentCompletion],
      ['terminal-bell', 'notifications-terminal-bell', en.terminalBell],
      ['focus-suppression', 'notifications-focus-suppression', en.focusSuppression],
      ['test', 'notifications-test', en.testTitle],
      ['quiet-hours', 'notifications-quiet-hours', en.quietHoursEnabled],
      ['quiet-start', 'notifications-quiet-start', en.quietHoursStart],
      ['quiet-end', 'notifications-quiet-end', en.quietHoursEnd],
      ['sound', 'notifications-sound', en.sound],
      ['custom-sound', 'notifications-custom-sound', en.customSound],
      ['reset', 'notifications-reset', en.resetTitle],
    ])
    expect(JSON.stringify(snapshot)).not.toContain('private-sound.wav')
    expect(snapshot.items[2]?.description).toBe(en.terminalBellDescription)
    expect(snapshot.items[4]?.keywords).toEqual([en.testKeywords])
    expect(snapshot.items[5]).toMatchObject({ keywords: [en.quietHoursKeywords] })
    b.locale.setLocale('zh')
    expect(b.ctx.settingsMetadata.getSnapshot().items[5]).toMatchObject({
      title: zh.quietHoursEnabled, description: zh.quietHoursDescription, keywords: [zh.quietHoursKeywords],
    })
    expect(b.ctx.settingsMetadata.getSnapshot().items[2]).toMatchObject({
      title: zh.terminalBell, description: zh.terminalBellDescription, keywords: [zh.bellKeywords],
    })
    release()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] }) })
    b.declare()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(11) })
    await b.feature.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(b.slots.entries('settings.section')).toEqual([])
  })

  it('writes existing fields with revisions and resets to inherited Host defaults', async () => {
    const b = await bench()
    b.declare()
    const face = b.face()
    await expect(face.writePreference('agentCompletion', true)).resolves.toBe(true)
    expect(b.mutate).toHaveBeenLastCalledWith('notifications', [{ op: 'set', path: ['agentCompletion'], value: true }], 4)
    expect(face.hooks.settings.getSnapshot().value?.agentCompletion).toBe(true)
    await expect(face.resetPreferences()).resolves.toBe(true)
    expect(b.mutate).toHaveBeenLastCalledWith('notifications', [
      'enabled', 'agentCompletion', 'terminalBell', 'sound', 'suppressWhenFocused', 'customSoundName',
      'quietHoursEnabled', 'quietHoursStart', 'quietHoursEnd',
    ].map(field => ({ op: 'unset', path: [field] })), 5)
    expect(face.hooks.settings.getSnapshot().value).toEqual(b.base)
    expect(b.user).toEqual({})
  })

  it('commits quiet times atomically, fences stale drafts, and retries after recovering the Host revision', async () => {
    const b = await bench()
    b.declare()
    const face = b.face()
    const draftRevision = face.hooks.settings.getSnapshot().revision
    await expect(face.writePreference('terminalBell', false)).resolves.toBe(true)
    await expect(face.writeQuietHours('23:30', '06:15', draftRevision)).resolves.toBe(false)
    expect(b.mutate).toHaveBeenLastCalledWith('notifications', [
      { op: 'set', path: ['quietHoursStart'], value: '23:30' },
      { op: 'set', path: ['quietHoursEnd'], value: '06:15' },
    ], 4)
    expect(face.hooks.settings.getSnapshot()).toMatchObject({
      revision: 5, value: { quietHoursStart: '21:00', quietHoursEnd: '07:30', terminalBell: false },
    })
    expect(b.user).not.toHaveProperty('quietHoursStart')
    expect(b.user).not.toHaveProperty('quietHoursEnd')
    await expect(face.writeQuietHours('23:30', '06:15')).resolves.toBe(true)
    expect(b.mutate).toHaveBeenLastCalledWith('notifications', [
      { op: 'set', path: ['quietHoursStart'], value: '23:30' },
      { op: 'set', path: ['quietHoursEnd'], value: '06:15' },
    ], 5)
    expect(face.hooks.settings.getSnapshot()).toMatchObject({
      revision: 6, user: { quietHoursStart: '23:30', quietHoursEnd: '06:15' },
    })
    const writes = b.mutate.mock.calls.length
    await expect(face.writeQuietHours('23:30', '06:15')).resolves.toBe(true)
    expect(b.mutate).toHaveBeenCalledTimes(writes)
    await expect(face.writePreference('quietHoursEnabled', false)).resolves.toBe(true)
    await expect(face.resetPreferences()).resolves.toBe(true)
    expect(face.hooks.settings.getSnapshot().value).toEqual(b.base)
    expect(b.user).toEqual({})
  })

  it('does not report a refused quiet schedule as saved when another writer committed equal times', async () => {
    const b = await bench()
    b.declare()
    const face = b.face()
    b.failNext('conflict-after-external-update')
    await expect(face.writeQuietHours('12:00', '12:00')).resolves.toBe(false)
    expect(face.hooks.settings.getSnapshot()).toMatchObject({
      value: { quietHoursStart: '12:00', quietHoursEnd: '12:00' },
      user: { quietHoursStart: '12:00', quietHoursEnd: '12:00' },
    })
    b.failNext('transport')
    await expect(face.writeQuietHours('23:00', '07:00')).rejects.toThrow('transport unavailable')
    expect(face.hooks.settings.getSnapshot().value).toMatchObject({ quietHoursStart: '12:00', quietHoursEnd: '12:00' })
  })

  it('requires an explicit override for equal-to-base writes and removes equal-valued overrides on reset', async () => {
    const b = await bench()
    b.declare()
    const face = b.face()
    await expect(face.resetPreferences()).resolves.toBe(true)
    expect(face.hooks.settings.getSnapshot().value?.enabled).toBe(true)
    b.failNext('conflict')
    await expect(face.writePreference('enabled', true)).resolves.toBe(false)
    expect(face.hooks.settings.getSnapshot().user).toEqual({})
    await expect(face.writePreference('enabled', true)).resolves.toBe(true)
    expect(face.hooks.settings.getSnapshot().user).toEqual({ enabled: true })
    const writes = b.mutate.mock.calls.length
    await expect(face.writePreference('enabled', true)).resolves.toBe(true)
    expect(b.mutate).toHaveBeenCalledTimes(writes)
    await expect(face.resetPreferences()).resolves.toBe(true)
    expect(face.hooks.settings.getSnapshot().value?.enabled).toBe(true)
    expect(face.hooks.settings.getSnapshot().user).toEqual({})
    const resetWrites = b.mutate.mock.calls.length
    await expect(face.resetPreferences()).resolves.toBe(true)
    expect(b.mutate).toHaveBeenCalledTimes(resetWrites)
  })

  it('reports conflicts after recovery and allows an explicit retry without masking transport errors', async () => {
    const b = await bench()
    b.declare()
    const face = b.face()
    b.failNext('conflict')
    await expect(face.writePreference('agentCompletion', true)).resolves.toBe(false)
    expect(b.describe).toHaveBeenCalledTimes(2)
    expect(face.hooks.settings.getSnapshot().value?.agentCompletion).toBe(false)
    await expect(face.writePreference('agentCompletion', true)).resolves.toBe(true)
    b.failNext('transport')
    await expect(face.writePreference('terminalBell', false)).rejects.toThrow('transport unavailable')
    expect(face.hooks.settings.getSnapshot().value?.terminalBell).toBe(true)
    b.failNext('conflict')
    await expect(face.resetPreferences()).resolves.toBe(false)
  })

  it('requires this request to be accepted when recovery already contains the requested preference or reset', async () => {
    const createObjectURL = vi.fn(() => 'blob:refused-sound')
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
    const b = await bench()
    b.declare()
    const face = b.face()
    b.failNext('conflict-after-external-update')
    await expect(face.writePreference('agentCompletion', true)).resolves.toBe(false)
    expect(face.hooks.settings.getSnapshot()).toMatchObject({
      value: { agentCompletion: true }, user: { agentCompletion: true }, revision: 5,
    })
    b.failNext('conflict-after-external-update')
    await expect(face.resetPreferences()).resolves.toBe(false)
    expect(face.hooks.settings.getSnapshot().user).toEqual({})
    const file = new File(['audio'], 'concurrent.wav', { type: 'audio/wav' })
    b.failNext('conflict-after-external-update')
    await expect(face.selectCustomSound(file)).resolves.toBe(false)
    expect(face.hooks.settings.getSnapshot()).toMatchObject({
      value: { sound: 'custom', customSoundName: file.name }, user: { sound: 'custom', customSoundName: file.name },
    })
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(b.mutate).toHaveBeenCalledTimes(3)
  })

  it('registers custom audio only after its atomic preference write is confirmed', async () => {
    const createObjectURL = vi.fn(() => 'blob:notification-test')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const b = await bench()
    b.declare()
    const face = b.face()
    const file = new File(['audio'], 'alert.wav', { type: 'audio/wav' })
    b.failNext('conflict')
    await expect(face.selectCustomSound(file)).resolves.toBe(false)
    expect(createObjectURL).not.toHaveBeenCalled()
    await expect(face.selectCustomSound(file)).resolves.toBe(true)
    expect(b.mutate).toHaveBeenLastCalledWith('notifications', [
      { op: 'set', path: ['sound'], value: 'custom' },
      { op: 'set', path: ['customSoundName'], value: 'alert.wav' },
    ], 4)
    expect(createObjectURL).toHaveBeenCalledWith(file)
    const writes = b.mutate.mock.calls.length
    const replacement = new File(['replacement'], 'alert.wav', { type: 'audio/wav' })
    await expect(face.selectCustomSound(replacement)).resolves.toBe(true)
    expect(b.mutate).toHaveBeenCalledTimes(writes)
    expect(createObjectURL).toHaveBeenLastCalledWith(replacement)
    await b.feature.dispose()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:notification-test')
  })

  it.each([[false, true], [true, false]])('does not mutate unavailable or read-only preferences (%s, %s)', async (isLoopback, writable) => {
    const b = await bench(isLoopback, writable)
    b.declare()
    const face = b.face()
    await expect(face.writePreference('enabled', true)).resolves.toBe(false)
    await expect(face.resetPreferences()).resolves.toBe(false)
    await expect(face.writeQuietHours('23:30', '06:15')).resolves.toBe(false)
    await expect(face.selectCustomSound(new File(['audio'], 'alert.wav'))).resolves.toBe(false)
    expect(b.mutate).not.toHaveBeenCalled()
  })
})
