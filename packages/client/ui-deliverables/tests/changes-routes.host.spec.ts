/** Summary and comparison routes remain coordinate-only and honor request and plugin lifetimes. */
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceChangesSummary, WorkspaceFileDiff } from '@deepseek-ai/dsh-workspace-changes/types'
import { registerChangesRoutes } from '../src/changes-routes.ts'
import { CHANGED_FILES_PATH, CHANGES_DIFF_PATH } from '../src/changes.ts'

const disposers: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() })

async function fixture() {
  const ctx = new Context()
  disposers.push(() => ctx.fiber.dispose())
  const record: WorkspaceChangesSummary = { turn: 1, cwd: '/private/work', total: 1, added: 1, deleted: 1,
    snapshot: { before: 'private-before', after: 'private-after' },
    files: [{ path: 'a.ts', display: 'a.ts', added: 1, deleted: 1 }] }
  const comparison: WorkspaceFileDiff = { kind: 'text', path: 'a.ts', display: 'a.ts', before: true, after: true,
    coarse: false, hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-old', '+new'] }] }
  const diff = vi.fn(
    async (_id: string, _seq: number, _index: number, _signal: AbortSignal): Promise<WorkspaceFileDiff | undefined> => comparison,
  )
  ctx.provide('workspaceChanges', { summary: (id, seq) => id === 'owner' && seq === 9 ? record : undefined, diff })
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  const fiber = ctx.plugin({ inject: ['connection', 'workspaceChanges'], apply: registerChangesRoutes })
  await fiber.await()
  const handler = connection.createSharedFetchHandler('/api')
  const request = (path: string, query = '?sessionId=owner&seq=9&index=0', signal?: AbortSignal) =>
    handler.fetch(new Request('http://localhost' + path + query, signal === undefined ? {} : { signal }))
  return { request, diff, comparison, fiber, record }
}

describe('change routes', () => {
  it('serves summaries without cwd or snapshot ids and refuses invalid coordinates', async () => {
    const { request, record } = await fixture()
    const response = await request(CHANGED_FILES_PATH)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const { cwd: _cwd, snapshot: _snapshot, ...publicRecord } = record
    expect(await response.json()).toEqual(publicRecord)
    expect((await request(CHANGED_FILES_PATH, '?sessionId=other&seq=9')).status).toBe(404)
    for (const query of ['', '?sessionId=owner&seq=1.2', '?sessionId=owner&seq=-1', '?sessionId=owner&seq=9007199254740992']) {
      expect((await request(CHANGED_FILES_PATH, query)).status).toBe(400)
    }
  })

  it('serves exactly the indexed comparison and distinguishes missing from retryable reads', async () => {
    const { request, comparison, diff } = await fixture()
    expect(await (await request(CHANGES_DIFF_PATH)).json()).toEqual(comparison)
    expect(diff.mock.calls[0]?.slice(0, 3)).toEqual(['owner', 9, 0])
    diff.mockResolvedValueOnce(undefined)
    expect((await request(CHANGES_DIFF_PATH)).status).toBe(404)
    diff.mockRejectedValueOnce(new Error('unreadable snapshot'))
    expect((await request(CHANGES_DIFF_PATH)).status).toBe(500)
    expect((await request(CHANGES_DIFF_PATH, '?sessionId=owner&seq=9&index=../a')).status).toBe(400)
  })

  it('aborts outstanding reads and waits for them before disposal completes', async () => {
    const { request, diff, fiber } = await fixture()
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    let aborted = false
    diff.mockImplementationOnce(async (_id, _seq, _index, signal) => {
      entered()
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }) })
      signal.throwIfAborted()
      return undefined
    })
    const reading = request(CHANGES_DIFF_PATH)
    const rejected = expect(reading).rejects.toBeDefined()
    await started
    await fiber.dispose()
    await rejected
    expect(aborted).toBe(true)
    expect((await request(CHANGED_FILES_PATH)).status).toBe(404)
  })
})
