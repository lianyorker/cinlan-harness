/* oxlint-disable typescript/no-unsafe-assignment -- Vitest mocks and asymmetric matchers are intentionally dynamic. */

import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { WorkItemsRuntime } from '@deepseek-ai/dsh-work-items'
import { WorkItemId } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemMutation, WorkItemPage, WorkItemWriteOperation } from '@deepseek-ai/dsh-work-items/types'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as ToolWorkItems from '../src/index.ts'

const contexts: Context[] = []
let callNumber = 0

const item: WorkItem = {
  id: WorkItemId('github:acme/repo#7'),
  source: 'github',
  externalId: '7',
  key: '#7',
  title: 'Repair the build',
  body: 'Keep the change small.',
  state: 'open',
  url: 'https://github.com/acme/repo/issues/7',
  repository: 'acme/repo',
  labels: ['bug'],
  assignees: ['alice'],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
}

const operation: WorkItemWriteOperation = {
  operationId: '11111111-1111-4111-8111-111111111111' as never,
  source: 'github',
  scope: '["acme","repo","GITHUB_TOKEN"]',
  mutation: { kind: 'comment', id: item.id, body: 'Ready for review.' },
  status: 'prepared',
  createdAt: 1_000,
  expiresAt: 301_000,
  target: { id: item.id, title: item.title, ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }) },
}

function page(): WorkItemPage {
  return { items: [{ ...item, secret: 'provider-only' } as never], nextCursor: 'next', truncated: false }
}

function serviceMock() {
  return {
    list: vi.fn(async (): Promise<WorkItemPage> => page()),
    get: vi.fn(async (): Promise<WorkItem> => ({ ...item, secret: 'provider-only' } as never)),
    prepareWrite: vi.fn(async (_mutation: WorkItemMutation): Promise<WorkItemWriteOperation> => operation),
    confirmWrite: vi.fn(async (): Promise<WorkItemWriteOperation> => ({ ...operation, status: 'succeeded', result: { itemId: item.id, url: item.url } })),
    cancelWrite: vi.fn(async (): Promise<WorkItemWriteOperation> => ({ ...operation, status: 'canceled' })),
    listWrites: vi.fn(async (): Promise<readonly WorkItemWriteOperation[]> => [operation]),
  }
}

async function setup(service = serviceMock(), config: ToolWorkItems.Config = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  ctx.provide('workItems', service as unknown as WorkItemsRuntime)
  const fiber = await ctx.plugin(ToolWorkItems, config)
  return { ctx, fiber, service }
}

async function call(ctx: Context, name: string, args: unknown): Promise<ToolExecutionResult> {
  callNumber += 1
  return ctx.tools.execute({
    callId: ToolCallId(`work-items-${callNumber}`),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
}

function success(result: ToolExecutionResult): Extract<ToolExecutionResult, { isError: false }> {
  expect(result.isError).toBe(false)
  if (result.isError) throw new Error('expected successful Work Items tool result')
  return result
}

afterEach(async () => {
  await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('tool-work-items registration and model contract', () => {
  it('registers six tools, guidance, timeout metadata, concurrency policy, and disposal', async () => {
    const { ctx, fiber } = await setup(undefined, { timeoutMs: 321 })
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'work_items_list',
      'work_items_get',
      'work_items_prepare_write',
      'work_items_confirm_write',
      'work_items_cancel_write',
      'work_items_list_writes',
    ])
    expect(ctx.tools.get('work_items_list')?.timeoutMs).toBe(321)
    expect(ctx.tools.get('work_items_list')?.isConcurrencySafe?.({})).toBe(true)
    expect(ctx.tools.get('work_items_get')?.isConcurrencySafe?.({ id: item.id })).toBe(true)
    expect(ctx.tools.get('work_items_list_writes')?.isConcurrencySafe?.({ source: 'github', limit: 1 })).toBe(true)
    expect(ctx.tools.get('work_items_prepare_write')).not.toHaveProperty('isConcurrencySafe')
    expect((await ctx.systemPrompt.assemble()).sections).toContainEqual({
      name: 'tool:work-items', text: ToolWorkItems.WORK_ITEMS_SYSTEM_PROMPT,
    })
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
    expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === 'tool:work-items')).toBe(false)
  })

  it('publishes strict schemas and generic render intent without exposing scope metadata', async () => {
    const { ctx } = await setup()
    const prepare = ctx.tools.schemas().find(schema => schema.name === 'work_items_prepare_write')!
    expect(prepare.parameters).toMatchObject({
      type: 'object',
      required: ['mutation'],
      properties: { mutation: { oneOf: expect.any(Array) } },
    })
    expect(ctx.tools.get('work_items_list')?.presentCall?.({ source: 'github' })).toEqual({
      card: 'generic', title: 'List Work Items', kind: 'read', rawInput: 'github',
    })
    expect(ctx.tools.get('work_items_prepare_write')?.presentCall?.({
      mutation: { kind: 'comment', id: item.id, body: 'note' },
    })).toMatchObject({ card: 'generic', title: 'Preview Work Items change', kind: 'execute' })
    expect(ctx.tools.get('work_items_confirm_write')?.presentCall?.({ operation_id: operation.operationId })).toEqual({
      card: 'generic', title: `Confirm Work Items operation ${operation.operationId}`, kind: 'execute', rawInput: operation.operationId,
    })
    expect(ctx.tools.get('work_items_confirm_write')?.presentCall?.({})).toBeUndefined()
  })

  it('validates direct configuration and bounded model input', async () => {
    expect(ToolWorkItems.resolveWorkItemsToolConfig()).toEqual({ timeoutMs: 60_000 })
    expect(() => ToolWorkItems.resolveWorkItemsToolConfig({ timeoutMs: 0 })).toThrow(/timeoutMs/)
    expect(() => ToolWorkItems.resolveWorkItemsToolConfig({ extra: true } as never)).toThrow(/unsupported config key/)
    const { ctx, service } = await setup()
    for (const args of [
      { scope: { source: 'github', owner: 'acme' } },
      { scope: { source: 'linear' } },
      { source: 'github', scope: { source: 'linear', team: 'team-1' } },
      { limit: 0 },
      { limit: 101 },
      { cursor: ' ' },
    ]) {
      const result = await call(ctx, 'work_items_list', args)
      expect(result.isError).toBe(true)
    }
    for (const args of [
      { mutation: { kind: 'comment', id: 'other:1', body: 'note' } },
      { mutation: { kind: 'create', source: 'github', title: ' ', body: '' } },
      { mutation: { kind: 'assign', id: item.id, assignees: [' '] } },
    ]) {
      const result = await call(ctx, 'work_items_prepare_write', args)
      expect(result.isError).toBe(true)
    }
    expect(service.list).not.toHaveBeenCalled()
    expect(service.prepareWrite).not.toHaveBeenCalled()
  })
})

