/**
 * ui-permission browser half on a real cordis Context with fake command/
 * sessions faces: the plugin hangs the /permission popup decoration on the
 * host command; options flatten the session's permissions projection with
 * the current value active and `custom` excluded; availability follows the
 * projection key's presence; a pick submits the /permission line through
 * Session.command and surfaces rejection/unmatched as thrown errors; fiber
 * disposal removes the contribution (HMR safety). The same plugin registers
 * its Settings row and invalidates that row on host settings changes.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote, scriptedSettingsRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CommandDecoration } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { PermissionSelect } from '@deepseek-ai/dsh-permission-presets/client'
import {
  PermissionRow, type PermissionRowInjected,
} from '../src/client/PermissionRow.tsx'
import { apply, inject } from '../src/client/index.ts'
import { accessEn, accessZh } from '../src/client/locales.ts'

const sid = (k: string): SessionId => k as SessionId

const SELECT: PermissionSelect = {
  options: [
    { value: 'read-only', name: 'read-only', description: 'Reads only.' },
    { value: 'workspace-write', name: 'workspace-write' },
    { value: 'danger-full-access', name: 'danger-full-access' },
  ],
  currentValue: 'workspace-write',
}

const PERMISSION_VIEW: SettingsNamespaceView = {
  ns: 'permission',
  schema: {
    uid: 2,
    refs: {
      1: { type: 'const', value: 'read-only' },
      2: { type: 'object', dict: { defaultPreset: 1 } },
    },
  },
  value: { defaultPreset: 'read-only' },
  base: { defaultPreset: 'read-only' },
  applies: 'live',
  secrets: [],
  revision: 0,
}

async function bench(namespaces: readonly SettingsNamespaceView[] = [PERMISSION_VIEW]) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  const settingsRemote = scriptedSettingsRemote(namespaces)
  const remote = new TestRemote(ctx, { settings: settingsRemote.settings })
  ctx.slots.register({
    name: 'root',
    children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  let decoration: CommandDecoration | undefined
  ctx.provide('commandUi', {
    decorate(c: CommandDecoration) {
      decoration = c
      return () => { decoration = undefined }
    },
  })
  const values = new Map<SessionId, PermissionSelect>()
  const commands: string[] = []
  let commandResult: { ok: boolean; matched?: boolean } = { ok: true, matched: true }
  const session = (id: SessionId) => ({
    projections: {
      faceOf: (key: string) => ({
        getSnapshot: () => (key === 'permissions' ? values.get(id) : undefined),
        subscribe: () => () => {},
      }),
    },
    command: (line: string) => {
      commands.push(line)
      return Promise.resolve(commandResult.ok
        ? { ok: true as const, value: { matched: commandResult.matched ?? true } }
        : { ok: false as const, error: { code: 'gateway/internal', message: 'boom' } })
    },
  })
  ctx.provide('sessions', {
    binding: (id: SessionId) => (values.has(id) ? { sessionId: id, session: session(id) } : undefined),
  })
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, locale, values, commands, remote, settingsRemote,
    setResult: (r: { ok: boolean; matched?: boolean }) => { commandResult = r },
    decoration: () => decoration,
    permissionRow: () => ctx.slots.entries('settings.general.item')
      .find(entry => entry.component === PermissionRow),
  }
}

describe('ui-permission browser plugin', () => {
  it('hangs the /permission popup decoration on the host command', async () => {
    const b = await bench()
    const c = b.decoration()!
    expect(c.name).toBe('permission')
    expect(c.ui.kind).toBe('popupSelect')
    const row = b.permissionRow()!
    expect(row.options).toEqual({ id: 'permission', order: -20 })
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([{
      sectionId: 'general', id: 'permission', anchorId: 'permission', title: 'Permission',
      description: 'Choose the default permission mode for new sessions',
      keywords: ['permission', 'access', 'approval', 'sandbox'],
    }])
    b.locale.setLocale('zh')
    expect(b.ctx.settingsMetadata.getSnapshot().items[0])
      .toMatchObject({ title: '权限', description: '选择新会话的默认权限模式' })
    const injected = row.inject?.() as PermissionRowInjected | undefined
    expect(injected?.hooks.permission).toBeDefined()
    expect(typeof injected?.load).toBe('function')
    expect(typeof injected?.select).toBe('function')
    await injected!.load()
    await injected!.select('read-only')
  })

  it('search availability follows Host descriptors before the General control mounts', async () => {
    const b = await bench([])
    const mirror = b.ctx.settingsScope.describe()
    const injected = b.permissionRow()!.inject?.() as unknown as PermissionRowInjected
    const refresh = async (): Promise<void> => {
      const previous = mirror.getSnapshot().view
      b.ctx.emit('connection/reset')
      await vi.waitFor(() => { expect(mirror.getSnapshot().view).not.toBe(previous) })
    }
    try {
      expect(injected.hooks.permission.getSnapshot().status).toBe('idle')
      expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])

      b.settingsRemote.publish([PERMISSION_VIEW])
      await refresh()
      expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.id)).toEqual(['permission'])
      expect(injected.hooks.permission.getSnapshot().status).toBe('idle')

      b.settingsRemote.publish([])
      await refresh()
      expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])

      b.settingsRemote.publish([PERMISSION_VIEW])
      await refresh()
      expect(b.ctx.settingsMetadata.getSnapshot().items.map(item => item.id)).toEqual(['permission'])
      await b.fiber.dispose()
      expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
      await refresh()
      expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
      expect(b.settingsRemote.mutate).not.toHaveBeenCalled()
    } finally {
      await b.fiber.dispose()
    }
  })

  it('availability follows the projection key; options mark the current value active and exclude custom', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    expect(c.available(proj)).toBe(false)
    b.values.set(sid('s1'), { ...SELECT, options: [...SELECT.options, { value: 'custom', name: 'Custom' }], currentValue: 'custom' })
    expect(c.available(proj)).toBe(true)
    const options = await c.ui.options(proj, new AbortController().signal)
    expect(options.map(option => option.id)).toEqual(['read-only', 'workspace-write', 'danger-full-access'])
    expect(options.every(option => option.active !== true)).toBe(true)
    b.values.set(sid('s1'), SELECT)
    const again = await c.ui.options(proj, new AbortController().signal)
    expect(again.find(option => option.id === 'workspace-write')?.active).toBe(true)
    expect(again.find(option => option.id === 'read-only')?.detail).toBe('Reads only.')
    // English built-ins use product labels; other kebab-case names title-case.
    expect(again.map(option => option.label)).toEqual(['Read Only', 'Workspace Write', 'Full access'])
    expect(again.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: 'Enable Full access?',
      description: accessEn['confirm.description'],
      acknowledgeLabel: 'I understand the risks and want to continue',
      cancelLabel: 'Cancel',
      confirmLabel: 'Enable Full access',
    })
    b.locale.setLocale('zh')
    const localized = await c.ui.options(proj, new AbortController().signal)
    expect(localized.map(option => option.label)).toEqual(['仅可查看', '工作区内修改', '完全权限'])
    expect(localized.find(option => option.id === 'danger-full-access')?.confirmation).toEqual({
      title: '确认启用完全权限？',
      description: accessZh['confirm.description'],
      acknowledgeLabel: '我已了解风险，并愿意继续',
      cancelLabel: '取消',
      confirmLabel: '启用完全权限',
    })
    b.values.set(sid('s1'), { ...SELECT, options: [
      { value: 'workspace-write', name: 'Project Files' },
      { value: 'danger-full-access', name: 'Operator Mode' },
      { value: 'custom-mode', name: 'custom-mode' },
      { value: '__proto__', name: '__proto__' },
      { value: 'plain', name: 'Ask Every Time' },
    ] })
    const passthrough = await c.ui.options(proj, new AbortController().signal)
    expect(passthrough.map(option => option.label)).toEqual([
      'Project Files', 'Operator Mode', 'Custom Mode', '__proto__', 'Ask Every Time',
    ])
    // A projection that vanished between availability and open throws.
    expect(() => c.ui.options({ sessionId: sid('ghost') }, new AbortController().signal))
      .toThrow(/not available on this host/)
  })

  it('a pick submits the /permission line; rejection and unmatched throw', async () => {
    const b = await bench()
    const c = b.decoration()!
    const proj = { sessionId: sid('s1') }
    b.values.set(sid('s1'), SELECT)
    await c.ui.onSelect({ id: 'danger-full-access', label: 'danger-full-access' }, proj)
    expect(b.commands).toEqual(['/permission danger-full-access'])
    b.setResult({ ok: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/permission switch failed/)
    b.setResult({ ok: true, matched: false })
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, proj)).rejects.toThrow(/no \/permission command/)
    // An unmaterialized session throws before any submit.
    await expect(c.ui.onSelect({ id: 'read-only', label: 'read-only' }, { sessionId: sid('ghost') }))
      .rejects.toThrow(/not materialized/)
  })

  it('disposal removes the decoration (HMR safety)', async () => {
    const b = await bench()
    expect(b.decoration()).toBeDefined()
    b.remote.emit('settings/document-updated', ['another', 1])
    b.remote.emit('settings/document-updated', ['permission', 1])
    b.ctx.emit('connection/reset')
    await b.fiber.dispose()
    expect(b.decoration()).toBeUndefined()
    expect(b.permissionRow()).toBeUndefined()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
  })
})
