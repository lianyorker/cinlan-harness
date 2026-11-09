import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import { KnowledgeBaseService } from '@cinlan/knowledge-base'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

async function makeContext(): Promise<{ ctx: Context; home: string }> {
  const home = await mkdtemp(join(tmpdir(), 'knowledge-base-'))
  directories.push(home)
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(home, 'harness.db') })
  return { ctx, home }
}

async function makeCorpus(home: string): Promise<string> {
  const root = join(home, 'docs')
  await mkdir(join(root, 'guide'), { recursive: true })
  await writeFile(join(root, 'readme.md'), '# 部署指南\n\n使用 Docker 部署网关服务。\n\n网关默认监听 8080 端口。\n')
  await writeFile(
    join(root, 'guide', 'config.txt'),
    'The gateway configuration file lives at config.yaml.\nEvery restart reloads the file from disk.\n',
  )
  return root
}

describe('KnowledgeBaseService', () => {
  it('ingests a directory, deduplicates by hash, and removes vanished files', async () => {
    const { ctx, home } = await makeContext()
    const root = await makeCorpus(home)
    await ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })

    const first = await ctx.knowledgeBase.ingest({ root })
    expect(first).toMatchObject({ added: 2, updated: 0, removed: 0, unchanged: 0 })
    expect(ctx.knowledgeBase.listDocuments().map(document => document.path).sort())
      .toEqual(['guide/config.txt', 'readme.md'])

    // Re-ingest without changes: everything is unchanged.
    const second = await ctx.knowledgeBase.ingest({ root })
    expect(second).toMatchObject({ added: 0, updated: 0, removed: 0, unchanged: 2 })

    // Change one file, delete the other: one update and one removal.
    await writeFile(join(root, 'readme.md'), '# 部署指南 v2\n\n使用 Docker Compose 部署。\n')
    await rm(join(root, 'guide', 'config.txt'))
    const third = await ctx.knowledgeBase.ingest({ root })
    expect(third).toMatchObject({ added: 0, updated: 1, removed: 1, unchanged: 0 })
    expect(ctx.knowledgeBase.listDocuments().map(document => document.path)).toEqual(['readme.md'])
    await ctx.fiber.dispose()
  })

  it('answers paragraph-level searches with heading context', async () => {
    const { ctx, home } = await makeContext()
    const root = await makeCorpus(home)
    await ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })
    await ctx.knowledgeBase.ingest({ root })

    const hits = ctx.knowledgeBase.search('网关 端口')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.docId).toBeTruthy()
    expect(hits[0]!.heading).toBe('部署指南')
    expect(hits[0]!.title).toBe('部署指南')

    const english = ctx.knowledgeBase.search('gateway configuration')
    expect(english.length).toBeGreaterThan(0)
    expect(english[0]!.heading).toBe('')

    // An empty query answers an empty page, not an error.
    expect(ctx.knowledgeBase.search('   ')).toEqual([])
    await ctx.fiber.dispose()
  })

  it('survives reopen: the KV unit replays and the index reconciles', async () => {
    const { ctx, home } = await makeContext()
    const root = await makeCorpus(home)
    const indexPath = join(home, 'knowledge.index.db')
    await ctx.plugin(KnowledgeBaseService, { indexPath })
    await ctx.knowledgeBase.ingest({ root })
    await ctx.fiber.dispose()

    // A fresh context on the same paths: the unit is authoritative, the
    // index file still holds the previous mirror — init reconciles it.
    const ctx2 = new Context()
    await ctx2.plugin(Storage)
    await ctx2.plugin(StorageSqlite, { path: join(home, 'harness.db') })
    await ctx2.plugin(KnowledgeBaseService, { indexPath })
    expect(ctx2.knowledgeBase.listDocuments()).toHaveLength(2)
    expect(ctx2.knowledgeBase.search('网关 部署').length).toBeGreaterThan(0)
    await ctx2.fiber.dispose()
  })

  it('removeDocument drops the doc, its chunks, and its index rows', async () => {
    const { ctx, home } = await makeContext()
    const root = await makeCorpus(home)
    await ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })
    await ctx.knowledgeBase.ingest({ root })

    const [target] = ctx.knowledgeBase.listDocuments().filter(document => document.path === 'readme.md')
    await ctx.knowledgeBase.removeDocument(target!.docId)
    expect(ctx.knowledgeBase.listDocuments().map(document => document.path)).toEqual(['guide/config.txt'])
    expect(ctx.knowledgeBase.search('部署指南')).toEqual([])
    await expect(ctx.knowledgeBase.removeDocument(target!.docId)).rejects.toThrow(/unknown document/)
    await ctx.fiber.dispose()
  })
})
