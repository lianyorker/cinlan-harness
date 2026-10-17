/** Controller tests: the Remote must transparently persist through the store and report failures as wire results, never throws. */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import QuickCommands from '@deepseek-ai/dsh-terminal-quick-commands'
import Controller from '../src/index.ts'
import type { QuickCommandHostId } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function load(ctx: Context, root: string, rows: readonly object[], modules: ReadonlyMap<string, unknown>): Promise<void> {
  await mkdir(root, { recursive: true })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  const file = join(root, 'cordis.yml')
  await writeFile(file, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected quick-command controller fixture import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
}

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'clh-quick-commands-controller-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  const rows = [
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: join(root, 'storage') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { name: '@deepseek-ai/dsh-terminal-quick-commands' },
  ]
  await load(ctx, join(root, 'registry'), rows, new Map<string, unknown>([
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-terminal-quick-commands', QuickCommands],
  ]))
  // The Gateway-facing typert registry is host infrastructure; the Remote CRUD
  // contract under test never touches it, so a stub satisfies the inject seat.
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const controller = new Controller(ctx)
  return { controller, ctx }
}

const local = 'local' as QuickCommandHostId

describe('Terminal quick-commands controller', () => {
  it('creates through the Remote and lists for the owning host', async () => {
    const { controller } = await bench()
    const created = await controller.create({ draft: { hostId: local, name: 'Build', command: 'pnpm build' } })
    expect(created.ok).toBe(true)
    const list = controller.list({ hostId: local })
    expect(list.commands).toHaveLength(1)
    expect(list.commands[0]).toMatchObject({ name: 'Build', command: 'pnpm build', hostId: local })
    expect(list.hosts).toContain(local)
  })

  it('reports validation failures through the wire result instead of throwing', async () => {
    const { controller } = await bench()
    const created = await controller.create({ draft: { hostId: local, name: '   ', command: 'ls' } })
    expect(created).toEqual({ ok: false, reason: 'invalid-name' })
    expect(controller.list({ hostId: local }).commands).toHaveLength(0)
  })

  it('updates and removes through the Remote', async () => {
    const { controller } = await bench()
    const created = await controller.create({ draft: { hostId: local, name: 'One', command: 'one' } })
    if (!created.ok || created.value === undefined || !('id' in created.value)) throw new Error('create returned no command')
    const updated = await controller.update({ id: created.value.id, draft: { hostId: local, name: 'One renamed', command: 'one --flag' } })
    expect(updated.ok).toBe(true)
    const removed = await controller.remove({ id: created.value.id })
    expect(removed.ok).toBe(true)
    expect(controller.list({ hostId: local }).commands).toHaveLength(0)
  })

  it('names an unknown command rather than inventing a deletion', async () => {
    const { controller } = await bench()
    expect(await controller.remove({ id: 'missing' as never })).toEqual({ ok: false, reason: 'unknown-command' })
  })
})
