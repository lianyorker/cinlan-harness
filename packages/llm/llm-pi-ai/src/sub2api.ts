/** Fixed Cinlan account authorization over the Sub2API-compatible service. */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { recordKeyFor } from './auth.ts'

/** Internal provider id for the fixed Cinlan account credential. */
export const SUB2API_PROVIDER_ID = 'sub2api'
/** Internal authorization method id for the single Cinlan account sign-in. */
export const SUB2API_LOGIN_METHOD = 'password'
/** Public Cinlan API origin used by the account flow. */
export const SUB2API_ORIGIN = 'https://api.cinlan.online'
/** Sub2API-compatible API root used by the Host flow. */
export const SUB2API_BASE_URL = SUB2API_ORIGIN + '/api/v1'

const SUB2API_KEY_NAME = 'Cinlan Harness'
/** Default bound for one compensating key reconciliation, deletion, or logout request. */
export const DEFAULT_SUB2API_CLEANUP_TIMEOUT_MS = 10_000

type JsonObject = Record<string, unknown>

interface LoginResult {
  access_token?: string
  refresh_token?: string
  requires_2fa?: boolean
  temp_token?: string
}

interface CreatedApiKey {
  id?: number
  key?: string
}

interface RemoteApiKey {
  id?: number
  key?: string
  name?: string
  status?: string
}

interface LoginTokens {
  access_token: string
  refresh_token?: string
}

interface Sub2ApiRequestOptions {
  baseURL: string
  signal?: AbortSignal
  authorization?: string
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

async function requestJson<T>(
  path: string,
  options: Sub2ApiRequestOptions,
  operation: string,
  init: RequestInit,
): Promise<T> {
  const requestInit: RequestInit = {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...options.authorization === undefined ? {} : { authorization: options.authorization },
      ...init.headers,
    },
  }
  if (options.signal !== undefined) requestInit.signal = options.signal
  let response: Response
  try {
    response = await fetch(options.baseURL + path, requestInit)
  } catch (error) {
    if (options.signal?.aborted === true) throw error
    throw new LlmError('Cinlan API ' + operation + ' request failed', 'SUB2API_NETWORK', { cause: error })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    if (options.signal?.aborted === true) throw error
    throw new LlmError(
      'Cinlan API ' + operation + ' returned invalid JSON',
      'SUB2API_INVALID_RESPONSE',
      { status: response.status, cause: error },
    )
  }
  if (!response.ok) {
    throw new LlmError(
      'Cinlan API ' + operation + ' failed with HTTP ' + String(response.status),
      'SUB2API_HTTP',
      { status: response.status },
    )
  }
  if (!isObject(body) || body.code !== 0) {
    throw new LlmError(
      'Cinlan API rejected the ' + operation + ' request',
      'SUB2API_REJECTED',
      { status: response.status },
    )
  }
  return body.data as T
}

function requiredString(value: unknown, message: string): string {
  const result = stringField(value)
  if (result === undefined) throw new LlmError(message, 'SUB2API_INVALID_RESPONSE')
  return result
}

function requiredId(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new LlmError(message, 'SUB2API_INVALID_RESPONSE')
  }
  return value
}

function cleanupFailure(cause: unknown): LlmError {
  return new LlmError(
    'Cinlan API key cleanup failed; the remote key may remain active',
    'SUB2API_CLEANUP_FAILED',
    { cause },
  )
}

async function ask(
  session: AuthorizationSession,
  kind: 'text' | 'secret',
  message: string,
  autocomplete?: unknown,
  placeholder?: string,
): Promise<string> {
  return session.prompt({
    kind,
    message,
    ...autocomplete === undefined ? {} : { autocomplete } as never,
    ...placeholder === undefined ? {} : { placeholder },
    signal: session.signal,
  })
}

