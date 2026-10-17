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
import TerminalQuickCommands, { LOCAL_QUICK_COMMAND_HOST, validateDraft } from '../src/index.ts'
import type { QuickCommandHostId, QuickCommandId } from '../src/types.ts'

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Mount the production Loader rows so the test exercises real composition. */
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
      if (!modules.has(specifier)) throw new Error('unexpected quick-command fixture import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(file).href } })
  await ctx.loader.await()
}

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'clh-quick-commands-'))
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
    ['@deepseek-ai/dsh-terminal-quick-commands', TerminalQuickCommands],
  ]))
  return ctx.terminalQuickCommands
}

const local = LOCAL_QUICK_COMMAND_HOST as QuickCommandHostId
const remote = 'ssh:build-box' as QuickCommandHostId

describe('Terminal quick commands', () => {
  it('stores a command and reads it back for its own host', async () => {
    const service = await bench()
    const created = await service.create({ hostId: local, name: '  Build  ', command: 'pnpm build', cwd: '/work' })
    expect(created.ok).toBe(true)
    const list = service.list(local)
    expect(list.commands).toHaveLength(1)
    expect(list.commands[0]).toMatchObject({ hostId: local, name: 'Build', command: 'pnpm build', cwd: '/work', confirm: false })
  })

  it('never returns another host\'s commands', async () => {
    const service = await bench()
    await service.create({ hostId: local, name: 'Local', command: 'ls' })
    await service.create({ hostId: remote, name: 'Remote', command: 'uname -a' })
    expect(service.list(local).commands.map(c => c.name)).toEqual(['Local'])
    expect(service.list(remote).commands.map(c => c.name)).toEqual(['Remote'])
    expect(service.hosts()).toContain(remote)
  })

  it('moves a command between hosts and reports both sides', async () => {
    const service = await bench()
    const created = await service.create({ hostId: local, name: 'Ship', command: 'deploy' })
    if (!created.ok || !('id' in created.value)) throw new Error('create did not return one command')
    const updated = await service.update(created.value.id, { hostId: remote, name: 'Ship', command: 'deploy' })
    expect(updated.ok).toBe(true)
    expect(service.list(local).commands).toHaveLength(0)
    expect(service.list(remote).commands.map(c => c.name)).toEqual(['Ship'])
  })

  it('deletes only the named command and reports an unknown one', async () => {
    const service = await bench()
    const first = await service.create({ hostId: local, name: 'One', command: 'one' })
    await service.create({ hostId: local, name: 'Two', command: 'two' })
    if (!first.ok || !('id' in first.value)) throw new Error('create did not return one command')
    expect((await service.remove(first.value.id)).ok).toBe(true)
    expect(service.list(local).commands.map(c => c.name)).toEqual(['Two'])
    expect(await service.remove('missing-id' as QuickCommandId)).toEqual({ ok: false, reason: 'unknown-command' })
  })

  it('refuses an empty name or command instead of storing an unrunnable entry', async () => {
    const service = await bench()
    expect(await service.create({ hostId: local, name: '   ', command: 'ls' })).toEqual({ ok: false, reason: 'invalid-name' })
    expect(await service.create({ hostId: local, name: 'ok', command: '   ' })).toEqual({ ok: false, reason: 'invalid-command' })
    expect(await service.create({ hostId: local, name: 'ok', command: 'ls', cwd: '  ' })).toEqual({ ok: false, reason: 'invalid-cwd' })
    expect(service.list(local).commands).toHaveLength(0)
  })

  it('keeps creation order in the list', async () => {
    const service = await bench()
    for (const name of ['alpha', 'beta', 'gamma']) await service.create({ hostId: local, name, command: name })
    expect(service.list(local).commands.map(c => c.name)).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('normalizes a draft the same way for callers that validate first', () => {
    expect(validateDraft(' x ', 'cmd', undefined, ' note ')).toEqual({ ok: true, name: 'x', command: 'cmd', description: 'note' })
    expect(validateDraft('x', 'cmd', undefined, '  ')).toEqual({ ok: true, name: 'x', command: 'cmd' })
    expect(validateDraft('', 'cmd', undefined, undefined)).toEqual({ ok: false, reason: 'invalid-name' })
  })
})
