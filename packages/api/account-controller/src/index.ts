/** Authenticated Remote operations for account UI consumers. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { isRunningAccountTask } from '@deepseek-ai/dsh-deepseek-account'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { recordKeyFor, runSub2ApiLoginWithAnswers, SUB2API_PROVIDER_ID } from '@deepseek-ai/dsh-llm-pi-ai'
import type {} from '@deepseek-ai/dsh-agent'
import type { AccountBonusBatch, AccountBonusOrderId, AccountClientMetadata, AccountDetails, AccountUserId } from '@deepseek-ai/dsh-deepseek-account/types'
import type { AccountView, SignInAttemptId, Sub2ApiAccountState, Sub2ApiSignInOutcome, Sub2ApiSignInRequest } from './types.ts'

/** Account commands and reconnect-safe state stream. */
export class AccountController extends TypertRemoteService {
  static inject = ['credentials']
  /** The one in-flight Sub2API sign-in attempt, absent while idle. */
  private sub2ApiAttempt: { controller: AbortController } | undefined
  /** @param ctx - Host with the account provider mounted. */
  constructor(ctx: Context) { super(ctx, 'accountController', { namespace: 'account' }) }
  /**
   * Read the safe account projection.
   * @returns current account and attempt state.
   */
  @Remote
  getState(): Promise<AccountView> {
    const account = this.ctx.get('deepseekAccount')
    return account ? account.getState() : Promise.resolve({ status: 'signed-out', links: { usageUrl: '', topUpUrl: '' }, attempt: null })
  }
  /**
   * Query display-safe Platform profile data.
   * @param client - identity of the requesting UI; the Host derives Platform request headers from it.
   * @returns profile outcome, or null when the account grant is absent or changed.
   */
  @Remote
  getProfile(client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    return this.ctx.get('deepseekAccount')?.getProfile(client) ?? Promise.resolve(null)
  }
  /**
   * Query Platform recharge-wallet balances.
   * @param client - identity of the requesting UI; the Host derives Platform request headers from it.
   * @returns balance outcome, or null when the account grant is absent or changed.
   */
  @Remote
  getBalance(client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    return this.ctx.get('deepseekAccount')?.getBalance(client) ?? Promise.resolve(null)
  }
  /**
   * Query the granted bonuses Platform has not yet recorded as displayed.
   * @param client - identity of the requesting UI; its language selects the server-authored message.
   * @returns bonuses with their account, or null when the account grant is absent or changed.
   */
  @Remote
  getUnnotifiedBonuses(client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    return this.ctx.get('deepseekAccount')?.getUnnotifiedBonuses(client) ?? Promise.resolve(null)
  }
  /**
   * Record one displayed bonus as notified for the account it belongs to.
   * @param accountId - account the notification was read for.
   * @param orderId - granted bonus order the user saw.
   * @param client - identity of the requesting UI; the Host derives Platform request headers from it.
   * @returns true once Platform records the acknowledgement; false when the account is absent or changed.
   */
  @Remote
  ackBonusNotified(accountId: AccountUserId, orderId: AccountBonusOrderId, client: AccountClientMetadata): Promise<boolean> {
    return this.ctx.get('deepseekAccount')?.ackBonusNotified(accountId, orderId, client) ?? Promise.resolve(false)
  }
  /**
   * Begin browser sign-in.
   * @param client - identity of the requesting UI, captured by a new attempt.
   * @param callbackOrigin - browser-accessible loopback HTTP origin.
   * @param loginSource - initiating UI, used to return from a failed exchange.
   * @returns a new or already-active login attempt.
   */
  @Remote
  startSignIn(client: AccountClientMetadata, callbackOrigin: string, loginSource: 'web' | 'desktop'): Promise<AccountView> {
    const account = this.ctx.get('deepseekAccount')
    if (!account) throw new Error('DeepSeek platform account is not configured')
    return account.startSignIn(client, callbackOrigin, loginSource)
  }
  /**
   * Cancel the named local attempt.
   * @param attemptId - attempt to cancel.
   * @returns settled cancellation or commit state.
   */
  @Remote
  cancelSignIn(attemptId: SignInAttemptId): Promise<AccountView> {
    const account = this.ctx.get('deepseekAccount')
    if (!account) throw new Error('DeepSeek platform account is not configured')
    return account.cancelSignIn(attemptId)
  }
  /**
   * Inspect the latest logged request providers of running tasks, including tools and retries.
   * @returns whether running work has a latest request context on the account route.
   */
  @Remote
  hasRunningAccountTasks(): boolean {
    return this.ctx.get('agents')?.list().some(isRunningAccountTask) ?? false
  }
  /**
   * Read the safe Sub2API account projection.
   * @returns whether the provider's API-key record is stored and whether a sign-in is running.
   */
  @Remote
  async getSub2ApiState(): Promise<Sub2ApiAccountState> {
    const record = await this.ctx.credentials.readRecord(recordKeyFor(SUB2API_PROVIDER_ID))
    return { signedIn: record !== undefined, inFlight: this.sub2ApiAttempt !== undefined }
  }

