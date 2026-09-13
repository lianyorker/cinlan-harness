/** GitHub Work Items reads and opt-in writes using the fixed public REST API. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '@deepseek-ai/dsh-work-items'
import z from '@deepseek-ai/schemastery'
import type { WorkItemMutation, WorkItemMutationResult, WorkItemsWriter } from '@deepseek-ai/dsh-work-items/types'

/** Cordis plugin name. */
export const name = 'work-items-github'
/** Services required by the Provider. */
export const inject = ['credentials', 'workItems']

/** GitHub's fixed API origin; it is not configurable or request-controlled. */
export const GITHUB_API_ORIGIN = 'https://api.github.com'
/** Provider id registered with ctx.workItems. */
export const GITHUB_WORK_ITEMS_PROVIDER_ID = 'github' as const

const DEFAULT_CREDENTIAL_REF = 'GITHUB_TOKEN'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_LENGTH = 20_000
const MAX_QUERY_LENGTH = 500
const MAX_CURSOR_LENGTH = 500
const MAX_TIMEOUT_MS = 120_000

/** GitHub provider configuration. */
export interface Config {
  /** Enable confirmed external mutations; disabled by default. */
  readonly allowWrites?: boolean
  /** GitHub repository owner; an omitted value leaves the Provider unavailable; a configured empty value is rejected. */
  readonly owner?: string
  /** GitHub repository name; an omitted value leaves the Provider unavailable; a configured empty value is rejected. */
  readonly repository?: string
  /** CredentialRef resolved for every request; defaults to GITHUB_TOKEN. */
  readonly credentialRef?: string
  /** Per-request timeout in milliseconds, from 1 through 120000. */
  readonly timeoutMs?: number
  /** Maximum issues requested and returned per page, from 1 through 100. */
  readonly maxItems?: number
}

/** Loader schema for GitHub provider configuration. */
export const Config: z<Config> = z.object({
  allowWrites: z.boolean().default(false),
  owner: z.string(),
  repository: z.string(),
  credentialRef: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL_REF),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxItems: z.number().default(DEFAULT_MAX_ITEMS),
})

interface ResolvedConfig {
  readonly allowWrites: boolean
  readonly owner: string
  readonly repository: string
  readonly credentialRef: CredentialRef
  readonly timeoutMs: number
  readonly maxItems: number
}

const CONFIG_KEYS = new Set(['allowWrites', 'owner', 'repository', 'credentialRef', 'timeoutMs', 'maxItems'])

function configuredString(value: string | undefined, field: string): string {
  if (value === undefined) return ''
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || value.trim() !== value) {
    throw new Error('work-items-github: ' + field + ' must be non-empty, trimmed, and at most ' + String(MAX_CURSOR_LENGTH) + ' characters when configured')
  }
  return value
}

function positiveInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error('work-items-github: ' + field + ' must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}


/** Return a non-disclosing credential identity for durable scope comparisons. */
function credentialScopeFingerprint(ref: CredentialRef): string {
  return createHash('sha256').update(ref).digest('hex')
}

function requestLimit(value: number | undefined, fallback: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new WorkItemsError('invalid-request', 'Work Items limit must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}

/**
 * Validate and resolve GitHub deployment settings.
 * @param config - Loader or direct Provider configuration.
 * @returns Complete validated settings.
 */
export function resolveGitHubWorkItemsConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error("work-items-github: unsupported config key '" + key + "'")
  }
  if (config.allowWrites !== undefined && typeof config.allowWrites !== 'boolean') throw new Error('allowWrites must be boolean')
  return {
    allowWrites: config.allowWrites ?? false,
    owner: configuredString(config.owner, 'owner'),
    repository: configuredString(config.repository, 'repository'),
    credentialRef: credentialRef(config.credentialRef ?? DEFAULT_CREDENTIAL_REF),
    timeoutMs: positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
    maxItems: positiveInteger(config.maxItems, DEFAULT_MAX_ITEMS, 'maxItems', MAX_ITEMS),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkItemsError('invalid-response', 'GitHub returned an invalid Work Items response')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'GitHub returned an invalid Work Item ' + field)
  }
  return value
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  return requiredString(value, field)
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'GitHub returned an invalid Work Item ' + field)
  }
  return value
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalString(value, field)
  if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
    throw new WorkItemsError('invalid-response', 'GitHub returned an invalid Work Item ' + field)
  }
  return timestamp
}

