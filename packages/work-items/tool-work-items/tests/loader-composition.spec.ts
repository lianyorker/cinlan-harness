import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { WorkItem, WorkItemsProvider } from '@deepseek-ai/dsh-work-items/types'
import WorkItemsRuntime, { WorkItemId } from '@deepseek-ai/dsh-work-items'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as ToolWorkItems from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

const item: WorkItem = {
  id: WorkItemId('github:loader/repository#1'),
  source: 'github',
  externalId: '1',
  key: '#1',
  title: 'Loader fixture',
  body: 'A bounded fixture item.',
  state: 'open',
  url: 'https://github.com/loader/repository/issues/1',
  repository: 'loader/repository',
  labels: ['fixture'],
  assignees: [],
  updatedAt: '2026-09-01T00:00:00.000Z',
}

const provider: WorkItemsProvider = {
  id: 'github',
  available: () => true,
  list: () => Promise.resolve({ items: [item], truncated: false }),
  get: () => Promise.resolve(item),
}

const TestProvider = {
  name: 'test-work-items-provider',
  inject: ['workItems'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.workItems.registerProvider(provider), 'test-work-items-provider: provider')
  },
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('dsh-tool-work-items through a real cordis.yml Loader composition', () => {
  it('loads the service, provider, prompt, and six model-facing tools', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-work-items-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-work-items'",
      "- name: '@deepseek-ai/dsh-test-work-items-provider'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-tool-work-items'",
      '  config:',
      '    timeoutMs: 321',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-work-items', WorkItemsRuntime],
      ['@deepseek-ai/dsh-test-work-items-provider', TestProvider],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-tool-work-items', ToolWorkItems],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    const unloaded = [...context.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'work_items_list',
      'work_items_get',
      'work_items_prepare_write',
      'work_items_confirm_write',
      'work_items_cancel_write',
      'work_items_list_writes',
    ])
    expect(context.tools.get('work_items_list')?.timeoutMs).toBe(321)
    expect((await context.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:work-items', text: ToolWorkItems.WORK_ITEMS_SYSTEM_PROMPT,
    })

    const listed = await context.tools.execute({
      callId: ToolCallId('loader-work-items-list'),
      name: 'work_items_list',
      arguments: { source: 'github', limit: 1 },
      signal: new AbortController().signal,
    })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected a successful Work Items list')
    expect(listed.value).toEqual({ items: [item], truncated: false })

    const detail = await context.tools.execute({
      callId: ToolCallId('loader-work-items-get'),
      name: 'work_items_get',
      arguments: { id: item.id },
      signal: new AbortController().signal,
    })
    expect(detail.isError).toBe(false)
    if (detail.isError) throw new Error('expected a successful Work Items get')
    expect(detail.value).toEqual(item)
  })
})
