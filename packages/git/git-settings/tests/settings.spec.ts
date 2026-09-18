/** The schema preserves durable values and one Host fiber owns registration. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { expect, it, onTestFinished } from 'vitest'
import * as plugin from '../src/index.ts'
import * as types from '../src/types.ts'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '../src/settings-schema.ts'

const defaults = {
  branchPrefix: 'none', branchPrefixCustom: '', refreshLocalBaseRefOnWorktreeCreate: false,
  sourceControlGroupOrder: 'changes-first', compareAgainstUpstream: false, enableGitHubAttribution: false,
}

it('keeps the durable namespace and all six defaults', () => {
  expect(GIT_SETTINGS_NAMESPACE).toBe('git-source-control')
  expect(GitSourceControlSettingsSchema()).toEqual(defaults)
  expect(Object.keys(types)).toEqual([])
  expect('default' in plugin).toBe(false)
})

it.each([
  { branchPrefix: 'automatic' }, { branchPrefixCustom: true }, { refreshLocalBaseRefOnWorktreeCreate: 'true' },
  { sourceControlGroupOrder: 'other' }, { compareAgainstUpstream: 1 }, { enableGitHubAttribution: 'true' },
])('rejects an invalid preference: %j', (value) => {
  expect(() => GitSourceControlSettingsSchema(value as never)).toThrow()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-git-settings-'))
  const ctx = new Context()
  onTestFinished(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { root, ctx, settingsPath: join(root, 'settings.json') }
}

it('releases namespace ownership when the contributing fiber is disposed', async () => {
  const { ctx, settingsPath } = await fixture()
  await ctx.plugin(FileSettingsProvider, { path: settingsPath, watch: false })
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  expect(ctx.settings.get(GIT_SETTINGS_NAMESPACE)).toEqual(defaults)
  expect(ctx.settings.describe()).toHaveLength(1)
  expect(() => ctx.settings.register(GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema)).toThrow('already registered')
  await fiber.dispose()
  expect(ctx.settings.get(GIT_SETTINGS_NAMESPACE)).toBeUndefined()
  expect(ctx.settings.describe()).toEqual([])
  await ctx.plugin(plugin)
  expect(ctx.settings.get(GIT_SETTINGS_NAMESPACE)).toEqual(defaults)
})

it('loads stored preferences through cordis.yml and persists changes in the same namespace', async () => {
  const { ctx, root, settingsPath } = await fixture()
  const stored = {
    branchPrefix: 'custom', branchPrefixCustom: 'team/', refreshLocalBaseRefOnWorktreeCreate: true,
    sourceControlGroupOrder: 'staged-first', compareAgainstUpstream: true, enableGitHubAttribution: true,
  }
  await writeFile(settingsPath, JSON.stringify({ [GIT_SETTINGS_NAMESPACE]: stored }))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: settingsPath, watch: false } },
    { id: 'git-settings', name: '@deepseek-ai/dsh-git-settings' },
  ]))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider], ['@deepseek-ai/dsh-git-settings', plugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect(ctx.settings.get(GIT_SETTINGS_NAMESPACE)).toEqual(stored)
  expect(ctx.settings.describe()).toHaveLength(1)
  await ctx.settings.update(GIT_SETTINGS_NAMESPACE, { branchPrefix: 'none' })
  expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
    [GIT_SETTINGS_NAMESPACE]: { ...stored, branchPrefix: 'none' },
  })
})
