/** Read-only integration readiness Remote; never installs software or performs write operations. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { IntegrationPreflightRequest, IntegrationReason, IntegrationProvider, IntegrationPreflightSnapshot } from './types.ts'

export type * from './types.ts'

const execFileAsync = promisify(execFile)

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of read-only integration Provider readiness. */
    integrationPreflightController: IntegrationPreflightController
  }
}

/** Probe GitHub, GitLab, and Gitee integration readiness without exposing tokens or credentials. */
export class IntegrationPreflightController extends TypertRemoteService {
  static inject = ['typert']

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'integrationPreflightController', { namespace: 'integrationPreflight' })
  }

  /**
   * Check one integration provider's readiness independently from plugin activation.
   * @param request - Integration provider to check.
   * @param signal - Caller cancellation forwarded to the read-only probe.
   * @returns Readiness snapshot with redacted status and account hint.
   */
  @Remote('check')
  async check(request: IntegrationPreflightRequest, signal: AbortSignal): Promise<IntegrationPreflightSnapshot> {
    signal.throwIfAborted()
    const provider = request.provider
    try {
      if (provider === 'github') return await this.checkCli('gh', ['auth', 'status'], provider, signal)
      if (provider === 'gitlab') return await this.checkCli('glab', ['auth', 'status'], provider, signal)
      return await this.checkGitee(signal)
    } catch (error) {
      signal.throwIfAborted()
      return { provider, status: 'unavailable', reason: failureReason(error), account: null }
    }
  }

  private async checkCli(
    command: string,
    args: readonly string[],
    provider: IntegrationProvider,
    signal: AbortSignal,
  ): Promise<IntegrationPreflightSnapshot> {
    try {
      const { stdout } = await execFileAsync(command, [...args], {
        timeout: 10_000,
        signal,
        maxBuffer: 65536,
      })
      signal.throwIfAborted()
      const account = parseCliAccount(stdout)
      return { provider, status: 'connected', reason: 'connected', account }
    } catch (error) {
      signal.throwIfAborted()
      const code = error !== null && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
      if (code === 'ENOENT') return { provider, status: 'not-installed', reason: 'cli-not-found', account: null }
      if (code === 1) return { provider, status: 'not-authenticated', reason: 'cli-auth-failed', account: null }
      return { provider, status: 'unavailable', reason: 'probe-failed', account: null }
    }
  }

  private async checkGitee(signal: AbortSignal): Promise<IntegrationPreflightSnapshot> {
    const token = process.env.GITEE_TOKEN
    if (token === undefined || token === '') {
      return { provider: 'gitee', status: 'not-configured', reason: 'token-not-set', account: null }
    }

    const response = await fetch('https://gitee.com/api/v5/user', {
      headers: { Authorization: `token ${token}` },
      signal,
    })
    signal.throwIfAborted()

    if (response.status === 401 || response.status === 403) {
      return { provider: 'gitee', status: 'not-authenticated', reason: 'token-invalid', account: null }
    }
    if (!response.ok) {
      return { provider: 'gitee', status: 'unavailable', reason: 'probe-failed', account: null }
    }

    const user = await response.json() as { login?: string }
    signal.throwIfAborted()
    return { provider: 'gitee', status: 'connected', reason: 'connected', account: user.login ?? null }
  }
}

function failureReason(error: unknown): IntegrationReason {
  const code = error !== null && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
  if (typeof code === 'string') {
    if (code === 'ENOENT') return 'cli-not-found'
    if (code === '1') return 'cli-auth-failed'
  }
  return 'probe-failed'
}

function parseCliAccount(stdout: string): string | null {
  const match = stdout.match(/Logged in to .* as (\S+)/i)
  return match?.[1] ?? null
}

export default IntegrationPreflightController
