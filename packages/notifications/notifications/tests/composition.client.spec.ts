/** Real file-backed notification ownership across Loader page and owner lifetimes. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SettingsFile from '@deepseek-ai/dsh-settings-file'
import * as Page from '@deepseek-ai/dsh-client-ui-notifications'
import * as Notifications from '../src/index.ts'

it('persists quiet hours through provider restart and resets them without removing unrelated preferences', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notifications-composition-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await writeFile(join(root, 'settings.yaml'), 'notifications:\n  enabled: true\n  sound: pop\n')
  const rows = [
    { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: join(root, 'settings.yaml'), watch: false } },
    { id: 'owner', name: '@deepseek-ai/dsh-notifications' },
    { id: 'page', name: '@deepseek-ai/dsh-client-ui-notifications' },
  ]
  const filename = join(root, 'cordis.yml')
  await writeFile(filename, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', SettingsFile],
    ['@deepseek-ai/dsh-notifications', Notifications],
    ['@deepseek-ai/dsh-client-ui-notifications', Page],
  ])
  // The source fixture supplies the same namespace objects the Loader imports from packages.
  ctx.loader.internal = {
    version: 'v2',
    get loadCache(): never { throw new Error('Fixture imports do not expose the native module cache') },
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected notification fixture module: ' + specifier)
      return modules.get(specifier)
    },
    register() { throw new Error('Fixture imports do not register native loader hooks') },
    getOrCreateModuleJob() { return Promise.reject(new Error('Fixture imports do not create native module jobs')) },
    resolveSync() { throw new Error('Fixture imports do not resolve native module jobs') },
    load() { return Promise.reject(new Error('Fixture imports do not load native module sources')) },
  } satisfies ModuleLoaderV2
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(filename).href } })
  await ctx.loader.await()
  const owner = [...ctx.loader.entries()].find(entry => entry.options.id === 'owner')
  const page = [...ctx.loader.entries()].find(entry => entry.options.id === 'page')
  const provider = [...ctx.loader.entries()].find(entry => entry.options.id === 'settings')
  if (owner === undefined || page === undefined || provider === undefined) throw new Error('missing notification fixture rows')
  expect(owner.fiber?.state).toBe(FiberState.ACTIVE)
  expect(page.fiber?.state).toBe(FiberState.ACTIVE)
  const initial = ctx.settings.describe().find(row => row.ns === 'notifications')!
  await ctx.settings.mutate('notifications', [
    { op: 'set', path: ['quietHoursEnabled'], value: true },
    { op: 'set', path: ['quietHoursStart'], value: '23:30' },
    { op: 'set', path: ['quietHoursEnd'], value: '06:15' },
  ], initial.revision)
  const persisted = await readFile(join(root, 'settings.yaml'), 'utf8')
  expect(persisted).toContain('quietHoursEnabled: true')
  expect(persisted).toMatch(/quietHoursStart: ['"]?23:30['"]?/)
  expect(persisted).toMatch(/quietHoursEnd: ['"]?06:15['"]?/)
  await expect(ctx.settings.mutate('notifications', [
    { op: 'set', path: ['quietHoursEnd'], value: '09:00' },
  ], initial.revision)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  expect(await readFile(join(root, 'settings.yaml'), 'utf8')).toBe(persisted)
  await provider.update({ disabled: true })
  await provider.update({ disabled: false })
  await ctx.loader.await()
  expect(ctx.settings.get('notifications')).toMatchObject({
    enabled: true, sound: 'pop', quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15',
  })
  await page.update({ disabled: true })
  expect(ctx.settings.get('notifications')).toMatchObject({ quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15' })
  await page.update({ disabled: false })
  await ctx.loader.await()
  expect(page.fiber?.state).toBe(FiberState.ACTIVE)
  await owner.update({ disabled: true })
  await page.update({ disabled: true })
  await page.update({ disabled: false })
  await ctx.loader.await()
  expect(ctx.settings.get('notifications')).toBeUndefined()
  await owner.update({ disabled: false })
  await ctx.loader.await()
  expect(ctx.settings.get('notifications')).toMatchObject({ enabled: true, sound: 'pop', quietHoursEnabled: true })
  const current = ctx.settings.describe().find(row => row.ns === 'notifications')!
  await ctx.settings.mutate('notifications', [
    { op: 'unset', path: ['quietHoursEnabled'] },
    { op: 'unset', path: ['quietHoursStart'] },
    { op: 'unset', path: ['quietHoursEnd'] },
  ], current.revision)
  expect(await readFile(join(root, 'settings.yaml'), 'utf8')).not.toContain('quietHours')
  await provider.update({ disabled: true })
  await provider.update({ disabled: false })
  await ctx.loader.await()
  expect(ctx.settings.get('notifications')).toMatchObject({
    enabled: true, sound: 'pop', quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00',
  })
})