async function revokeRefreshToken(
  baseURL: string,
  refreshToken: string,
  logger: Context['logger'],
  cleanupTimeoutMs: number,
): Promise<void> {
  try {
    await requestJson<unknown>(
      '/auth/logout',
      { baseURL, signal: AbortSignal.timeout(cleanupTimeoutMs) },
      'logout',
      { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
    )
  } catch (error) {
    logger.error('llm-pi-ai: Cinlan API account logout did not complete', error)
    throw cleanupFailure(error)
  }
}

async function listApiKeys(
  baseURL: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<RemoteApiKey[]> {
  const page = await requestJson<unknown>(
    '/keys?page=1&page_size=1000',
    { baseURL, signal, authorization: 'Bearer ' + accessToken },
    'API-key listing',
    { method: 'GET' },
  )
  if (!isObject(page) || !Array.isArray(page.items) || page.items.some(item => !isObject(item))) {
    throw new LlmError('Cinlan API key listing returned malformed data', 'SUB2API_INVALID_RESPONSE')
  }
  return page.items as RemoteApiKey[]
}

function reusableKey(keys: readonly RemoteApiKey[], storedKey: string | undefined): RemoteApiKey | undefined {
  if (storedKey !== undefined) {
    const exact = keys.find(candidate => candidate.key === storedKey && candidate.status === 'active')
    if (exact !== undefined) return exact
  }
  return keys.find(candidate => candidate.name === SUB2API_KEY_NAME && candidate.status === 'active')
}

async function deleteCreatedApiKey(
  baseURL: string,
  accessToken: string,
  id: number,
  logger: Context['logger'],
  cleanupSignal: AbortSignal,
): Promise<boolean> {
  try {
    await requestJson<unknown>(
      '/keys/' + String(id),
      { baseURL, signal: cleanupSignal, authorization: 'Bearer ' + accessToken },
      'API-key cleanup',
      { method: 'DELETE' },
    )
    return true
  } catch (error) {
    logger.error('llm-pi-ai: Cinlan API key cleanup failed; the remote key may remain active', error)
    return false
  }
}

async function cleanupCreatedApiKeys(
  baseURL: string,
  accessToken: string,
  created: CreatedApiKey | undefined,
  logger: Context['logger'],
  cleanupTimeoutMs: number,
): Promise<boolean> {
  const ids = new Set<number>()
  const createdId = safeId(created?.id)
  const createdKey = stringField(created?.key)
  if (createdId !== undefined) ids.add(createdId)
  else if (createdKey !== undefined) {
    let after: readonly RemoteApiKey[]
    try {
      after = await listApiKeys(baseURL, accessToken, AbortSignal.timeout(cleanupTimeoutMs))
    } catch (error) {
      logger.error('llm-pi-ai: Cinlan API key cleanup could not inspect the identified key', error)
      return false
    }
    for (const candidate of after) {
      const id = safeId(candidate.id)
      if (id !== undefined && candidate.key === createdKey) ids.add(id)
    }
  }
  if (ids.size === 0) {
    logger.error('llm-pi-ai: Cinlan API key cleanup has no remote key id')
    return false
  }
  for (const id of ids) {
    if (!await deleteCreatedApiKey(
      baseURL, accessToken, id, logger, AbortSignal.timeout(cleanupTimeoutMs))) return false
  }
  return true
}

function safeId(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

/**
 * Run the fixed Cinlan account flow and commit its generated model API key.
 *
 * The account page owns the single Cinlan sign-in action. The Host always uses
 * `https://api.cinlan.online/api/v1`; the deployment URL and model route are
 * not user-facing account fields. The current public service exposes
 * email/password login rather than a device-login or QR exchange, so the flow
 * does not invent a device-login protocol.
 * @param ctx - Host context containing the writable credential provider.
 * @param session - Authorization attempt and human interaction callbacks.
 * @param cleanupTimeoutMs - Maximum duration for each compensating key reconciliation, deletion, or logout request.
 * @returns Fulfillment after the llm-pi-ai/sub2api API-key record is committed.
 * @throws {LlmError} on failed HTTP calls, malformed responses, or missing credentials service.
 */
export async function runSub2ApiLogin(
  ctx: Context,
  session: AuthorizationSession,
  cleanupTimeoutMs = DEFAULT_SUB2API_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  const baseURL = SUB2API_BASE_URL
  const email = (await ask(session, 'text', 'Cinlan account email', 'username')).trim()
  const password = await ask(session, 'secret', 'Cinlan account password', 'current-password')
  if (email.length === 0 || password.length === 0) {
    throw new LlmError('Cinlan account email and password are required', 'SUB2API_INVALID_INPUT')
  }

  const loginData = await requestJson<LoginResult>(
    '/auth/login',
    { baseURL, signal: session.signal },
    'login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
  )

  let tokens: LoginTokens | undefined
  let refreshToken: string | undefined
  try {
    if (loginData?.requires_2fa === true) {
      const tempToken = requiredString(loginData.temp_token, 'Cinlan API login did not return a 2FA session')
      const totpCode = (await ask(session, 'secret', 'Cinlan account verification code', 'one-time-code')).trim()
      tokens = await requestJson<LoginTokens>(
        '/auth/login/2fa',
        { baseURL, signal: session.signal },
        '2FA login',
        { method: 'POST', body: JSON.stringify({ temp_token: tempToken, totp_code: totpCode }) },
      )
    } else {
      tokens = loginData as LoginTokens
    }

    const tokenObject = isObject(tokens) ? tokens : undefined
    if (tokenObject?.refresh_token !== undefined) {
      refreshToken = requiredString(tokenObject.refresh_token, 'Cinlan API login returned an invalid refresh token')
    }
    const accessToken = requiredString(tokenObject?.access_token, 'Cinlan API login returned no access token')
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      throw new LlmError('Cinlan account login requires a writable credentials service', 'NO_CREDENTIAL_STORE')
    }
    const recordKey = recordKeyFor(SUB2API_PROVIDER_ID)
    const current = await credentials.readRecord(recordKey)
    const currentKey = current?.kind === 'api-key' ? current.key : undefined
    session.signal.throwIfAborted()
    const existingKeys = await listApiKeys(baseURL, accessToken, session.signal)
    const selected = reusableKey(existingKeys, currentKey)
    let created: CreatedApiKey | undefined
    let creationAttempted = false
    let key: string | undefined
    try {
      if (selected !== undefined) {
        key = requiredString(selected.key, 'Cinlan API key listing returned no key')
      } else {
        creationAttempted = true
        created = await requestJson<CreatedApiKey>(
          '/keys',
          { baseURL, signal: session.signal, authorization: 'Bearer ' + accessToken },
          'API-key creation',
          { method: 'POST', body: JSON.stringify({ name: SUB2API_KEY_NAME }) },
        )
        key = requiredString(created.key, 'Cinlan API key creation returned no key')
        requiredId(created.id, 'Cinlan API key creation returned no id')
      }
      const commitKey = requiredString(key, 'Cinlan account flow produced no API key')
      session.signal.throwIfAborted()
      await credentials.modifyRecord(
        recordKey,
        async (): Promise<CredentialRecord> => {
          session.signal.throwIfAborted()
          return { kind: 'api-key', key: commitKey }
        },
      )
      await session.commit({ kind: 'api-key', key: commitKey })
    } catch (error) {
      let commitState: 'present' | 'absent' | 'unknown' = 'absent'
      if (key !== undefined) {
        try {
          const persisted = await credentials.readRecord(recordKey)
          commitState = persisted?.kind === 'api-key' && persisted.key === key ? 'present' : 'absent'
        } catch (readError) {
          commitState = 'unknown'
          ctx.logger.error('llm-pi-ai: Cinlan account credential commit state could not be confirmed', readError)
        }
      }
      if (creationAttempted && commitState === 'unknown') {
        throw cleanupFailure(error)
      }
      if (creationAttempted && commitState === 'absent'
        && !(await cleanupCreatedApiKeys(baseURL, accessToken, created, ctx.logger, cleanupTimeoutMs))) {
        throw cleanupFailure(error)
      }
      throw error
    }
  } finally {
    if (refreshToken !== undefined) {
      await revokeRefreshToken(baseURL, refreshToken, ctx.logger, cleanupTimeoutMs)
    }
  }
}
