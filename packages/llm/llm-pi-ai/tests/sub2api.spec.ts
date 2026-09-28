import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { recordKeyFor } from '../src/auth.ts'
import {
  runSub2ApiLogin, SUB2API_LOGIN_METHOD, SUB2API_ORIGIN, SUB2API_PROVIDER_ID,
} from '../src/sub2api.ts'

interface RequestRecord {
  method: string | undefined
  path: string
  headers: IncomingMessage['headers']
  body: Record<string, unknown>
}

interface ServerOptions {
  twoFactor?: boolean
  delayLoginBody?: boolean
  omitAccessToken?: boolean
  invalidRefreshToken?: boolean
  malformedList?: boolean
  omitCreatedId?: boolean
  invalidCreateResponse?: boolean
  failDelete?: boolean
  failLogout?: boolean
  delayLogoutBody?: boolean
  initialKeyStatus?: string
}

interface RemoteKeyState {
  id: number
  key: string
  name: string
  status: string
}

const servers: Server[] = []
const dirs: string[] = []
const contexts: Context[] = []
const nativeFetch = globalThis.fetch.bind(globalThis)
const SUB2API_KEY = recordKeyFor(SUB2API_PROVIDER_ID)

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  let body = ''
  for await (const chunk of request) body += String(chunk)
  if (body.length === 0) return {}
  return JSON.parse(body) as Record<string, unknown>
}

async function serverOf(options: ServerOptions = {}): Promise<{
  url: string
  requests: RequestRecord[]
  remoteKey: () => RemoteKeyState | undefined
}> {
  const requests: RequestRecord[] = []
  let activeKey: RemoteKeyState | undefined = options.initialKeyStatus === undefined ? undefined : {
    id: 7, key: 'sub2api-model-key', name: 'Cinlan Harness', status: options.initialKeyStatus,
  }
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? ''
      const body = await bodyOf(request)
      requests.push({ method: request.method, path, headers: request.headers, body })
      if (request.method === 'POST' && path === '/api/v1/auth/login') {
        const value = {
          code: 0,
          message: 'success',
          data: options.twoFactor === true
            ? { requires_2fa: true, temp_token: 'temporary-login-token' }
            : options.omitAccessToken === true
              ? { refresh_token: options.invalidRefreshToken === true ? 42 : 'account-refresh-token' }
              : { access_token: 'account-access-token', refresh_token: options.invalidRefreshToken === true ? 42 : 'account-refresh-token' },
        }
        if (options.delayLoginBody === true) {
          response.writeHead(200, { 'content-type': 'application/json' })
          setTimeout(() => { response.end(JSON.stringify(value)) }, 50)
        } else json(response, 200, value)
        return
      }
      if (request.method === 'POST' && path === '/api/v1/auth/login/2fa') {
        json(response, 200, {
          code: 0,
          message: 'success',
          data: { access_token: 'account-access-token', refresh_token: 'account-refresh-token' },
        })
        return
      }
      if (request.method === 'GET' && path === '/api/v1/keys?page=1&page_size=1000') {
        json(response, 200, {
          code: 0,
          message: 'success',
          data: options.malformedList === true
            ? {}
            : {
              items: activeKey === undefined ? [] : [activeKey],
              total: activeKey === undefined ? 0 : 1, page: 1, page_size: 1000, pages: 1,
            },
        })
        return
      }
      if (request.method === 'POST' && path === '/api/v1/keys') {
        activeKey = { id: 7, key: 'sub2api-model-key', name: 'Cinlan Harness', status: 'active' }
        if (options.invalidCreateResponse === true) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end('{')
        } else {
          json(response, 200, {
            code: 0,
            message: 'success',
            data: {
              ...options.omitCreatedId === true ? {} : { id: activeKey.id },
              key: activeKey.key,
            },
          })
        }
        return
      }
      if (request.method === 'DELETE' && path === '/api/v1/keys/7') {
        if (options.failDelete === true) {
          json(response, 500, { code: 500, message: 'cleanup failed' })
        } else {
          activeKey = undefined
          json(response, 200, { code: 0, message: 'success', data: {} })
        }
        return
      }
      if (request.method === 'POST' && path === '/api/v1/auth/logout') {
        if (options.failLogout === true) {
          json(response, 500, { code: 500, message: 'logout failed' })
        } else if (options.delayLogoutBody === true) {
          response.writeHead(200, { 'content-type': 'application/json' })
          setTimeout(() => { response.end(JSON.stringify({ code: 0, message: 'success', data: {} })) }, 50)
        } else {
          json(response, 200, { code: 0, message: 'success', data: { message: 'Logged out successfully' } })
        }
        return
      }
      json(response, 404, { code: 404, message: 'not found' })
    })().catch((error) => {
      response.destroy(error as Error)
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Sub2API test server did not bind')
  const url = 'http://127.0.0.1:' + String(address.port)
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const requested = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (requested.origin !== SUB2API_ORIGIN) return nativeFetch(input, init)
    return nativeFetch(url + requested.pathname + requested.search, init)
  })
  return {
    url,
    requests,
    remoteKey: () => activeKey,
  }
}

