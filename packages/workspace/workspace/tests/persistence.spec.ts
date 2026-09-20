/** Workspace persistence through production Loader rows and the JSON backend. */
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import WorkspaceRegistry, { WorkspaceId } from '../src/index.ts'
import { remoteBinding, remoteBindings } from './remote-fixture.ts'

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-execution-persistence-')))
  const contexts: Context[] = []
  onTestFinished(async () => {
    try { for (const ctx of contexts.reverse()) await ctx.fiber.dispose() }
    finally { await rm(root, { recursive: true, force: true }) }
  })
  const storage = join(root, 'storage')
  await mkdir(storage)
  let index = 0
  return {
    root, file: join(storage, 'workspace.json'),
    async boot() {
      const ctx = new Context()
      contexts.push(ctx)
      const executionBindings = remoteBindings()
      const bindingFixture = { name: 'workspace-execution-fixture', apply(ctx: Context) {
        ctx.provide('executionBindings', executionBindings as never)
      } }
      const modules = new Map<string, unknown>([
        ['storage', Storage], ['storage-json', StorageJson], ['storage-domain', StorageDomain],
        ['session-persistence', JsonlSessionPersistence], ['workspace', WorkspaceRegistry],
        ['execution-fixture', bindingFixture],
      ])
      const config = join(root, 'cordis-' + String(++index) + '.yml')
      await writeFile(config, [
        { name: 'storage' }, { name: 'storage-json', config: { root: storage } },
        { name: 'storage-domain', config: { backend: 'json' } },
        { name: 'session-persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
        { name: 'execution-fixture' }, { name: 'workspace' },
      ].map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
      ctx.baseUrl = pathToFileURL(root).href + '/'
      await ctx.plugin(Loader)
      ctx.loader.builtins.include = Include
      ctx.loader.internal = { version: 'v2', async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('unexpected Workspace fixture import: ' + specifier)
        return modules.get(specifier)
      } } as unknown as NonNullable<typeof ctx.loader.internal>
      await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
      await ctx.loader.await()
      return { ctx, registry: ctx.workspaceRegistry, executionBindings }
    },
  }
}

describe('Workspace execution persistence through Loader', () => {
  it('preserves v2 local records, order, archive state and timestamps, then writes v3 and reopens SSH snapshots offline', async () => {
    const h = await fixture()
    const localPath = join(h.root, 'local')
    await mkdir(localPath)
    const id = WorkspaceId('legacy-workspace')
    const legacy = { path: localPath, title: 'Legacy', sessionIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' }
    await writeFile(h.file, JSON.stringify({ unit: { name: 'workspace', version: 2 },
      global: { initialized: true, workspaceIds: [id], archivedSessionIds: ['archived'] },
      tables: { workspaces: { [id]: legacy } },
    }))
    const first = await h.boot()
    const local = first.registry.get(id)!
    expect(local.execution).toEqual({ kind: 'local' })
    expect(local.createdAt).toBe(legacy.createdAt)
    expect(local.updatedAt).toBe(legacy.updatedAt)
    expect(local.title).toBe('Legacy')
    expect(first.registry.archivedSessionIds).toEqual(['archived'])
    const remote = await first.registry.create('/configured-link', undefined, remoteBinding())
    expect(remote.path).toBe('/canonical/project')
    expect(first.registry.list().map(item => item.id)).toEqual([remote.id, id])
    const saved: unknown = JSON.parse(await readFile(h.file, 'utf8'))
    expect(saved).toMatchObject({ unit: { version: 3 }, tables: { workspaces: {
      [id]: legacy, [remote.id]: { execution: remoteBinding() },
    } } })
    expect(JSON.stringify(saved)).not.toContain('privateKeyFile')
    await first.ctx.fiber.dispose()
    const second = await h.boot()
    expect(second.registry.list().map(item => item.id)).toEqual([remote.id, id])
    expect(second.registry.get(id)!.execution).toEqual({ kind: 'local' })
    expect(second.registry.get(remote.id)!.execution).toEqual(remoteBinding())
    expect(second.registry.get(remote.id)!.path).toBe('/canonical/project')
    expect(second.registry.archivedSessionIds).toEqual(['archived'])
    expect(second.executionBindings.acquire).not.toHaveBeenCalled()
  })
})
