/** Real Client Loader composition for Cinlan account record updates. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as settingsPlugin from '@deepseek-ai/dsh-client-ui-settings/client'
import * as accountPlugin from '../src/client/index.ts'
import type { CinlanAccountInjected } from '../src/client/CinlanAccountSection.tsx'
import type { Sub2ApiAccountState } from '@deepseek-ai/dsh-api-account-controller/types'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const read = vi.fn(async (): Promise<{ ok: true; value: Sub2ApiAccountState }> => ({ ok: true, value: { signedIn: false, inFlight: false } }))
const events = new Map<string, (key: string) => void>()
function createFixture() {
  return {
    inject: ['slots'],
    apply(ctx: Context) {
      ctx.provide('connection', { rpc: { call: vi.fn() } })
      const locale = new LocaleRuntime(ctx)
      locale.setLocale('en')
      ctx.provide('locale', locale)
      const account = { getSub2ApiState: read }
      const settings = { describe: async () => ({ ok: true, value: { writable: false, hasDocument: false, namespaces: [] } }) }
      const remote = {
        account,
        settings,
        $host: { isLoopback: true },
        $on: (event: string, listener: (key: string) => void) => { events.set(event, listener); return () => { events.delete(event) } },
      }
      ctx.provide('remote', remote as never)
      ctx.provide('remote.account', account as never)
      ctx.provide('remote.session', {} as never)
      ctx.provide('theme', {} as never)
      ctx.provide('remote.settings', settings as never)
      ctx.effect(() => ctx.slots.register({
        name: 'root',
        children: {
          'settings.section': { kind: 'list', scope: 'root' },
          'settings.section.icon': { kind: 'keyed', scope: 'root' },
          main: { kind: 'keyed', scope: 'root' },
          'sidebar.panellist': { kind: 'list', scope: 'root' },
        },
      } as never, () => null))
    },
  }
}

async function load(): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-cinlan-account-client-'))
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- id: slots', '  name: test-slot-registry',
    '- id: client-context', '  name: test-client-context',
    '- id: settings', "  name: '@deepseek-ai/dsh-client-ui-settings'",
    '- id: capability-settings', "  name: '@deepseek-ai/dsh-client-ui-settings-account'", '',
  ].join('\n'))

  const modules = new Map<string, unknown>([
    ['test-slot-registry', SlotRegistry],
    ['test-client-context', createFixture()],
    ['@deepseek-ai/dsh-client-ui-settings', settingsPlugin],
    ['@deepseek-ai/dsh-client-ui-settings-account', accountPlugin],
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

it('refreshes the Cinlan record, ignores stale reads and removes its listener on disposal', async () => {
  const ctx = await load()
  await vi.waitFor(() => expect(ctx.slots.entries('settings.section').some(item => item.options.id === 'cinlan-account')).toBe(true))
  const entry = ctx.slots.entries('settings.section').find(item => item.options.id === 'cinlan-account')!
  const injected: object = entry.inject!()
  const actions = injected as CinlanAccountInjected
  await actions.refresh()
  expect(actions.hooks.state.getSnapshot().state?.signedIn).toBe(false)
  read.mockClear()
  events.get('credentials/record-updated')?.('llm-pi-ai/other')
  expect(read).not.toHaveBeenCalled()
  const pending = Promise.withResolvers<{ ok: true; value: Sub2ApiAccountState }>()
  read.mockImplementationOnce(() => pending.promise)
  const stale = actions.refresh()
  events.get('credentials/record-updated')?.('llm-pi-ai/sub2api')
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  pending.resolve({ ok: true, value: { signedIn: true, inFlight: false } })
  await stale
  expect(actions.hooks.state.getSnapshot().state?.signedIn).toBe(false)
  read.mockResolvedValue({ ok: true, value: { signedIn: true, inFlight: false } })
  events.get('credentials/record-updated')?.('llm-pi-ai/sub2api')
  await vi.waitFor(() => expect(actions.hooks.state.getSnapshot().state?.signedIn).toBe(true))
  await ctx.fiber.dispose()
  expect(events.has('credentials/record-updated')).toBe(false)
})
