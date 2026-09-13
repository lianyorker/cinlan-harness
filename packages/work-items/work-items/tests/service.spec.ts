import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import WorkItemsRuntime, { WorkItemId, WorkItemsError } from '../src/index.ts'
import type { WorkItem, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '../src/types.ts'

function item(source: 'github' | 'linear'): WorkItem {
  return { id: WorkItemId(source + ':one'), source, externalId: 'one', title: 'One', state: 'open', url: 'https://example.com/item', labels: [], assignees: [] }
}
function completeItem(source: 'github' | 'linear'): WorkItem {
  return {
    ...item(source),
    key: 'KEY-1',
    body: '',
    repository: 'acme/repo',
    labels: ['bug'],
    assignees: ['alice'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }
}
function provider(source: 'github' | 'linear', usable = true) {
  return {
    id: source, available: () => usable,
    list: vi.fn(async (_request: WorkItemListRequest): Promise<WorkItemPage> => ({ items: [item(source)], truncated: false })),
    get: vi.fn(async () => item(source)), dispose: vi.fn(),
  } satisfies WorkItemsProvider
}

describe('WorkItemsRuntime', () => {
  it('rejects a provider detail for a different item identity', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(WorkItemsRuntime)
      ctx.workItems.registerProvider(provider('github'))
      await expect(ctx.workItems.get({ id: WorkItemId('github:other') })).rejects.toMatchObject({ code: 'invalid-response' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('selects a source and rejects missing or ambiguous providers', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorkItemsRuntime)
    await expect(ctx.workItems.list({ source: 'github' })).rejects.toThrow(expect.objectContaining({ code: 'configured-missing' }))
    await expect(ctx.workItems.list()).rejects.toMatchObject({ code: 'unavailable' })
    const github = provider('github')
    const linear = provider('linear')
    ctx.workItems.registerProvider(github)
    await expect(ctx.workItems.list()).resolves.toMatchObject({ items: [{ source: 'github' }] })
    await expect(ctx.workItems.list({ scope: { source: 'github', owner: 'acme', repository: 'repo' } })).resolves.toMatchObject({ items: [{ source: 'github' }] })
    await expect(ctx.workItems.list({ source: 'github' })).resolves.toMatchObject({ items: [{ source: 'github' }] })
    ctx.workItems.registerProvider(linear)
    await expect(ctx.workItems.list({})).rejects.toThrow(expect.objectContaining({ code: 'ambiguous' }))
    await fiber.dispose()
  })

  it('rejects invalid configuration and branded ids', async () => {
    expect(() => new WorkItemsRuntime(new Context(), { provider: 'other' as never })).toThrow(/github or linear/)
    expect(() => new WorkItemsRuntime(new Context(), { extra: true } as never)).toThrow(/unsupported config key/)
    expect(() => WorkItemId('')).toThrow(/non-empty/)
    expect(() => WorkItemId(' github:one')).toThrow(/trimmed/)
    expect(() => WorkItemId('x'.repeat(501))).toThrow(/at most 500/)
    expect(WorkItemId('github:one')).toBe('github:one')
  })

  it('honors explicit provider configuration and disposes contributions', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorkItemsRuntime, { provider: 'linear' })
    const linear = provider('linear')
    const dispose = ctx.workItems.registerProvider(linear)
    await expect(ctx.workItems.list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-request' })
    await expect(ctx.workItems.get({ id: WorkItemId('linear:one') })).resolves.toMatchObject({ source: 'linear' })
    dispose()
    await expect(ctx.workItems.get({ id: WorkItemId('linear:one') })).rejects.toThrow(expect.objectContaining({ code: 'configured-missing' }))
    await fiber.dispose()
    expect(linear.dispose).toHaveBeenCalledOnce()

    const unavailableCtx = new Context()
    const unavailableFiber = await unavailableCtx.plugin(WorkItemsRuntime, { provider: 'linear' })
    unavailableCtx.workItems.registerProvider(provider('linear', false))
    await expect(unavailableCtx.workItems.list()).rejects.toMatchObject({ code: 'configured-unavailable' })
    await unavailableFiber.dispose()
  })

  it('rebuilds valid provider responses without provider-only fields', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorkItemsRuntime)
    const github = provider('github')
    github.get = vi.fn(async () => ({ ...completeItem('github'), secret: 'do not publish' } as never))
    github.list = vi.fn(async () => ({
      items: [{ ...completeItem('github'), secret: 'do not publish' } as never],
      nextCursor: 'next',
      truncated: true,
      secret: 'do not publish',
    } as never))
    ctx.workItems.registerProvider(github)
    const received = await ctx.workItems.get({ id: WorkItemId('github:one') })
    const page = await ctx.workItems.list({ source: 'github' })
    expect(received).toEqual(completeItem('github'))
    expect(page).toEqual({ items: [completeItem('github')], nextCursor: 'next', truncated: true })
    expect(JSON.stringify([received, page])).not.toContain('secret')
    await fiber.dispose()
  })

  it('rejects malformed provider pages and items', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorkItemsRuntime)
    const github = provider('github')
    ctx.workItems.registerProvider(github)
    const listWith = async (value: unknown): Promise<void> => {
      github.list = vi.fn(async () => value as never)
      await expect(ctx.workItems.list({ source: 'github' })).rejects.toMatchObject({ code: 'invalid-response' })
    }
    const getWith = async (value: unknown): Promise<void> => {
      github.get = vi.fn(async () => value as never)
      await expect(ctx.workItems.get({ id: WorkItemId('github:one') })).rejects.toMatchObject({ code: 'invalid-response' })
    }

    for (const page of [
      'page',
      null,
      [],
      { items: null, truncated: false },
      { items: Array.from({ length: 101 }, () => item('github')), truncated: false },
      { items: [], truncated: 'false' },
      { items: [], truncated: false, nextCursor: '' },
      { items: [], truncated: false, nextCursor: 'x'.repeat(501) },
    ]) await listWith(page)

    const base = item('github')
    for (const candidate of [
      'item',
      null,
      [],
      { ...base, id: 'github:' + 'x'.repeat(494) },
      { ...base, id: ' github:one' },
      { ...base, id: 'linear:one' },
      { ...base, source: 'linear' },
      { ...base, url: 'http://example.com/item' },
      { ...base, url: 'https://user@example.com/item' },
      { ...base, url: 'https://:secret@example.com/item' },
      { ...base, title: 1 },
      { ...base, title: '' },
      { ...base, title: 'x'.repeat(20_001) },
      { ...base, createdAt: 'not-a-time' },
      { ...base, labels: null },
      { ...base, labels: Array.from({ length: 101 }, () => 'label') },
      { ...base, labels: [null] },
    ]) await getWith(candidate)
    await fiber.dispose()
  })

  it('forwards cancellation and rejects invalid provider registrations', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(WorkItemsRuntime)
    expect(() => ctx.workItems.registerProvider({ ...provider('github'), id: 'other' as never })).toThrow(WorkItemsError)
    await expect(ctx.workItems.get({ id: WorkItemId('other:one') })).rejects.toMatchObject({ code: 'invalid-request' })
    const github = provider('github')
    const dispose = ctx.workItems.registerProvider(github)
    expect(() => ctx.workItems.registerProvider(provider('github'))).toThrow(/already registered/)

    const signal = new AbortController().signal
    await ctx.workItems.list({ source: 'github' }, signal)
    expect(github.list).toHaveBeenCalledWith({ source: 'github' }, signal)

    const preAborted = new AbortController()
    preAborted.abort('before')
    await expect(ctx.workItems.list({ source: 'github' }, preAborted.signal)).rejects.toMatchObject({ code: 'aborted' })

    const postAborted = new AbortController()
    github.list = vi.fn(async () => {
      postAborted.abort('after')
      return { items: [item('github')], truncated: false }
    })
    await expect(ctx.workItems.list({ source: 'github' }, postAborted.signal)).rejects.toMatchObject({ code: 'aborted' })

    dispose()
    ctx.workItems.registerProvider({
      id: 'github',
      available: () => true,
      list: async () => ({ items: [item('github')], truncated: false }),
      get: async () => item('github'),
    })
    await fiber.dispose()
  })
})
