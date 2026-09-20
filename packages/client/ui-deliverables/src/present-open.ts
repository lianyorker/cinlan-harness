/** Authenticated native actions resolve current source files from recorded delivery coordinates. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { FsError } from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import { isPresentedData, isPresentedFile, PRESENT_OPEN_PATH, PRESENT_HOST_PATH, type PresentedHost } from './presented.ts'

/**
 * Register declared-file actions inside Connection's authentication fence.
 * @param ctx - Session lookup, filesystem, native opener, and route lifetime.
 */
export function registerPresentOpen(ctx: Context): void {
  ctx.connection.fetch.register({
    path: PRESENT_HOST_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: () => Promise.resolve(Response.json(ctx.sessionController.workspaceDesktop() satisfies PresentedHost,
      { headers: { 'cache-control': 'no-store' } })),
  })
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
  })
  const routes = [
    [PRESENT_OPEN_PATH, 'POST', handlePresentOpen],
  ] as const
  for (const [path, method, handler] of routes) {
    ctx.connection.fetch.register({
      path,
      methods: [method],
      requestBody: 'buffered',
      fetch: (request) => {
        const task = handler(ctx, new Request(request, {
          signal: AbortSignal.any([request.signal, lifetime.signal]),
        }))
        pending.add(task)
        void task.then(() => { pending.delete(task) }, () => { pending.delete(task) })
        return task
      },
    })
  }
}

const NUMERIC = /^\d+$/

function coordinate(value: string | null): number | undefined {
  return value !== null && NUMERIC.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined
}

/** Translate lookup and filesystem failures into the not-found or failure status the browser retries from. */
function failureStatus(error: unknown): number {
  const remote = remoteErrorOf(error)
  const missing = remote?.code === 'session/not-found'
    || error instanceof FsError && (error.code === 'FS_NOT_FOUND' || error.code === 'FS_NOT_REGULAR_FILE' || error.code === 'FS_PERMISSION_DENIED' || error.code === 'FS_SANDBOX_DENIED')
    || error instanceof Error && 'code' in error
    && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_EVENT_NOT_FOUND'
      || error.code === 'ENOENT' || error.code === 'ENOTDIR')
  return missing ? 404 : 500
}

/**
 * Read the addressed event once the Host desktop is known to be available.
 * @returns the event with its Session header, or the refusal to answer with.
 */
async function readTarget(ctx: Context, request: Request, id: string, seq: number): Promise<Awaited<ReturnType<Context['sessionQuery']['readEvent']>> | Response> {
  request.signal.throwIfAborted()
  if (!ctx.sessionController.workspaceDesktop().available) return new Response('Host desktop unavailable.', { status: 409 })
  return ctx.sessionQuery.readEvent({ sessionId: id as SessionId, seq: seq as SessionSeq, before: 0, after: 0 }, request.signal)
}

/**
 * Open one verified Host path. A file is verified through the Session
 * filesystem; a directory is verified by the Host filesystem mapping alone.
 * @returns the HTTP status to answer with.
 */
async function openVerified(ctx: Context, request: Request, lease: ExecutionLease, path: string, action: 'open' | 'reveal'): Promise<Response> {
  const fs = lease.ctx.get('fs')
  if (fs === undefined) return new Response('Execution filesystem unavailable.', { status: 503 })
  const signal = AbortSignal.any([request.signal, lease.signal])
  const mapped = fs.processPathFromHostPath(path)
  if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal })) !== path) {
    return new Response('Path has no verified Host path.', { status: 422 })
  }
  request.signal.throwIfAborted()
  await ctx.sessionController.openExecutionPath(lease, path, action, request.signal)
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
}

async function handlePresentOpen(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const action = query.get('action') ?? 'open'
  if (action !== 'open' && action !== 'reveal') return new Response('Invalid file action.', { status: 400 })
  const id = query.get('sessionId')
  const seq = coordinate(query.get('seq'))
  const index = coordinate(query.get('index'))
  if (!id || seq === undefined || index === undefined) return new Response('Invalid Presented file coordinates.', { status: 400 })
  try {
    const read = await readTarget(ctx, request, id, seq)
    if (read instanceof Response) return read
    const { target: event } = read
    const file = event.type === 'deliverables/presented' && isPresentedData(event.data) ? event.data.files[index] : undefined
    if (!isPresentedFile(file)) return new Response('Presented file not found in this Session result.', { status: 404 })
    request.signal.throwIfAborted()
    const lease = await ctx.executionBindings.forSession(id as SessionId, request.signal)
    try {
      lease.assertCurrent()
      if (lease.binding.kind !== 'local') return new Response('Native opening is unavailable for remote files.', { status: 501 })
      const fs = lease.ctx.get('fs')
      if (fs === undefined) return new Response('Execution filesystem unavailable.', { status: 503 })
      const signal = AbortSignal.any([request.signal, lease.signal])
      const entry = await fs.lstat(file.path, { cwd: lease.cwd }, signal)
      if (entry === undefined || entry.type !== 'file') return new Response('Presented file unavailable.', { status: 404 })
      const target = await fs.resolve(file.path, { cwd: lease.cwd, signal })
      const info = await fs.stat(target, signal)
      if (info === undefined || info.type !== 'file') return new Response('Presented file unavailable.', { status: 404 })
      return await openVerified(ctx, request, lease, fs.processPath(target), action)
    } finally { await lease.release() }
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return new Response('Presented file unavailable.', { status: failureStatus(error) })
  }
}