function interaction(answers: string[]): AuthorizationInteraction & { prompts: AuthorizationPrompt[] } {
  const prompts: AuthorizationPrompt[] = []
  return {
    prompts,
    notify: () => {},
    prompt: (prompt) => {
      prompts.push(prompt)
      const answer = answers.shift()
      if (answer === undefined) throw new Error('test prompt answers exhausted')
      return Promise.resolve(answer)
    },
  }
}

function answers(twoFactor = false): string[] {
  return ['user@example.com', 'account-password', ...twoFactor ? ['123456'] : []]
}

function session(ui: AuthorizationInteraction, signal = new AbortController().signal): AuthorizationSession {
  return { method: SUB2API_LOGIN_METHOD, signal, notify: ui.notify, prompt: ui.prompt, commit: () => {} }
}

async function harness(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-sub2api-login-'))
  dirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  ctx.authorization.registerFlow({
    key: SUB2API_KEY,
    label: 'Cinlan account',
    methods: [{ id: SUB2API_LOGIN_METHOD, label: 'Sign in to Cinlan' }],
    awaitCancellation: true,
    run: attempt => runSub2ApiLogin(ctx, attempt),
  })
  return ctx
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Sub2API authorization', () => {
  it('uses the fixed Cinlan API origin for every account request', async () => {
    const server = await serverOf()
    const ctx = await harness()

    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .resolves.toEqual({ status: 'authorized' })
    expect(server.requests.every(request => request.path.startsWith('/api/v1/'))).toBe(true)
  })

  it('creates a model API key, stores only that key, and revokes the account refresh token', async () => {
    const server = await serverOf()
    const ctx = await harness()
    const ui = interaction(answers())

    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: ui })).resolves.toEqual({ status: 'authorized' })
    await expect(ctx.credentials.readRecord(SUB2API_KEY)).resolves.toEqual({ kind: 'api-key', key: 'sub2api-model-key' })
    expect(JSON.stringify(await ctx.credentials.readRecord(SUB2API_KEY))).not.toContain('account-access-token')
    expect(JSON.stringify(await ctx.credentials.readRecord(SUB2API_KEY))).not.toContain('account-refresh-token')
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/auth/logout',
    ])
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
    expect(server.requests[0]?.body).toEqual({ email: 'user@example.com', password: 'account-password' })
    expect(server.requests[2]?.headers.authorization).toBe('Bearer account-access-token')
    expect(server.requests[2]?.body).toEqual({ name: 'Cinlan Harness' })
    expect(server.requests[3]?.body).toEqual({ refresh_token: 'account-refresh-token' })
    expect(ui.prompts.map(prompt => prompt.autocomplete)).toEqual(['username', 'current-password'])
  })

  it('reuses the issuer key after local deletion instead of creating another active key', async () => {
    const server = await serverOf()
    const ctx = await harness()
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) })).resolves.toEqual({ status: 'authorized' })
    await ctx.credentials.deleteRecord(SUB2API_KEY)
    await expect(ctx.credentials.readRecord(SUB2API_KEY)).resolves.toBeUndefined()
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) })).resolves.toEqual({ status: 'authorized' })

    expect(server.remoteKey()).toEqual({ id: 7, key: 'sub2api-model-key', name: 'Cinlan Harness', status: 'active' })
    expect(server.requests.filter(request => request.method === 'POST' && request.path === '/api/v1/keys')).toHaveLength(1)
    expect(server.requests.some(request => request.method === 'DELETE')).toBe(false)
    await expect(ctx.credentials.readRecord(SUB2API_KEY)).resolves.toEqual({ kind: 'api-key', key: 'sub2api-model-key' })
  })

  it('creates a replacement when the stored issuer key is not active', async () => {
    const server = await serverOf({ initialKeyStatus: 'quota_exhausted' })
    const ctx = await harness()
    await ctx.credentials.modifyRecord(SUB2API_KEY, async () => ({ kind: 'api-key', key: 'sub2api-model-key' }))
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) })).resolves.toEqual({ status: 'authorized' })
    expect(server.requests.filter(request => request.method === 'POST' && request.path === '/api/v1/keys')).toHaveLength(1)
  })

  it('rejects a malformed successful key listing before creating a key', async () => {
    const server = await serverOf({ malformedList: true })
    const ctx = await harness()
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .rejects.toMatchObject({ code: 'SUB2API_INVALID_RESPONSE' })
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/auth/logout',
    ])
  })

  it('preserves cancellation while reading a delayed login body', async () => {
    const server = await serverOf({ delayLoginBody: true })
    const controller = new AbortController()
    const ctx = new Context()
    contexts.push(ctx)
    const pending = runSub2ApiLogin(ctx, session(interaction(answers()), controller.signal))
    await new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => { reject(new Error('login request was not observed')) }, 1000)
      const check = (): void => {
        if (server.requests.length > 0) { clearTimeout(deadline); resolve(); return }
        setImmediate(check)
      }
      check()
    })
    controller.abort()
    const error = await pending.catch(value => value)
    expect(error).not.toMatchObject({ code: 'SUB2API_INVALID_RESPONSE' })
    expect(server.requests.map(request => request.path)).toEqual(['/api/v1/auth/login'])
  })

  it('rejects a malformed refresh token before creating a key', async () => {
    const server = await serverOf({ invalidRefreshToken: true })
    const ctx = await harness()
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .rejects.toMatchObject({ code: 'SUB2API_INVALID_RESPONSE' })
    expect(server.requests.map(request => request.path)).toEqual(['/api/v1/auth/login'])
  })

  it('logs out when login returns a refresh token without an access token', async () => {
    const server = await serverOf({ omitAccessToken: true })
    await expect(runSub2ApiLogin(new Context(), session(interaction(answers()))))
      .rejects.toMatchObject({ code: 'SUB2API_INVALID_RESPONSE' })
    expect(server.requests.map(request => request.path)).toEqual(['/api/v1/auth/login', '/api/v1/auth/logout'])
  })

  it('reports an issuer logout HTTP failure instead of claiming authorization', async () => {
    const server = await serverOf({ failLogout: true })
    const ctx = await harness()

    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(await ctx.credentials.readRecord(SUB2API_KEY)).toEqual({ kind: 'api-key', key: 'sub2api-model-key' })
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/auth/logout',
    ])
  })

  it('reports an issuer logout timeout using the per-request cleanup budget', async () => {
    const server = await serverOf({ delayLogoutBody: true })
    const ctx = await harness()

    await expect(runSub2ApiLogin(ctx, session(interaction(answers()), new AbortController().signal), 5))
      .rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(server.remoteKey()).toBeDefined()
  })

  it('completes 2FA and removes a created key when the record commit fails', async () => {
    const server = await serverOf({ twoFactor: true })
    const ctx = new Context()
    contexts.push(ctx)
    ctx.provide('credentials', {
      readRecord: async () => undefined,
      modifyRecord: async () => { throw new Error('commit rejected') },
    } as never)
    const ui = interaction(answers(true))

    await expect(runSub2ApiLogin(ctx, session(ui))).rejects.toThrow('commit rejected')
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/login/2fa',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])
    expect(server.requests[1]?.body).toEqual({ temp_token: 'temporary-login-token', totp_code: '123456' })
    expect(ui.prompts.map(prompt => prompt.kind)).toEqual(['text', 'secret', 'secret'])
    expect(ui.prompts.map(prompt => prompt.autocomplete)).toEqual(['username', 'current-password', 'one-time-code'])
  })

  it('reports residual remote state when a create response has no id or cleanup fails', async () => {
    const missingIdServer = await serverOf({ omitCreatedId: true })
    const missingId = await harness()
    await expect(missingId.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .rejects.toMatchObject({ code: 'SUB2API_INVALID_RESPONSE' })
    expect(missingIdServer.remoteKey()).toBeUndefined()
    expect(missingIdServer.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])

    const failingDeleteServer = await serverOf({ failDelete: true })
    const failingDelete = new Context()
    contexts.push(failingDelete)
    failingDelete.provide('credentials', {
      readRecord: async () => undefined,
      modifyRecord: async () => { throw new Error('commit rejected') },
    } as never)
    await expect(runSub2ApiLogin(failingDelete, session(interaction(answers()))))
      .rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(failingDeleteServer.remoteKey()).toBeDefined()
    expect(failingDeleteServer.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])
  })

  it('reports an ambiguous remote key when creation succeeds before its response becomes unreadable', async () => {
    const server = await serverOf({ invalidCreateResponse: true })
    const ctx = await harness()
    await expect(ctx.authorization.begin({ key: SUB2API_KEY, interaction: interaction(answers()) }))
      .rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(server.remoteKey()).toBeDefined()
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/auth/logout',
    ])
  })

  it('reports cleanup failure without deleting a key when commit state is unknown', async () => {
    const server = await serverOf()
    const ctx = new Context()
    contexts.push(ctx)
    let reads = 0
    ctx.provide('credentials', {
      readRecord: async () => {
        reads += 1
        if (reads === 1) return undefined
        throw new Error('credential read unavailable')
      },
      modifyRecord: async (_key: string, mutate: (current: undefined) => Promise<unknown>) => {
        await mutate(undefined)
        throw new Error('notification failed after commit')
      },
    } as never)

    await expect(runSub2ApiLogin(ctx, session(interaction(answers()))))
      .rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(server.remoteKey()).toBeDefined()
    expect(server.requests.some(request => request.method === 'DELETE')).toBe(false)
  })

  it('keeps a remote key when credential persistence committed before reporting an error', async () => {
    const server = await serverOf()
    const ctx = new Context()
    contexts.push(ctx)
    const records = new Map<string, unknown>()
    ctx.provide('credentials', {
      readRecord: async (key: string) => records.get(key),
      modifyRecord: async (key: string, mutate: (current: unknown) => Promise<unknown>) => {
        records.set(key, await mutate(records.get(key)))
        throw new Error('notification failed after commit')
      },
    } as never)
    await expect(runSub2ApiLogin(ctx, session(interaction(answers())))).rejects.toThrow('notification failed after commit')
    expect(records.get(SUB2API_KEY)).toEqual({ kind: 'api-key', key: 'sub2api-model-key' })
    expect(server.remoteKey()).toBeDefined()
    expect(server.requests.some(request => request.method === 'DELETE')).toBe(false)
  })

  it('logs out even when the credential service is absent after account login', async () => {
    const server = await serverOf()
    const ui = interaction(answers())
    await expect(runSub2ApiLogin(new Context(), session(ui))).rejects.toMatchObject({ code: 'NO_CREDENTIAL_STORE' })
    expect(server.requests.map(request => request.path)).toEqual(['/api/v1/auth/login', '/api/v1/auth/logout'])
  })

  it('surfaces remote cleanup failure when cancellation interrupts key persistence', async () => {
    const server = await serverOf({ failDelete: true })
    const ctx = new Context()
    contexts.push(ctx)
    const caller = new AbortController()
    ctx.provide('credentials', {
      readRecord: async () => undefined,
      modifyRecord: async (_key: string, mutate: (current: undefined) => Promise<unknown>) => {
        caller.abort()
        return mutate(undefined)
      },
    } as never)
    await ctx.plugin(AuthorizationService)
    ctx.authorization.registerFlow({
      key: SUB2API_KEY,
      label: 'Cinlan account',
      methods: [{ id: SUB2API_LOGIN_METHOD, label: 'Sign in to Cinlan' }],
      awaitCancellation: true,
      run: attempt => runSub2ApiLogin(ctx, attempt),
    })

    await expect(ctx.authorization.begin({
      key: SUB2API_KEY, interaction: interaction(answers()), signal: caller.signal,
    })).rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(server.remoteKey()).toBeDefined()
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])
  })

  it('surfaces issuer logout failure when cancellation interrupts key persistence', async () => {
    const server = await serverOf({ failLogout: true })
    const ctx = new Context()
    contexts.push(ctx)
    const caller = new AbortController()
    ctx.provide('credentials', {
      readRecord: async () => undefined,
      modifyRecord: async (_key: string, mutate: (current: undefined) => Promise<unknown>) => {
        caller.abort()
        return mutate(undefined)
      },
    } as never)
    await ctx.plugin(AuthorizationService)
    ctx.authorization.registerFlow({
      key: SUB2API_KEY,
      label: 'Cinlan account',
      methods: [{ id: SUB2API_LOGIN_METHOD, label: 'Sign in to Cinlan' }],
      awaitCancellation: true,
      run: attempt => runSub2ApiLogin(ctx, attempt),
    })

    await expect(ctx.authorization.begin({
      key: SUB2API_KEY, interaction: interaction(answers()), signal: caller.signal,
    })).rejects.toMatchObject({ code: 'SUB2API_CLEANUP_FAILED' })
    expect(server.remoteKey()).toBeUndefined()
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])
  })

  it('does not commit after mid-flight cancellation and cleans the newly created remote key', async () => {
    const server = await serverOf()
    const ctx = new Context()
    const controller = new AbortController()
    const records = new Map<string, unknown>()
    ctx.provide('credentials', {
      readRecord: async () => undefined,
      modifyRecord: async (key: string, mutate: (current: undefined) => Promise<unknown>) => {
        controller.abort()
        const next = await mutate(undefined)
        records.set(key, next)
        return next
      },
    } as never)
    const ui = interaction(answers())

    await expect(runSub2ApiLogin(ctx, session(ui, controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
    expect(records).toEqual(new Map())
    expect(server.remoteKey()).toBeUndefined()
    expect(server.requests.map(request => request.path)).toEqual([
      '/api/v1/auth/login',
      '/api/v1/keys?page=1&page_size=1000',
      '/api/v1/keys',
      '/api/v1/keys/7',
      '/api/v1/auth/logout',
    ])
  })
})
