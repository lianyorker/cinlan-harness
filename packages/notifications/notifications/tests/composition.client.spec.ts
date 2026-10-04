/** Real profile-backed notification ownership across Loader page and owner lifetimes. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { expect, it, onTestFinished } from 'vitest'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import { profileComposition } from '../../../settings/settings/tests/profile-composition.ts'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '../../../settings/settings/src/index.ts'
import * as Page from '@deepseek-ai/dsh-client-ui-notifications'
import * as Notifications from '../src/index.ts'

interface PatchRow {
  readonly id?: string
  readonly config?: Record<string, unknown>
}

async function patchRows(path: string): Promise<PatchRow[]> {
  return parse(await readFile(path, 'utf8')) as PatchRow[]
}

it('persists quiet hours through profile edits and preserves entry ownership lifetimes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-notifications-composition-'))
  const baseFile = join(root, 'bundle.yml')
  await writeFile(baseFile, [
    '- id: notifications',
    "  name: '@deepseek-ai/dsh-notifications'",
    '  config:',
    '    enabled: true',
    '    sound: pop',
    '- id: page',
    "  name: '@deepseek-ai/dsh-client-ui-notifications'",
    '',
  ].join('\n'))
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.editor = ConfigEditor
  ctx.loader.builtins.settings = Settings
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-notifications', Notifications],
    ['@deepseek-ai/dsh-client-ui-notifications', Page],
  ])
  ctx.loader.internal = {
    version: 'v2', loadCache: new Map(),
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected notification fixture module: ' + specifier)
      return modules.get(specifier)
    },
    register() { throw new Error('Fixture imports do not register native loader hooks') },
    getOrCreateModuleJob() { throw new Error('Fixture imports do not create native module jobs') },
    resolveSync() { throw new Error('Fixture imports do not resolve native module jobs') },
    load() { throw new Error('Fixture imports do not load native module sources') },
  } satisfies ModuleLoaderV2
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  const patchPath = await profileComposition(ctx, root, baseFile)
  await ctx.loader.await()
  const entry = (id: string) => [...ctx.loader.entries()].find(item => item.options.id === id)
  const owner = entry('notifications')
  const page = entry('page')
  if (owner === undefined || page === undefined) throw new Error('missing notification fixture rows')
  expect(owner.fiber?.state).toBe(FiberState.ACTIVE)
  expect(page.fiber?.state).toBe(FiberState.ACTIVE)
  const settings = () => ctx.get('settings')
  const valueOf = (ns: string): unknown => settings()?.describe().find(row => row.ns === ns)?.value
  const initial = settings()?.describe().find(row => row.ns === 'notifications')
  if (initial === undefined) throw new Error('missing notification settings descriptor')
  await settings()!.mutate('notifications', [
    { op: 'set', path: ['quietHoursEnabled'], value: true },
    { op: 'set', path: ['quietHoursStart'], value: '23:30' },
    { op: 'set', path: ['quietHoursEnd'], value: '06:15' },
  ], initial.revision)
  const persisted = await patchRows(patchPath)
  expect(persisted.find(row => row.id === 'notifications')?.config).toMatchObject({
    quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15',
  })
  await expect(settings()!.mutate('notifications', [
    { op: 'set', path: ['quietHoursEnd'], value: '09:00' },
  ], initial.revision)).rejects.toMatchObject({ code: 'SETTINGS_CONFLICT' })
  expect(await patchRows(patchPath)).toEqual(persisted)
  expect(valueOf('notifications')).toMatchObject({
    enabled: true, sound: 'pop', quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15',
  })
  await page.update({ disabled: true })
  expect(valueOf('notifications')).toMatchObject({ quietHoursEnabled: true, quietHoursStart: '23:30', quietHoursEnd: '06:15' })
  await page.update({ disabled: false })
  await ctx.loader.await()
  expect(page.fiber?.state).toBe(FiberState.ACTIVE)
  await owner.update({ disabled: true })
  await page.update({ disabled: true })
  await page.update({ disabled: false })
  await ctx.loader.await()
  expect(valueOf('notifications')).toBeUndefined()
  await owner.update({ disabled: false })
  await ctx.loader.await()
  expect(valueOf('notifications')).toMatchObject({ enabled: true, sound: 'pop', quietHoursEnabled: true })
  const current = settings()?.describe().find(row => row.ns === 'notifications')
  if (current === undefined) throw new Error('notification settings did not return after owner restart')
  await settings()!.mutate('notifications', [
    { op: 'unset', path: ['quietHoursEnabled'] },
    { op: 'unset', path: ['quietHoursStart'] },
    { op: 'unset', path: ['quietHoursEnd'] },
  ], current.revision)
  expect(JSON.stringify(await patchRows(patchPath))).not.toContain('quietHours')
  expect(valueOf('notifications')).toMatchObject({
    enabled: true, sound: 'pop', quietHoursEnabled: false, quietHoursStart: '22:00', quietHoursEnd: '08:00',
  })
})