describe('tool-work-items execution', () => {
  it('reads through the service with explicit structured scope and strips provider-only fields', async () => {
    const { ctx, service } = await setup()
    const listed = success(await call(ctx, 'work_items_list', {
      source: 'github',
      scope: { source: 'github', owner: 'acme', repository: 'repo' },
      state: 'all', query: 'build', cursor: 'next', limit: 20,
    }))
    expect(service.list).toHaveBeenCalledWith({
      source: 'github',
      scope: { source: 'github', owner: 'acme', repository: 'repo' },
      state: 'all', query: 'build', cursor: 'next', limit: 20,
    }, expect.any(AbortSignal))
    expect(listed.value).toEqual({
      items: [{ ...item }], nextCursor: 'next', truncated: false,
    })
    expect(JSON.stringify(listed.value)).not.toContain('provider-only')

    const detail = success(await call(ctx, 'work_items_get', { id: item.id }))
    expect(service.get).toHaveBeenCalledWith({ id: item.id }, expect.any(AbortSignal))
    expect(detail.value).toEqual(item)
  })

  it('previews exact mutations, confirms only stored ids, cancels, and lists redacted receipts', async () => {
    const { ctx, service } = await setup()
    const prepared = success(await call(ctx, 'work_items_prepare_write', {
      mutation: { kind: 'comment', id: item.id, body: 'Ready for review.' },
    }))
    expect(service.prepareWrite).toHaveBeenCalledWith(
      { kind: 'comment', id: item.id, body: 'Ready for review.' }, expect.any(AbortSignal),
    )
    expect(prepared.value).toEqual({ operation: expect.objectContaining({
      operationId: operation.operationId,
      source: 'github',
      status: 'prepared',
      mutation: { kind: 'comment', id: item.id, body: 'Ready for review.' },
      target: { id: item.id, title: item.title, ...(item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }) },
    }) })
    expect(prepared.value).not.toHaveProperty('operation.scope')
    expect(JSON.stringify(prepared.value)).not.toContain('GITHUB_TOKEN')

    const confirmed = success(await call(ctx, 'work_items_confirm_write', { operation_id: operation.operationId }))
    expect(service.confirmWrite).toHaveBeenCalledWith(operation.operationId, expect.any(AbortSignal))
    expect(confirmed.value).toMatchObject({ operation: { status: 'succeeded', result: { itemId: item.id, url: item.url } } })

    const canceled = success(await call(ctx, 'work_items_cancel_write', { operation_id: operation.operationId }))
    expect(service.cancelWrite).toHaveBeenCalledWith(operation.operationId)
    expect(canceled.value).toMatchObject({ operation: { status: 'canceled' } })

    const history = success(await call(ctx, 'work_items_list_writes', { source: 'github', limit: 20 }))
    expect(service.listWrites).toHaveBeenCalledWith('github', 20)
    expect(history.value).toMatchObject({ operations: [{ operationId: operation.operationId, status: 'prepared' }] })
    expect(JSON.stringify(history.value)).not.toContain('GITHUB_TOKEN')
  })

  it('keeps an unknown receipt terminal and never creates a replacement mutation', async () => {
    const service = serviceMock()
    service.confirmWrite.mockResolvedValue({ ...operation, status: 'unknown', errorCode: 'provider-failed' })
    const { ctx } = await setup(service)
    const result = success(await call(ctx, 'work_items_confirm_write', { operation_id: operation.operationId }))
    expect(result.value).toMatchObject({ operation: { status: 'unknown', errorCode: 'provider-failed' } })
    expect(ToolWorkItems.WORK_ITEMS_SYSTEM_PROMPT).toContain('do not retry it automatically')
  })
})
