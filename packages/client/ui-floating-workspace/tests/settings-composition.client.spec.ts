/** Real Host composition: actual Loader + Include + settings-file, with no settings service mocks. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { afterEach, describe, expect, it } from 'vitest'
import * as floatingHost from '../src/index.ts'

const contexts: Context[] = []
const directories: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const defaults = {
  enabled: false, terminalDirectory: '', toggleButtonPosition: 'header', floatDefaultWidth: 400, floatDefaultHeight: 300,
}

async function fixture(providerDisabled = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-floating-settings-composition-'))
  directories.push(root)
  const settingsPath = join(root, 'settings.yaml')
  const configPath = join(root, 'cordis.yml')
  await writeFile(settingsPath, '{}\n')
  await writeFile(configPath, [
    '- id: settings',
    "  name: '@deepseek-ai/dsh-settings-file'",
    '  disabled: ' + String(providerDisabled),
    '  config:',
    '    path: ' + JSON.stringify(settingsPath),
    '    debounceMs: 10',
    '- id: floating',
    "  name: '@deepseek-ai/dsh-client-ui-floating-workspace'",
    '',
  ].join('\n'))
  return { root, settingsPath, configPath }
}

async function boot(files: Awaited<ReturnType<typeof fixture>>) {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(files.root).href + '/'
  await ctx.plugin(Loader).await()
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-client-ui-floating-workspace', floatingHost],
  ])
  // Only module resolution is supplied by the source-plane fixture; Include reads the real YAML.
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(files.configPath).href } })
  await ctx.loader.await()
  return ctx
}

function entry(ctx: Context, id: string) {
  const value = [...ctx.loader.entries()].find(candidate => candidate.options.id === id)
  if (value === undefined) throw new Error('Missing test composition entry: ' + id)
  return value
}

describe('Floating Workspace real Host Loader composition', () => {
  it('registers the existing defaults and accepts exactly the supported positions and boundary dimensions', async () => {
    const ctx = await boot(await fixture())
    expect(ctx.settings.get('floating-workspace')).toEqual(defaults)
    expect(ctx.settings.describe()).toHaveLength(1)
    expect(ctx.settings.describe()[0]?.ns).toBe('floating-workspace')
    for (const toggleButtonPosition of ['header', 'sidebar', 'floating']) {
      await ctx.settings.update('floating-workspace', { toggleButtonPosition })
      expect(ctx.settings.get('floating-workspace')).toMatchObject({ toggleButtonPosition })
    }
    for (const dimensions of [{ floatDefaultWidth: 200, floatDefaultHeight: 150 }, { floatDefaultWidth: 800, floatDefaultHeight: 600 }]) {
      await ctx.settings.update('floating-workspace', dimensions)
      expect(ctx.settings.get('floating-workspace')).toMatchObject(dimensions)
    }
    await ctx.settings.replace('floating-workspace', {})
    expect(ctx.settings.get('floating-workspace')).toEqual(defaults)
  })

  it('refuses invalid durable writes without changing either accepted values or file bytes', async () => {
    const files = await fixture()
    const ctx = await boot(files)
    await ctx.settings.update('floating-workspace', { enabled: true, terminalDirectory: '/saved/terminal' })
    const accepted = ctx.settings.get('floating-workspace')
    const before = await readFile(files.settingsPath, 'utf8')
    const invalid = [
      { floatDefaultWidth: 199 }, { floatDefaultWidth: 801 }, { floatDefaultWidth: 400.5 },
      { floatDefaultHeight: 149 }, { floatDefaultHeight: 601 }, { floatDefaultHeight: 300.5 },
      { toggleButtonPosition: 'panel' }, { enabled: 'true' }, { terminalDirectory: 42 },
    ]
    for (const patch of invalid) {
      await expect(ctx.settings.update('floating-workspace', patch), JSON.stringify(patch)).rejects.toThrow()
      expect(ctx.settings.get('floating-workspace')).toEqual(accepted)
      expect(await readFile(files.settingsPath, 'utf8')).toBe(before)
    }
  })

  it('preserves every explicit field, including defaults and an empty directory, across fresh Host reloads', async () => {
    const files = await fixture()
    const first = await boot(files)
    const saved = {
      enabled: true, terminalDirectory: '/saved/project', toggleButtonPosition: 'floating', floatDefaultWidth: 725, floatDefaultHeight: 455,
    }
    await first.settings.update('floating-workspace', saved)
    expect(await readFile(files.settingsPath, 'utf8')).toContain('terminalDirectory: /saved/project')
    await first.fiber.dispose()
    const second = await boot(files)
    expect(second.settings.get('floating-workspace')).toEqual(saved)
    expect(second.settings.describe()[0]?.user).toEqual(saved)
    await second.settings.update('floating-workspace', defaults)
    await second.fiber.dispose()
    const third = await boot(files)
    expect(third.settings.get('floating-workspace')).toEqual(defaults)
    expect(third.settings.describe()[0]?.user).toEqual(defaults)
  })

  it('unregisters the namespace on feature unload and restores its saved fields on Loader reactivation', async () => {
    const files = await fixture()
    const ctx = await boot(files)
    await ctx.settings.update('floating-workspace', { enabled: true, floatDefaultWidth: 640 })
    const bytes = await readFile(files.settingsPath, 'utf8')
    const feature = entry(ctx, 'floating')
    await feature.update({ disabled: true })
    await ctx.loader.await()
    expect(ctx.settings.get('floating-workspace')).toBeUndefined()
    expect(ctx.settings.describe()).toEqual([])
    expect(await readFile(files.settingsPath, 'utf8')).toBe(bytes)
    await expect(ctx.settings.update('floating-workspace', { enabled: false })).rejects.toThrow()
    await feature.update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.settings.get('floating-workspace')).toEqual({ ...defaults, enabled: true, floatDefaultWidth: 640 })
    expect(ctx.settings.describe()).toHaveLength(1)
  })

  it('follows the optional settings provider when it is enabled after the Host feature', async () => {
    const ctx = await boot(await fixture(true))
    expect(ctx.get('settings')).toBeUndefined()
    expect(entry(ctx, 'floating').fiber).toBeDefined()
    await entry(ctx, 'settings').update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.settings.get('floating-workspace')).toEqual(defaults)
    await entry(ctx, 'settings').update({ disabled: true })
    await ctx.loader.await()
    expect(ctx.get('settings')).toBeUndefined()
    await entry(ctx, 'settings').update({ disabled: false })
    await ctx.loader.await()
    expect(ctx.settings.describe()).toHaveLength(1)
    expect(ctx.settings.get('floating-workspace')).toEqual(defaults)
  })
})