function issueUrl(value: unknown): string {
  const url = requiredString(value, 'url')
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port !== '' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('invalid')
    return parsed.href
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'GitHub returned an invalid Work Item URL', { cause: error })
  }
}

function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new WorkItemsError('invalid-response', 'GitHub returned invalid Work Item labels')
  return value.map(entry => requiredString(objectValue(entry).name, 'label'))
}

function logins(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new WorkItemsError('invalid-response', 'GitHub returned invalid Work Item assignees')
  return value.map(entry => requiredString(objectValue(entry).login, 'assignee'))
}


function providerItemId(value: string): ReturnType<typeof WorkItemId> {
  try {
    return WorkItemId(value)
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Provider returned an invalid Work Item id', { cause: error })
  }
}

function mapIssue(value: unknown, config: ResolvedConfig): WorkItem | undefined {
  const input = objectValue(value)
  if (Object.hasOwn(input, 'pull_request')) return undefined
  const number = input.number
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) throw new WorkItemsError('invalid-response', 'GitHub returned an invalid issue number')
  const body = optionalText(input.body, 'body')
  const createdAt = optionalTimestamp(input.created_at, 'createdAt')
  const updatedAt = optionalTimestamp(input.updated_at, 'updatedAt')
  return {
    id: providerItemId('github:' + config.owner + '/' + config.repository + '#' + String(number)),
    source: 'github',
    externalId: String(number),
    key: '#' + String(number),
    title: requiredString(input.title, 'title'),
    ...(body === undefined ? {} : { body }),
    state: requiredString(input.state, 'state'),
    url: issueUrl(input.html_url),
    repository: config.owner + '/' + config.repository,
    labels: names(input.labels),
    assignees: logins(input.assignees),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}


async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel()
  } catch {
    // The bounded read result remains authoritative; stream cleanup is best-effort.
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw new WorkItemsError('invalid-response', 'GitHub response exceeded the byte limit')
      chunks.push(next.value)
      signal.throwIfAborted()
    }
  } finally {
    await cancelReader(reader)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'GitHub returned invalid JSON', { cause: error })
  }
}

function requestError(error: unknown, signal: AbortSignal | undefined, timedOut: AbortSignal, disposed: AbortSignal): WorkItemsError {
  if (signal?.aborted === true || disposed.aborted) return new WorkItemsError('aborted', 'GitHub Work Items request was cancelled', { cause: error })
  if (timedOut.aborted) return new WorkItemsError('provider-failed', 'GitHub Work Items request timed out', { cause: error })
  return new WorkItemsError('provider-failed', 'GitHub Work Items request failed', { cause: error })
}

/** GitHub REST provider for one configured repository. */
export class GitHubWorkItemsProvider implements WorkItemsProvider {
  readonly id = GITHUB_WORK_ITEMS_PROVIDER_ID
  private disposed = false
  private readonly lifecycle = new AbortController()

