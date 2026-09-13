import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkItemsRuntime, { WorkItemId, WorkItemsError } from '../src/index.ts'
import type { WorkItem, WorkItemMutation, WorkItemsWriter, WorkItemWriteId } from '../src/types.ts'
import { workItemWriteDomain } from '../src/write-domain.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const roots: Context[] = []
const item: WorkItem = {
  id: WorkItemId('github:acme/repo#1'), source: 'github', externalId: '1', title: 'Repair', body: 'Description',
  state: 'open', url: 'https://github.com/acme/repo/issues/1', labels: [], assignees: [], updatedAt: '2026-09-06T00:00:00Z',
}
const comment: WorkItemMutation = { kind: 'comment', id: item.id, body: 'Ready for review' }
async function harness(pool = new MemoryMediaPool(), writerOverride?: Partial<WorkItemsWriter>, ttl = 300_000) {
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  await ctx.plugin(WorkItemsRuntime, { writeApprovalTtlMs: ttl })
  const writer: WorkItemsWriter = {
    scope: 'github:acme/repo', validate: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ itemId: item.id, url: item.url })), ...writerOverride,
  }
  const get = vi.fn(async () => item)
  const provider = { id: 'github' as const, available: () => true, list: async () => ({ items: [item], truncated: false }), get, writer }
  ctx.workItems.registerProvider(provider)
  return { ctx, service: ctx.workItems, get, writer, provider, pool }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.useRealTimers()
})

