/** Read-only integration readiness Remote; never installs software or performs write operations. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { IntegrationPreflightRequest, IntegrationReason, IntegrationProvider, IntegrationPreflightSnapshot } from './types.ts'
import type { IntegrationBudgetReason, IntegrationBudgetRequest, IntegrationBudgetSnapshot } from './budget.ts'

export type * from './types.ts'
export type * from './budget.ts'

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
      const account = parseCliAccount(withoutTerminalFormatting(stdout))
      return { provider, status: 'connected', reason: 'connected', account }
    } catch (error) {
      signal.throwIfAborted()
      const code = error !== null && typeof error === 'object' && 'code' in error ? (error as { code: unknown }).code : undefined
      if (code === 'ENOENT') return { provider, status: 'not-installed', reason: 'cli-not-found', account: null }
      if (code === 1) return { provider, status: 'not-authenticated', reason: 'cli-auth-failed', account: null }
      return { provider, status: 'unavailable', reason: 'probe-failed', account: null }
    }
  }

  /**
   * Probe one provider's REST request budget. Counts describe the provider's
   * own request quota, never LLM token usage, and no credential material is read.
   * @param request - Integration provider to probe.
   * @param signal - Caller cancellation forwarded to the read-only probe.
   * @returns Budget snapshot; quota counts stay null unless the provider reported them.
   */
  @Remote('budget')
  async budget(request: IntegrationBudgetRequest, signal: AbortSignal): Promise<IntegrationBudgetSnapshot> {
    signal.throwIfAborted()
    const provider = request.provider
    if (provider === 'github') {
      return await this.budgetFromCli('gh', ['api', 'rate_limit', '--jq', '.resources.core'], provider, parseGitHubBudget, signal)
    }
    if (provider === 'gitlab') {
      return await this.budgetFromCli('glab', ['api', '--include', 'user'], provider, parseGitLabBudget, signal)
    }
    // Gitee exposes no readable request quota to a personal access token.
    return { provider, state: 'unsupported', reason: 'budget-unsupported', remaining: null, limit: null, resetsAt: null }
  }

  private async budgetFromCli(
    command: string,
    args: readonly string[],
    provider: IntegrationProvider,
    parse: (stdout: string) => BudgetCounts | undefined,
    signal: AbortSignal,
  ): Promise<IntegrationBudgetSnapshot> {
    try {
      const { stdout } = await execFileAsync(command, [...args], { timeout: 10_000, signal, maxBuffer: 65536 })
      signal.throwIfAborted()
      const counts = parse(withoutTerminalFormatting(stdout))
      if (counts === undefined) {
        return { provider, state: 'not-reported', reason: 'no-rate-limit-data', remaining: null, limit: null, resetsAt: null }
      }
      return { provider, state: 'reported', reason: null, ...counts }
    } catch (error) {
      signal.throwIfAborted()
      return { provider, state: 'unavailable', reason: budgetFailure(error), remaining: null, limit: null, resetsAt: null }
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

/**
 * Remove the CSI and OSC sequences a CLI emits when its own colour detection
 * says to decorate stdout, so a JSON or line parse reads the intended bytes.
 * @param text - Raw stdout of a CLI probe.
 * @returns the text with terminal formatting sequences removed.
 */
export function withoutTerminalFormatting(text: string): string {
  return text
    .replace(/(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu, '')
    .replace(/(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\u001B[@-_]/gu, '')
}

export function parseCliAccount(stdout: string): string | null {
  // `gh` reports "Logged in to <host> as <user>" on older releases and
  // "Logged in to <host> account <user>" on current ones; accept either.
  const match = stdout.match(/Logged in to \S+ (?:as|account) (\S+)/i)
  return match?.[1] ?? null
}

/** Counts one provider reported for its current request window. */
export interface BudgetCounts {
  readonly remaining: number
  readonly limit: number
  readonly resetsAt: string | null
}

function budgetFailure(error: unknown): IntegrationBudgetReason {
  const reason = failureReason(error)
  return reason === 'cli-not-found' || reason === 'cli-auth-failed' ? reason : 'probe-failed'
}

/** Read the core request bucket of `gh api rate_limit`, filtered or whole. */
export function parseGitHubBudget(stdout: string): BudgetCounts | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout) as unknown
  } catch {
    return undefined
  }
  // `--jq .resources.core` prints the core bucket alone; a CLI that ignores the
  // filter prints the whole payload. Accept the core bucket in either position.
  const payload = parsed as { resources?: { core?: unknown } }
  const counts = (payload.resources?.core ?? parsed) as { remaining?: unknown; limit?: unknown; reset?: unknown }
  const remaining = asCount(counts.remaining)
  const limit = asCount(counts.limit)
  if (remaining === undefined || limit === undefined) return undefined
  return { remaining, limit, resetsAt: asInstant(counts.reset) }
}

/** Read one `ratelimit-*` response header `glab api --include` echoed to stdout. */
function parseGitLabBudget(stdout: string): BudgetCounts | undefined {
  const remaining = headerCount(stdout, 'ratelimit-remaining')
  const limit = headerCount(stdout, 'ratelimit-limit')
  if (remaining === undefined || limit === undefined) return undefined
  return { remaining, limit, resetsAt: asInstant(headerCount(stdout, 'ratelimit-reset')) }
}

function headerCount(stdout: string, name: string): number | undefined {
  const match = stdout.match(new RegExp(`^${name}:\\s*(\\d+)\\s*$`, 'im'))
  return match === null ? undefined : Number(match[1])
}

function asCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/** Seconds since the epoch into an RFC 3339 instant. */
function asInstant(value: unknown): string | null {
  const seconds = asCount(value)
  return seconds === undefined ? null : new Date(seconds * 1000).toISOString()
}

export default IntegrationPreflightController
