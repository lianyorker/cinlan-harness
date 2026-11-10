import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageSqlite from '@deepseek-ai/dsh-storage-sqlite'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { executeModelToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
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
  return executeModelToolFixture(ctx, {
    callId: ToolCallId(`knowledge-${++counter}`),
    name,
    arguments: args,
    agent: { id: 'agent-test', ctx } as never,
    signal: new AbortController().signal,
  })
}

/** Assert one success outcome and return its object canonical value for field checks. */
function valueOf(result: Awaited<ReturnType<typeof call>>): Record<string, JsonValue> {
  if (result.isError) throw new Error(`expected tool success: ${result.error.message}`)
  if (typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) {
    throw new Error('expected an object canonical value')
  }
  return result.value
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
    const hits = valueOf(result).hits as JsonValue[]
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ heading: '操作指南' })
    // An empty query still answers (empty page), not an error.
    const empty = await call(ctx, 'knowledge_search', { query: '   ' })
    expect(valueOf(empty).hits).toEqual([])
  })

  it('caps limit and lists documents', async () => {
    const ctx = await setup()
    const limited = await call(ctx, 'knowledge_search', { query: '服务', limit: 500 })
    expect((valueOf(limited).hits as JsonValue[]).length).toBeLessThanOrEqual(20)

    const list = await call(ctx, 'knowledge_list_documents', {})
    const documents = valueOf(list).documents as JsonValue[]
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({ path: 'guide.md' })
    expect(typeof (documents[0] as Record<string, JsonValue>).indexedAt).toBe('number')
  })
})