  readonly writer?: WorkItemsWriter

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    if (config.allowWrites) this.writer = {
      scope: JSON.stringify([config.owner, config.repository, 'sha256:' + credentialScopeFingerprint(config.credentialRef)]),
      validate: (mutation, signal) => Promise.resolve().then(() => { this.validateMutation(mutation, signal) }),
      execute: (mutation, signal) => this.executeMutation(mutation, signal),
    }
  }

  /** Return scope availability without network or credential I/O. */
  available(): boolean {
    return !this.disposed && this.config.owner.length > 0 && this.config.repository.length > 0
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkItemsError('unavailable', 'GitHub Work Items provider is disposed')
    if (this.config.owner.length === 0 || this.config.repository.length === 0) {
      throw new WorkItemsError('unavailable', 'GitHub Work Items repository is not configured')
    }
  }

  private assertScope(request: WorkItemListRequest): void {
    if (request.source !== undefined && request.source !== 'github') throw new WorkItemsError('invalid-request', 'requested Work Items source is not GitHub')
    const scope = request.scope
    if (scope !== undefined && (scope.source !== 'github' || scope.owner !== this.config.owner || scope.repository !== this.config.repository)) {
      throw new WorkItemsError('invalid-request', 'requested GitHub scope is not configured')
    }
    if (request.query !== undefined && request.query.length > MAX_QUERY_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items query is too long')
    if (request.cursor !== undefined && request.cursor.length > MAX_CURSOR_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items cursor is too long')
  }

  private async token(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new WorkItemsError('authentication-required', 'GitHub credentials are not configured')
    try {
      const resolved = await credentials.resolve(this.config.credentialRef)
      signal.throwIfAborted()
      if (resolved?.value === undefined || resolved.value.length === 0) throw new Error('missing')
      return resolved.value
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof WorkItemsError) throw error
      throw new WorkItemsError('authentication-required', 'GitHub credentials are not configured', { cause: error })
    }
  }

  private async request(path: string, signal?: AbortSignal, mutation?: { method: 'POST' | 'PATCH'; body: unknown }): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let response: Response
    try {
      const token = await this.token(combined)
      response = await fetch(GITHUB_API_ORIGIN + path, {
        method: mutation?.method ?? 'GET',
        ...(mutation === undefined ? {} : { body: JSON.stringify(mutation.body) }),
        redirect: 'error',
        headers: {
          accept: 'application/vnd.github+json',
          ...(mutation === undefined ? {} : { 'content-type': 'application/json' }),
          authorization: 'Bearer ' + token,
          'user-agent': 'deepseek-harness',
          'x-github-api-version': '2022-11-28',
        },
        signal: combined,
      })
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
    if (response.status === 401) throw new WorkItemsError('authentication-required', 'GitHub rejected the configured credentials')
    if (response.status === 403) throw new WorkItemsError('forbidden', 'GitHub denied access to the configured repository')
    if (response.status === 404) throw new WorkItemsError('not-found', 'GitHub repository or Work Item was not found')
    if (response.status === 429) throw new WorkItemsError('rate-limited', 'GitHub rate limited the Work Items request')
    if (response.status === 400 || response.status === 422) throw new WorkItemsError('write-rejected', 'GitHub rejected the mutation fields')
    if (!response.ok) throw new WorkItemsError('provider-failed', 'GitHub Work Items returned HTTP ' + String(response.status))
    try {
      return await readJson(response, combined)
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
  }

  /** List issues from the configured repository. */
  async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage> {
    this.assertAvailable()
    this.assertScope(request)
    const limit = requestLimit(request.limit, this.config.maxItems, this.config.maxItems)
    const page = request.cursor === undefined ? 1 : Number(request.cursor)
    if (!Number.isSafeInteger(page) || page < 1) throw new WorkItemsError('invalid-request', 'GitHub cursor must be a positive page number')
    const params = new URLSearchParams({ state: request.state ?? 'open', per_page: String(limit), page: String(page) })
    const path = '/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repository) + '/issues?' + params.toString()
    const raw = await this.request(path, signal)
    if (!Array.isArray(raw) || raw.length > limit) throw new WorkItemsError('invalid-response', 'GitHub issue list was invalid or exceeded its bound')
    const items = raw.map(value => mapIssue(value, this.config)).filter((value): value is WorkItem => value !== undefined)
    const query = request.query?.toLocaleLowerCase()
    const filtered = query === undefined || query.length === 0
      ? items
      : items.filter(value => (value.title + '\n' + (value.body ?? '')).toLocaleLowerCase().includes(query))
    return { items: filtered, ...(raw.length === limit ? { nextCursor: String(page + 1) } : {}), truncated: false }
  }

  /** Read one issue from the configured repository. */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    this.assertAvailable()
    const match = /^github:([^/]+)\/([^#]+)#([1-9][0-9]*)$/.exec(String(request.id))
    if (match === null || match[3] === undefined || match[1] !== this.config.owner || match[2] !== this.config.repository) {
      throw new WorkItemsError('invalid-request', 'Work Item id does not belong to the configured GitHub repository')
    }
    const raw = await this.request('/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repository) + '/issues/' + match[3], signal)
    const result = mapIssue(raw, this.config)
    if (result === undefined) throw new WorkItemsError('not-found', 'GitHub Work Item was not found')
    return result
  }

  private issueNumber(id: string): string {
    const match = /^github:([^/]+)\/([^#]+)#([1-9][0-9]*)$/.exec(id)
    if (match === null || match[3] === undefined || match[1] !== this.config.owner || match[2] !== this.config.repository) {
      throw new WorkItemsError('invalid-request', 'Work Item is outside the configured repository')
    }
    return match[3]
  }

  private validateMutation(mutation: WorkItemMutation, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    this.assertAvailable()
    if (!this.config.allowWrites) throw new WorkItemsError('write-disabled', 'GitHub writes are disabled')
    if (mutation.kind === 'create') {
      if (mutation.source !== 'github') throw new WorkItemsError('invalid-request', 'Wrong Work Items source')
    } else {
      this.issueNumber(mutation.id)
      if (mutation.kind === 'state' && mutation.state !== 'open' && mutation.state !== 'closed') {
        throw new WorkItemsError('invalid-request', 'GitHub state must be open or closed')
      }
      if (mutation.kind === 'assign' && mutation.assignees.some(login => !/^[a-zA-Z0-9-]{1,39}$/.test(login))) {
        throw new WorkItemsError('invalid-request', 'Invalid GitHub assignee login')
      }
    }
  }

  private async executeMutation(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemMutationResult> {
    this.validateMutation(mutation, signal)
    const base = '/repos/' + encodeURIComponent(this.config.owner) + '/' + encodeURIComponent(this.config.repository) + '/issues'
    if (mutation.kind === 'create') {
      const item = mapIssue(await this.request(base, signal, { method: 'POST', body: { title: mutation.title, body: mutation.body } }), this.config)
      if (item === undefined) throw new WorkItemsError('invalid-response', 'GitHub did not return the created issue')
      return { itemId: item.id, url: item.url }
    }
    const number = this.issueNumber(mutation.id)
    const path = base + '/' + number
    if (mutation.kind === 'comment') {
      const raw = objectValue(await this.request(path + '/comments', signal, { method: 'POST', body: { body: mutation.body } }))
      if (typeof raw.id !== 'number' || !Number.isSafeInteger(raw.id) || raw.id < 1) throw new WorkItemsError('invalid-response', 'GitHub comment receipt is invalid')
      return { itemId: mutation.id, url: 'https://github.com/' + this.config.owner + '/' + this.config.repository + '/issues/' + number }
    }
    const body = mutation.kind === 'state' ? { state: mutation.state } : { assignees: [...mutation.assignees] }
    const item = mapIssue(await this.request(path, signal, { method: 'PATCH', body }), this.config)
    if (item === undefined || item.id !== mutation.id) throw new WorkItemsError('invalid-response', 'GitHub returned a different issue')
    return { itemId: item.id, url: item.url }
  }

  /** Stop future provider operations. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort()
  }
}

/** Register the configured GitHub provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new GitHubWorkItemsProvider(ctx, resolveGitHubWorkItemsConfig(config))
  ctx.effect(() => ctx.workItems.registerProvider(provider), 'work-items-github: provider')
}
