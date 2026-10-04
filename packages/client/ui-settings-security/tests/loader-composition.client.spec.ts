/** Real Client Loader composition for feature-owned capability registrations. */
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
import * as settingsPlugin from '@deepseek-ai/dsh-client-ui-settings/client'
import * as capabilitySettingsPlugin from '../src/client/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function createFixture() {
  return {
    inject: ['slots'],
    apply(ctx: Context) {
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)
      const deviceCapabilities = {}
      const settings = { describe: async () => ({ ok: true, value: { writable: false, hasDocument: false, namespaces: [] } }) }
      const remote = {
        deviceCapabilities,
        settings,
        $host: { isLoopback: true },
        $on: () => () => {},
      }
      ctx.provide('remote', remote as never)
      ctx.provide('remote.deviceCapabilities', deviceCapabilities as never)
      ctx.provide('remote.settings', settings as never)
      ctx.effect(() => ctx.slots.register({
        name: 'root',
        children: {
          'settings.section': { kind: 'list', scope: 'root' },
          'settings.section.icon': { kind: 'keyed', scope: 'root' },
        },
      } as never, () => null))
    },
  }
}

async function load(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-capability-settings-client-'))
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- id: slots', '  name: test-slot-registry',
    '- id: client-context', '  name: test-client-context',
    '- id: settings', "  name: '@deepseek-ai/dsh-client-ui-settings'",
    '- id: capability-settings', "  name: '@deepseek-ai/dsh-client-ui-settings-security'", '',
  ].join('\n'))

  const modules = new Map<string, unknown>([
    ['test-slot-registry', SlotRegistry],
    ['test-client-context', createFixture()],
    ['@deepseek-ai/dsh-client-ui-settings', settingsPlugin],
    ['@deepseek-ai/dsh-client-ui-settings-security', capabilitySettingsPlugin],
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
  return ctx
}

function sectionIds(ctx: Context): string[] {
  return ctx.slots.entries('settings.section').map(entry => entry.options.id as string).sort()
}

async function expectSections(ctx: Context, expected: string[]): Promise<void> {
  await vi.waitFor(() => { expect(sectionIds(ctx)).toEqual([...expected].sort()) })
}

describe('capability settings through real Client Loader composition', () => {
  it('activates the Mobile Emulator section through the Loader', async () => {
    const ctx = await load()
    await expectSections(ctx, ['cinlan-mobile'])
  })

  it('registers the Mobile Emulator metadata and icon with the section', async () => {
    const ctx = await load()
    await vi.waitFor(() => { expect(ctx.slots.entries('settings.section.icon')).toHaveLength(1) })
    expect(ctx.slots.entries('settings.section.icon')[0]!.options.key).toBe('cinlan-mobile')
    expect(ctx.settingsMetadata.getSnapshot().items.some(item => item.anchorId === 'mobile-agent')).toBe(true)
  })
})
