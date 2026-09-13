/** Test-only built-runtime worker for sequential process restart evidence. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [root, directory, phase] = process.argv.slice(2)
const load = async path => import(pathToFileURL(join(root, path)).href)
const { Context } = await load('vendor/cordis/lib/index.js')
const { default: Storage } = await load('packages/storage/storage/lib/index.js')
const { SqliteStorageBackend } = await load('packages/storage/storage-sqlite/lib/index.js')
const { DomainFacility } = await load('packages/storage/storage-domain/lib/index.js')
const { default: WorkItems } = await load('packages/work-items/work-items/lib/index.js')
const ctx = new Context()
const backend = new SqliteStorageBackend({ path: join(directory, 'write.sqlite'), journalMode: 'wal' })
const countPath = join(directory, 'effects.json')
const item = { id: 'github:acme/repo#1', source: 'github', externalId: '1', title: 'Fixture', state: 'open', url: 'https://github.com/acme/repo/issues/1', labels: [], assignees: [] }
try {
  await ctx.plugin(Storage)
  ctx.storage.backend.register('sqlite', backend)
  const domain = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  await ctx.plugin(WorkItems)
  ctx.workItems.registerProvider({
    id: 'github', available: () => true,
    list: async () => ({ items: [item], truncated: false }), get: async () => item,
    writer: {
      scope: 'acme/repo', validate: async () => {},
      execute: async () => {
        let count = 0
        try { count = JSON.parse(await readFile(countPath, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
        await writeFile(countPath, JSON.stringify(count + 1))
        if (phase === 'crash') process.exit(17)
        return { itemId: item.id, url: item.url }
      },
    },
  })
  const operation = phase === 'create' || phase === 'crash'
    ? await ctx.workItems.prepareWrite({ kind: 'comment', id: item.id, body: 'Fixture comment' })
    : (await ctx.workItems.listWrites('github', 1))[0]
  const result = await ctx.workItems.confirmWrite(operation.operationId)
  console.log(JSON.stringify({ status: result.status, effects: JSON.parse(await readFile(countPath, 'utf8')) }))
} finally {
  await ctx.fiber.dispose()
  await backend.close()
}
