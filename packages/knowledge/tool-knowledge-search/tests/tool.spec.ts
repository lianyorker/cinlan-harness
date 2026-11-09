import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import KnowledgeBaseService from '@cinlan/knowledge-base'
import * as tool from '../src/index.ts'

const directories: string[] = []

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
})

let counter = 0

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'tool-knowledge-'))
  directories.push(home)
  const root = join(home, 'docs')
  await mkdir(root, { recursive: true })
  await writeFile(join(root, 'guide.md'), '# 操作指南\n\n重启服务用 systemctl restart clh。\n')
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(StorageSqlite, { path: join(home, 'harness.db') })
  await ctx.plugin(KnowledgeBaseService, { indexPath: ':memory:' })
  await ctx.knowledgeBase.ingest({ root })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(tool, {})
  return ctx
}

async function call(ctx: Context, name: string, args: unknown) {
  const batch = await ctx.tools.execute({
    calls: [{
      type: 'tool-call',
      id: ToolCallId(`knowledge-${++counter}`),
      name,
      arguments: JSON.stringify(args),
    }],
    agent: { id: 'agent-test', ctx } as never,
    signal: new AbortController().signal,
  })
  return batch.results[0]!
}

describe('tool-knowledge-search', () => {
  it('rejects a bad maxLimit at apply time', () => {
    // config validation runs before ctx.tools is touched, so a bare context is enough
    expect(() => tool.apply(new Context(), { maxLimit: 0 })).toThrow(/maxLimit/)
    expect(() => tool.apply(new Context(), { maxLimit: 1.5 })).toThrow(/maxLimit/)
  })

  it('answers search queries through the tool channel', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'knowledge_search', { query: '重启 服务' })
    expect(result.result.value.hits).toHaveLength(1)
    expect(result.result.value.hits[0]!.heading).toBe('操作指南')
    // An empty query still answers (empty page), not an error.
    const empty = await call(ctx, 'knowledge_search', { query: '   ' })
    expect(empty.result.value.hits).toEqual([])
  })

  it('caps limit and lists documents', async () => {
    const ctx = await setup()
    const limited = await call(ctx, 'knowledge_search', { query: '服务', limit: 500 })
    expect(limited.result.value.hits.length).toBeLessThanOrEqual(20)

    const list = await call(ctx, 'knowledge_list_documents', {})
    expect(list.result.value.documents).toHaveLength(1)
    expect(list.result.value.documents[0]!.path).toBe('guide.md')
    expect(typeof list.result.value.documents[0]!.indexedAt).toBe('number')
  })
})