  /**
   * Sign in to the Cinlan account over the Sub2API service with explicit answers.
   * @param request - email, password, and the 2FA code when the caller already has one.
   * @returns `totp-required` when the account demands a verification code, `authorized` after the key is committed.
   */
  @Remote
  async sub2ApiSignIn(request: Sub2ApiSignInRequest): Promise<Sub2ApiSignInOutcome> {
    if (this.sub2ApiAttempt !== undefined) throw new Error('a Cinlan account sign-in attempt is already running')
    if (request.email.trim().length === 0 || request.password.length === 0) {
      throw new Error('Cinlan account email and password are required')
    }
    const controller = new AbortController()
    const attempt = { controller }
    this.sub2ApiAttempt = attempt
    try {
      await runSub2ApiLoginWithAnswers(this.ctx, request, controller.signal)
      return { status: 'authorized' }
    } catch (error) {
      if (error instanceof LlmError && error.code === 'SUB2API_TOTP_REQUIRED') return { status: 'totp-required' }
      if (error instanceof LlmError && error.code === 'SUB2API_CLEANUP_FAILED') {
        const record = await this.ctx.credentials.readRecord(recordKeyFor(SUB2API_PROVIDER_ID))
        if (record !== undefined) {
          return { status: 'authorized' }
        }
      }
      throw error
    } finally {
      if (this.sub2ApiAttempt === attempt) this.sub2ApiAttempt = undefined
    }
  }

  /**
   * Withdraw the running Sub2API sign-in attempt, if any.
   */
  @Remote
  cancelSub2ApiSignIn(): void { this.sub2ApiAttempt?.controller.abort() }

  /**
   * Remove the locally stored Sub2API API-key record. Remote revocation stays an operator action.
   * @returns the state after the removal.
   */
  @Remote
  async sub2ApiSignOut(): Promise<Sub2ApiAccountState> {
    await this.ctx.credentials.deleteRecord(recordKeyFor(SUB2API_PROVIDER_ID))
    return this.getSub2ApiState()
  }

  /**
   * Remove the local account grant and revoke it through Platform in the background, without deleting API keys.
   * @param client - identity of the requesting UI, captured for the background revocation retries.
   * @returns state after removing the local account grant.
   */
  @Remote
  signOut(client: AccountClientMetadata): Promise<AccountView> {
    return this.ctx.get('deepseekAccount')?.signOut(client)
      ?? Promise.resolve({ status: 'signed-out', links: { usageUrl: '', topUpUrl: '' }, attempt: null })
  }
  /**
   * Subscribe to credential expiry without replaying prior notifications.
   * @param signal - stream lifetime.
   * @returns notifications emitted while subscribed.
   */
  @Remote({ mode: 'stream' })
  async *watchExpiry(signal: AbortSignal): AsyncIterable<'session-expired'> {
    let pending = 0
    let wake: (() => void) | undefined
    const stop = this.ctx.on('deepseek-account/session-expired', () => { pending++; wake?.() })
    const abort = (): void => { wake?.() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (pending > 0) { pending--; yield 'session-expired'; continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      stop()
      signal.removeEventListener('abort', abort)
    }
  }
  /**
   * Stream the safe account projection.
   * @param signal - stream lifetime.
   * @returns initial snapshot and subsequent changes.
   */
  @Remote({ mode: 'stream' })
  watch(signal: AbortSignal): AsyncIterable<AccountView> {
    const account = this.ctx.get('deepseekAccount')
    if (account) return account.watch(signal)
    return (async function* () {
      yield { status: 'signed-out', links: { usageUrl: '', topUpUrl: '' }, attempt: null }
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })()
  }
}
export default AccountController
