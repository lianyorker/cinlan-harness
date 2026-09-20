/** A comparison's reads validate wire data and settle before plugin disposal. */
import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ChangesReader } from '../src/client/review-read.ts'
import { ChangesSummaryStore } from '../src/client/changes-summary.ts'
const readers: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => { await Promise.all(readers.splice(0).map(reader => reader.dispose())); vi.unstubAllGlobals() })

it('distinguishes expired comparisons, transport errors, and malformed responses', async () => {
  const reader = new ChangesReader()
  readers.push(reader)
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(Response.json({ kind: 'text', path: 'a.ts' }))
  vi.stubGlobal('fetch', fetch)
  for (const expected of ['missing', 'error', 'error']) {
    expect(await reader.diff(SessionId('owner'), 9, 0, new AbortController().signal)).toBe(expected)
  }
})

it('deduplicates summary reads and prevents a disposed or replaced generation from publishing', async () => {
  const store = new ChangesSummaryStore()
  readers.push(store)
  const reads: Array<{ signal: AbortSignal; finish(response: Response): void }> = []
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((finish) => {
    reads.push({ signal: init.signal as AbortSignal, finish })
  })))
  const first = store.load(SessionId('owner'), 9)
  await store.load(SessionId('owner'), 9)
  expect(reads).toHaveLength(1)
  store.reset()
  expect(reads[0]?.signal.aborted).toBe(true)
  reads[0]!.finish(Response.json({ turn: 1, total: 0, added: 0, deleted: 0, files: [] }))
  await first
  expect(store.state.getSnapshot()).toEqual({})
  const second = store.load(SessionId('owner'), 9)
  const disposed = store.dispose()
  expect(reads[1]?.signal.aborted).toBe(true)
  reads[1]!.finish(new Response(null, { status: 404 }))
  await Promise.all([second, disposed])
  expect(Object.values(store.state.getSnapshot())).toEqual(['loading'])
})
