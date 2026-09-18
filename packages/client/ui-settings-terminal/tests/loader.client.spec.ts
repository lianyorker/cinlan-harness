// @vitest-environment jsdom
/** Source Loader composition with the real SettingsScope queue and an external Host Remote fixture. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import * as settingsPlugin from '@deepseek-ai/dsh-client-ui-settings/client'
import { PrefsSchema } from '@deepseek-ai/dsh-client-ui-better-sidebar/src/config.ts'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import * as terminalPlugin from '../src/client/index.ts'
import type { TerminalSettingsInjected } from '../src/client/TerminalSettingsSection.tsx'

type Operation = Parameters<SettingsScope<unknown>['mutate']>[0][number]
let root: string | undefined
let context: Context | undefined
afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function load() {
  root = await mkdtemp(join(tmpdir(), 'dsh-terminal-client-'))
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- id: slots', '  name: test-slot-registry',
    '- id: external-context', '  name: test-client-context',
    '- id: settings', "  name: '@deepseek-ai/dsh-client-ui-settings'",
    '- id: terminal', "  name: '@deepseek-ai/dsh-client-ui-settings-terminal'", '',
  ].join('\n'))
  const host = { revision: 1, user: { openByDefault: true } as Record<string, unknown> }
  const view = () => ({ ns: 'dsh-better-sidebar', revision: host.revision,
    schema: PrefsSchema.toJSON(), value: PrefsSchema(host.user as never), user: { ...host.user }, applies: 'live', secrets: [],
  })
  const describeSettings = vi.fn(async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [view()] } }))
  const mutate = vi.fn(async (_namespace: string, ops: readonly Operation[], revision: number) => {
    if (revision !== host.revision) return { ok: false, error: { code: 'settings/conflict', message: 'revision conflict' } }
    for (const op of ops) {
      const field = op.path[0]
      if (field === undefined) throw new Error('Terminal preference mutation must name a field')
      if (op.op === 'set') host.user[field] = op.value
      else host.user = Object.fromEntries(Object.entries(host.user).filter(([key]) => key !== field))
    }
    host.revision += 1
    return { ok: true, value: view() }
  })
  const fixture = { inject: ['slots'], apply(ctx: Context) {
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('en')
    ctx.provide('locale', locale)
    const remoteSettings = { describe: describeSettings, mutate }
    ctx.provide('remote', { settings: remoteSettings, $host: { isLoopback: true }, $on: () => () => {} } as never)
    ctx.provide('remote.settings', remoteSettings as never)
    ctx.provide('betterSidebar', { getTerminalCapability: () => Promise.resolve({ status: 'available' }) } as never)
    ctx.effect(() => ctx.slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' }, 'settings.section.icon': { kind: 'keyed', scope: 'root' },
    } } as never, () => null))
  } }
  const modules = new Map<string, unknown>([
    ['test-slot-registry', SlotRegistry], ['test-client-context', fixture],
    ['@deepseek-ai/dsh-client-ui-settings', settingsPlugin], ['@deepseek-ai/dsh-client-ui-settings-terminal', terminalPlugin],
  ])
  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const original = ctx.loader.internal
  ctx.loader.internal = {
    version: 'v2',
    loadCache: original?.loadCache ?? new Map(),
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader module: ' + specifier)
      return modules.get(specifier)
    },
    register(...args) {
      if (original === undefined) throw new Error('Native module registration is unavailable')
      original.register(...args)
    },
    getOrCreateModuleJob(parentURL, request, requestType) {
      if (original === undefined) throw new Error('Native module jobs are unavailable')
      return original.version === 'v2'
        ? original.getOrCreateModuleJob(parentURL, request, requestType)
        : original.getModuleJobForImport(request.specifier, parentURL, request.attributes ?? {})
    },
    resolveSync(parentURL, request) {
      if (original === undefined) throw new Error('Native module resolution is unavailable')
      return original.version === 'v2'
        ? original.resolveSync(parentURL, request)
        : original.resolveSync(request.specifier, parentURL, request.attributes ?? {})
    },
    load(url, options) {
      if (original === undefined) throw new Error('Native module loading is unavailable')
      return original.load(url, options)
    },
  }
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
  await ctx.loader.await()
  await vi.waitFor(() => { expect(ctx.slots.entries('settings.section')).toHaveLength(1) })
  const entry = ctx.slots.entries('settings.section')[0]
  if (entry === undefined || entry.inject === undefined) throw new Error('Terminal settings contribution is not registered')
  // SlotRegistry erases the feature-specific injected fields in its inspection view.
  const injected = entry.inject() as Record<string, unknown> & TerminalSettingsInjected
  await vi.waitFor(() => { expect(injected.hooks.preferences.getSnapshot().status).toBe('ready') })
  return { ctx, host, mutate, describeSettings, entry, injected }
}

describe('terminal settings through real Client Loader composition', () => {
  it('saves, recovers a revision conflict, resets only terminal overrides, and disposes its contribution', async () => {
    const b = await load()
    expect(resolveSlotLabel(b.entry.options.label)).toBe('Terminal')
    await expect(b.injected.checkCapability()).resolves.toEqual({ status: 'available' })
    await expect(b.injected.save({ terminalShell: 'chosen-shell', terminalFontSize: 17 }, 1)).resolves.toBe(true)
    expect(b.host.user).toEqual({ openByDefault: true, terminalShell: 'chosen-shell', terminalFontSize: 17 })
    expect(b.injected.hooks.preferences.getSnapshot().revision).toBe(2)
    const calls = b.mutate.mock.calls.length
    await expect(b.injected.save({ terminalFontSize: 17 }, 2)).resolves.toBe(false)
    expect(b.mutate).toHaveBeenCalledTimes(calls)
    b.host.revision = 3
    b.host.user.terminalFontSize = 23
    await expect(b.injected.save({ terminalFontSize: 19 }, 2)).rejects.toThrow()
    expect(b.injected.hooks.preferences.getSnapshot()).toMatchObject({ revision: 3, value: { terminalFontSize: 23 } })
    expect(b.describeSettings.mock.calls.length).toBeGreaterThan(1)
    await expect(b.injected.reset(3)).resolves.toBe(true)
    expect(b.host.user).toEqual({ openByDefault: true })
    expect(b.injected.hooks.preferences.getSnapshot().value).toMatchObject({ terminalShell: '', terminalFontSize: 13 })
    const owner = [...b.ctx.loader.entries()].find(row => row.options.name === '@deepseek-ai/dsh-client-ui-settings-terminal')!
    await owner.fiber!.dispose()
    expect(b.ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
  })
})
