/** Authenticated human-facing usage queries; the Connection carrier owns browser authorization. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { UsageQueryError } from '@deepseek-ai/dsh-usage-query'
import type { UsageQueryRequest, UsageQueryResult } from './types.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the authenticated usage Remote namespace. */
    usageController: UsageController
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Invalid interval or route filter. */
    'usage/invalid-query': object
    /** Bounded query exceeded its deadline. */
    'usage/query-timeout': object
    /** Query failed without exposing log text, paths, or provider diagnostics. */
    'usage/query-failed': object
  }
}

/** Read-only usage consumer with no Session activation or preference mutation. */
export class UsageController extends TypertRemoteService {
  static inject = ['typert', 'usageQuery']

  /** @param ctx - owning Host fiber with the query service. */
  constructor(ctx: Context) {
    super(ctx, 'usageController', { namespace: 'usage' })
  }

  /**
   * Query known own-Turn accounting through the authenticated browser carrier.
   * @param request - interval and optional exact provider/model filters.
   * @param signal - transport cancellation propagated through all Host reads.
   * @returns the query service result unchanged, including unknown/partial accounting.
   * @throws a sanitized RemoteError on query failure, or the caller signal reason on cancellation.
   */
  @Remote
  async query(request: UsageQueryRequest, signal: AbortSignal): Promise<UsageQueryResult> {
    signal.throwIfAborted()
    try {
      return await this.ctx.usageQuery.query(request, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof UsageQueryError && error.code === 'invalid-query') {
        throw new RemoteError('usage/invalid-query', 'Choose a valid usage interval and route filter', {})
      }
      if (error instanceof UsageQueryError && error.code === 'timeout') {
        throw new RemoteError('usage/query-timeout', 'Usage query timed out; choose a shorter interval', {})
      }
      throw new RemoteError('usage/query-failed', 'Usage query failed; refresh and try again', {})
    }
  }
}

export default UsageController
