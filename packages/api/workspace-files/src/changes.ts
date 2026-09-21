/**
 * Producer of the `changes` stream: every `fs/observed` emission whose target
 * lies inside a generation's workspace root becomes one frame of that
 * generation. Observations are emitted by tools after their own filesystem
 * operation, so the feed covers Agent writes only; the OS is not watched.
 * Each generation acknowledges its observation queue and resolved workspace
 * root with `ready` before emitting any queued or live changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { Deque } from '@deepseek-ai/dsh-deque'
import type { FileSystem, FsObservation, FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceFileWatchFrame } from './types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One `fs/observed` emission as received, before any generation filters it. */
type Observed = readonly [target: FsTarget, observation: FsObservation]

/** Owns `fs/observed` observation and every open `changes` generation. */
export class WorkspaceChangeFeed {
  private readonly followers = new Map<ChangeFollower, SessionId>()

  /** @param ctx - Host context carrying the filesystem the observations come from. */
  constructor(ctx: Context) {
    ctx.on('fs/observed', (target, observation, actor) => {
      const source: { readonly agent?: { readonly session: { readonly id: SessionId } } } | undefined = actor
      const owner = source?.agent?.session.id
      for (const [follower, sessionId] of this.followers) {
        if (owner === sessionId) follower.push([target, observation])
      }
    })
    ctx.effect(() => () => {
      for (const follower of this.followers.keys()) follower.close()
      this.followers.clear()
    }, 'workspace-files.changes')
  }

  /**
   * Open one generation reporting observations inside `workspaceRoot`.
   * @param fs - filesystem retained by the generation’s execution lease.
   * @param workspaceRoot - the session's workspace root path.
   * @param sessionId - Session whose tool observations this generation follows.
   * @param signal - generation cancellation.
   * @returns `ready` after observation is active and the root resolves, then
   *   observations made after the generation was first pulled, in emission order.
   */
  async *follow(fs: FileSystem, workspaceRoot: string, sessionId: SessionId, signal: AbortSignal): AsyncIterable<WorkspaceFileWatchFrame> {
    signal.throwIfAborted()
    // Registered before the root resolves, so nothing observed while it does is
    // missed; the root only filters at drain time.
    const follower = new ChangeFollower()
    this.followers.set(follower, sessionId)
    try {
      // Under the generation's signal, so a consumer leaving mid-resolve on a slow
      // backend releases the follower now rather than when the resolve settles;
      // a rejection the abort caused is the quiet end every other abort takes here.
      const root = await fs.resolve(workspaceRoot, { signal }).catch((error: unknown) => {
        if (signal.aborted) return undefined
        throw error
      })
      if (root === undefined || signal.aborted || follower.isClosed) return
      yield { kind: 'ready' }
      for await (const [target, observation] of follower.read(signal)) {
        if (!fs.contains(root, target)) continue
        const absolutePath = fs.processPath(target)
        yield {
          kind: 'change',
          change: observation.kind === 'present'
            ? { absolutePath, version: observation.version }
            : { absolutePath, absent: true },
        }
      }
    } finally {
      this.followers.delete(follower)
      follower.close()
    }
  }
}

/** One generation's queue: observations wait here until its consumer pulls them. */
class ChangeFollower {
  private readonly queue = new Deque<Observed>()
  private wake: (() => void) | undefined
  private closed = false

  /** Whether the generation was closed while its workspace root resolved. */
  get isClosed(): boolean {
    return this.closed
  }

  push(observed: Observed): void {
    this.queue.pushBack(observed)
    this.wake?.()
  }

  close(): void {
    this.closed = true
    this.wake?.()
  }

  /** Drain until closed or aborted; anything still queued then is dropped with the generation. */
  async *read(signal: AbortSignal): AsyncIterable<Observed> {
    const abort = (): void => { this.close() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try {
      while (!this.closed) {
        const observed = this.queue.popFront()
        if (observed !== undefined) {
          yield observed
          continue
        }
        await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', abort)
    }
  }
}
