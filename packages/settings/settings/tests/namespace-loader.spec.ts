/** Real Loader entry activation changes the existing Settings controller view. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SettingsController from '@deepseek-ai/dsh-api-settings-controller'
import Schema from '@deepseek-ai/schemastery'
import { expect, it } from 'vitest'
import { MemorySettings } from './memory.ts'

it('publishes controller namespace availability after configured Loader enable and disable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-settings-namespaces-'))
  const ctx = new Context()
  try {
    const path = join(root, 'cordis.yml')
    await writeFile(path, JSON.stringify([
      { id: 'settings', name: 'fixture-settings' },
      { id: 'settings-controller', name: 'settings-controller' },
      { id: 'browser', name: 'fixture-browser', disabled: true },
    ]))
    const modules = new Map<string, unknown>([
      ['fixture-settings', MemorySettings], ['settings-controller', SettingsController],
      ['fixture-browser', { name: 'fixture-browser', inject: ['settings'], apply(scope: Context) {
        scope.settings.register('browser-playwright', Schema.object({ headed: Schema.boolean().default(false) }))
      } }],
    ])
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error('Unexpected test module: ' + name)
      return modules.get(name)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
    await ctx.loader.await()
    for (const entry of ctx.loader.entries()) await entry.fiber?.await()
    const controller = ctx.settingsController
    expect(controller.describe().namespaces).toEqual([])
    const views: string[][] = []
    ctx.on('settings/namespaces-updated', () => {
      views.push(controller.describe().namespaces.map(row => row.ns))
    })
    const entry = [...ctx.loader.entries()].find(item => item.options.id === 'browser')
    if (entry === undefined) throw new Error('Missing configured fixture provider')
    await entry.update({ disabled: false })
    await entry.fiber?.await()
    expect(views).toEqual([['browser-playwright']])
    expect(controller.describe().namespaces[0]).toMatchObject({ ns: 'browser-playwright', value: { headed: false }, revision: 0 })
    await entry.update({ disabled: true })
    expect(views).toEqual([['browser-playwright'], []])
    await entry.update({ disabled: false })
    await entry.fiber?.await()
    expect(views).toEqual([['browser-playwright'], [], ['browser-playwright']])
    await entry.update({ disabled: true })
    expect(views.at(-1)).toEqual([])
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