describe('durable Work Items write approval', () => {
  it('never dispatches on preview, cancel, unknown id, or malformed payload', async () => {
    const h = await harness()
    await expect(h.service.prepareWrite({ ...comment, body: '' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(h.service.confirmWrite('unknown' as WorkItemWriteId)).rejects.toMatchObject({ code: 'write-not-found' })
    const prepared = await h.service.prepareWrite(comment)
    expect(prepared.status).toBe('prepared')
    expect(h.writer.execute).not.toHaveBeenCalled()
    expect((await h.service.cancelWrite(prepared.operationId)).status).toBe('canceled')
    expect((await h.service.confirmWrite(prepared.operationId)).status).toBe('canceled')
    expect(h.writer.execute).not.toHaveBeenCalled()
  })

  it('dispatches an exact approved payload once despite concurrent confirmations and restart', async () => {
    const h = await harness()
    const prepared = await h.service.prepareWrite(comment)
    const results = await Promise.all([h.service.confirmWrite(prepared.operationId), h.service.confirmWrite(prepared.operationId)])
    expect(results.map(value => value.status)).toEqual(['succeeded', 'succeeded'])
    expect(h.writer.execute).toHaveBeenCalledExactlyOnceWith(comment, expect.any(AbortSignal))
    await h.ctx.fiber.dispose()
    const restarted = await harness(h.pool)
    expect((await restarted.service.confirmWrite(prepared.operationId)).status).toBe('succeeded')
    expect(restarted.writer.execute).not.toHaveBeenCalled()
    expect((await restarted.service.listWrites('github', 5))[0]?.result).toEqual({ itemId: item.id, url: item.url })
  })

  it('rejects changed issue content or provider scope before dispatch', async () => {
    const h = await harness()
    const first = await h.service.prepareWrite(comment)
    h.get.mockResolvedValue({ ...item, title: 'Changed elsewhere' })
    expect(await h.service.confirmWrite(first.operationId)).toMatchObject({ status: 'failed', errorCode: 'write-conflict' })
    h.get.mockResolvedValue(item)
    const second = await h.service.prepareWrite(comment)
    h.provider.writer = { ...h.writer, scope: 'github:other/repo' }
    expect(await h.service.confirmWrite(second.operationId)).toMatchObject({ status: 'failed', errorCode: 'write-conflict' })
    expect(h.writer.execute).not.toHaveBeenCalled()
  })

  it('distinguishes rejected requests from unknown effects without automatic retry', async () => {
    const h = await harness(undefined, { execute: vi.fn().mockRejectedValue(new WorkItemsError('write-rejected', 'Invalid input')) })
    const first = await h.service.prepareWrite(comment)
    expect(await h.service.confirmWrite(first.operationId)).toMatchObject({ status: 'failed', errorCode: 'write-rejected' })
    h.provider.writer = { ...h.writer, execute: vi.fn().mockRejectedValue(new Error('connection lost')) }
    const second = await h.service.prepareWrite(comment)
    expect(await h.service.confirmWrite(second.operationId)).toMatchObject({ status: 'unknown', errorCode: 'provider-failed' })
    expect((await h.service.confirmWrite(second.operationId)).status).toBe('unknown')
    expect(h.provider.writer.execute).toHaveBeenCalledOnce()
  })

  it('recovers running records as unknown and never sends them again', async () => {
    const h = await harness()
    const prepared = await h.service.prepareWrite(comment)
    await h.ctx.fiber.dispose()
    const ctx = new Context()
    roots.push(ctx)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(h.pool))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    const domain = await facility.open(workItemWriteDomain)
    const table = domain.table('operations')
    const record = table.get(prepared.operationId)!
    await table.put(prepared.operationId, { ...record, status: 'running' })
    await domain.close()
    const restarted = await harness(h.pool)
    expect((await restarted.service.confirmWrite(prepared.operationId)).status).toBe('unknown')
    expect(restarted.writer.execute).not.toHaveBeenCalled()
  })

  it('requires durable admission and preserves no-effect writes after storage failure', async () => {
    const h = await harness()
    h.pool.failNextWrites = 1
    await expect(h.service.prepareWrite(comment)).rejects.toThrow('injected write failure')
    expect(h.writer.execute).not.toHaveBeenCalled()
    const prepared = await h.service.prepareWrite(comment)
    h.pool.failNextWrites = 1
    expect((await h.service.confirmWrite(prepared.operationId)).status).toBe('failed')
    expect(h.writer.execute).not.toHaveBeenCalled()
  })

  it('never repeats an external effect when saving its success receipt fails', async () => {
    const pool = new MemoryMediaPool()
    const h = await harness(pool, { execute: vi.fn(async () => {
      pool.failNextWrites = 1
      return { itemId: item.id, url: item.url }
    }) })
    const prepared = await h.service.prepareWrite(comment)
    await expect(h.service.confirmWrite(prepared.operationId)).rejects.toThrow('injected write failure')
    expect((await h.service.confirmWrite(prepared.operationId)).status).toBe('running')
    await h.ctx.fiber.dispose()
    const restarted = await harness(pool)
    expect((await restarted.service.confirmWrite(prepared.operationId)).status).toBe('unknown')
    expect(restarted.writer.execute).not.toHaveBeenCalled()
  })

  it('expires an approval and rejects writes when provider support is disabled', async () => {
    const h = await harness()
    const draft = await h.service.prepareWrite(comment)
    vi.useFakeTimers()
    vi.setSystemTime(draft.expiresAt + 1)
    expect((await h.service.confirmWrite(draft.operationId)).status).toBe('expired')
    expect(h.writer.execute).not.toHaveBeenCalled()
    vi.useRealTimers()
    const noStorage = new Context()
    roots.push(noStorage)
    await noStorage.plugin(WorkItemsRuntime)
    await expect(noStorage.workItems.prepareWrite(comment)).rejects.toMatchObject({ code: 'configured-missing' })
  })

  it('bounds history and isolates returned previews from caller mutation', async () => {
    const h = await harness()
    const draft = await h.service.prepareWrite(comment)
    ;(draft.mutation as { body: string }).body = 'tampered'
    expect((await h.service.confirmWrite(draft.operationId)).mutation).toEqual(comment)
    await expect(h.service.listWrites('github', 101)).rejects.toMatchObject({ code: 'invalid-request' })
    expect(await h.service.listWrites('linear', 5)).toEqual([])
  })
})
