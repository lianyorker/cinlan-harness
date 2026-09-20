/** Authenticated summary and comparison reads through the existing Connection Fetch carrier. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-workspace-changes'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CHANGED_FILES_PATH, CHANGES_DIFF_PATH, type ChangesSummary } from './changes.ts'

function coordinate(value: string | null): number | undefined {
  return value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
}

/**
 * Serve only coordinates announced by the recorder; requests never choose a Host path.
 * @param ctx - Connection and workspace-change services, with the plugin lifetime.
 */
export function registerChangesRoutes(ctx: Context): void {
  ctx.connection.fetch.register({
    path: CHANGED_FILES_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: (request) => {
      const query = new URL(request.url).searchParams
      const id = query.get('sessionId')
      const seq = coordinate(query.get('seq'))
      if (!id || seq === undefined) return Promise.resolve(new Response('Invalid change summary coordinates.', { status: 400 }))
      const summary = ctx.workspaceChanges.summary(id as SessionId, seq)
      if (summary === undefined) return Promise.resolve(new Response('Change summary unavailable.', { status: 404 }))
      const { turn, files, total, added, deleted } = summary
      return Promise.resolve(Response.json({ turn, files, total, added, deleted } satisfies ChangesSummary,
        { headers: { 'cache-control': 'no-store' } }))
    },
  })
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
  })
  ctx.connection.fetch.register({
    path: CHANGES_DIFF_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: (request) => {
      const task = readDiff(ctx, new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) }))
      pending.add(task)
      void task.then(() => { pending.delete(task) }, () => { pending.delete(task) })
      return task
    },
  })
}

async function readDiff(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (!id || seq === undefined || index === undefined) return new Response('Invalid changed file coordinates.', { status: 400 })
  try {
    request.signal.throwIfAborted()
    const diff = await ctx.workspaceChanges.diff(id as SessionId, seq, index, request.signal)
    if (diff === undefined) return new Response('Change comparison unavailable.', { status: 404 })
    return Response.json(diff, { headers: { 'cache-control': 'no-store' } })
  } catch {
    // Snapshot read failures are retryable; cancellation remains a rejected request.
    request.signal.throwIfAborted()
    return new Response('Change comparison unavailable.', { status: 500 })
  }
}
