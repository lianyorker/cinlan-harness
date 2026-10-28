/** Jira Work Items reads and opt-in writes using the Cloud REST API v3. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { WorkItemId, WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemComment, WorkItemGetRequest, WorkItemListRequest, WorkItemPage, WorkItemsProvider } from '@deepseek-ai/dsh-work-items'
import z from '@deepseek-ai/schemastery'
import type { WorkItemMutation, WorkItemMutationResult, WorkItemsWriter } from '@deepseek-ai/dsh-work-items/types'

/** Cordis plugin name. */
export const name = 'work-items-jira'
/** Services required by the Provider. */
export const inject = ['credentials', 'workItems']

/** Provider id registered with ctx.workItems. */
export const JIRA_WORK_ITEMS_PROVIDER_ID = 'jira' as const

const DEFAULT_CREDENTIAL_REF = 'JIRA_CREDENTIAL'
const DEFAULT_ISSUE_TYPE = 'Task'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_ITEMS = 50
const MAX_ITEMS = 100
const MAX_RESPONSE_BYTES = 2_000_000
const MAX_TEXT_LENGTH = 20_000
const MAX_QUERY_LENGTH = 500
const MAX_CURSOR_LENGTH = 500
const MAX_TIMEOUT_MS = 120_000
const MAX_ADF_NODES = 10_000
/** Comments retained per issue; Jira returns the oldest page, so the newest tail is kept. */
const MAX_COMMENTS = 20

/** Jira project keys are uppercase letters, digits, and underscores. */
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,255}$/
/** Issue keys carry the project prefix and a positive serial. */
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,255}-[1-9][0-9]*$/

/** Jira provider configuration. */
export interface Config {
  /** Enable confirmed external mutations; disabled by default. */
  readonly allowWrites?: boolean
  /** Jira project key such as ENG; an omitted value leaves the Provider unavailable. */
  readonly project?: string
  /** Jira site HTTPS origin such as https://example.atlassian.net; omitted leaves the Provider unavailable. */
  readonly origin?: string
  /** CredentialRef resolved for every request; the value must be `email:api-token`; defaults to JIRA_CREDENTIAL. */
  readonly credentialRef?: string
  /** `basic` sends `email:api-token` over HTTP Basic (Cloud); `bearer` sends the credential as a PAT (Data Center). */
  readonly authScheme?: 'basic' | 'bearer'
  /** Extra JQL clause appended to the built project/state query, such as `priority = High`; omitted adds no constraint. */
  readonly jql?: string
  /** Issue type name used when creating issues; defaults to Task. */
  readonly issueType?: string
  /** Per-request timeout in milliseconds, from 1 through 120000. */
  readonly timeoutMs?: number
  /** Maximum issues requested and returned per page, from 1 through 100. */
  readonly maxItems?: number
}

/** Loader schema for Jira provider configuration. */
export const Config: z<Config> = z.object({
  allowWrites: z.boolean().default(false),
  project: z.string(),
  origin: z.string(),
  credentialRef: z.string().role('credential-ref').default(DEFAULT_CREDENTIAL_REF),
  authScheme: z.union(['basic', 'bearer'] as const).default('basic'),
  jql: z.string(),
  issueType: z.string().default(DEFAULT_ISSUE_TYPE),
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxItems: z.number().default(DEFAULT_MAX_ITEMS),
})

interface ResolvedConfig {
  readonly allowWrites: boolean
  readonly project: string
  readonly origin: string
  readonly credentialRef: CredentialRef
  readonly authScheme: 'basic' | 'bearer'
  readonly jql: string
  readonly issueType: string
  readonly timeoutMs: number
  readonly maxItems: number
}

const CONFIG_KEYS = new Set(['allowWrites', 'project', 'origin', 'credentialRef', 'authScheme', 'jql', 'issueType', 'timeoutMs', 'maxItems'])

function configuredString(value: string | undefined, field: string): string {
  if (value === undefined) return ''
  if (value.length === 0 || value.length > MAX_CURSOR_LENGTH || value.trim() !== value) {
    throw new Error('work-items-jira: ' + field + ' must be non-empty, trimmed, and at most ' + String(MAX_CURSOR_LENGTH) + ' characters when configured')
  }
  return value
}

function positiveInteger(value: number | undefined, fallback: number, field: string, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error('work-items-jira: ' + field + ' must be a positive safe integer no greater than ' + String(maximum))
  }
  return resolved
}

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
 * Validate and resolve Jira deployment settings.
 * @param config - Loader or direct Provider configuration.
 * @returns Complete validated settings.
 */
export function resolveJiraWorkItemsConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error("work-items-jira: unsupported config key '" + key + "'")
  }
  if (config.allowWrites !== undefined && typeof config.allowWrites !== 'boolean') throw new Error('allowWrites must be boolean')
  const project = configuredString(config.project, 'project')
  if (project !== '' && !PROJECT_KEY.test(project)) {
    throw new Error('work-items-jira: project must be an uppercase Jira project key')
  }
  const issueType = configuredString(config.issueType, 'issueType') || DEFAULT_ISSUE_TYPE
  const jql = configuredString(config.jql, 'jql')
  const authScheme = config.authScheme ?? 'basic'
  const origin = configuredString(config.origin, 'origin')
  let parsedOrigin: URL | undefined
  if (origin !== '') {
    try {
      parsedOrigin = new URL(origin)
      if (parsedOrigin.protocol !== 'https:' || parsedOrigin.username || parsedOrigin.password || parsedOrigin.search || parsedOrigin.hash) throw new Error('invalid')
    } catch (error) {
      throw new Error('work-items-jira: origin must be a clean https URL', { cause: error })
    }
  }
  return {
    allowWrites: config.allowWrites ?? false,
    project,
    origin: parsedOrigin?.origin ?? '',
    credentialRef: credentialRef(config.credentialRef ?? DEFAULT_CREDENTIAL_REF),
    authScheme,
    jql,
    issueType,
    timeoutMs: positiveInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs', MAX_TIMEOUT_MS),
    maxItems: positiveInteger(config.maxItems, DEFAULT_MAX_ITEMS, 'maxItems', MAX_ITEMS),
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkItemsError('invalid-response', 'Jira returned an invalid Work Items response')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'Jira returned an invalid Work Item ' + field)
  }
  return value
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new WorkItemsError('invalid-response', 'Jira returned an invalid Work Item ' + field)
  }
  return value
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  const timestamp = optionalText(value, field)
  if (timestamp !== undefined && Number.isNaN(Date.parse(timestamp))) {
    throw new WorkItemsError('invalid-response', 'Jira returned an invalid Work Item ' + field)
  }
  return timestamp
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new WorkItemsError('invalid-response', 'Jira returned invalid Work Item ' + field)
  return value.map(entry => requiredString(entry, field))
}

function providerItemId(value: string): ReturnType<typeof WorkItemId> {
  try {
    return WorkItemId(value)
  } catch (error) {
    throw new WorkItemsError('invalid-response', 'Provider returned an invalid Work Item id', { cause: error })
  }
}

/** Flatten bounded Atlassian Document Format content to plain text. */
function adfToText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const root = objectValue(value)
  if (root.type !== 'doc') throw new WorkItemsError('invalid-response', 'Jira returned a non-ADF description')
  const parts: string[] = []
  let visited = 0
  const walk = (node: unknown, boundary: boolean): void => {
    if (++visited > MAX_ADF_NODES) throw new WorkItemsError('invalid-response', 'Jira description exceeded the node limit')
    if (typeof node !== 'object' || node === null) return
    const entry = node as Record<string, unknown>
    if (entry.type === 'text' && typeof entry.text === 'string') { parts.push(entry.text); return }
    if (entry.type === 'hardBreak') { parts.push('\n'); return }
    if (!Array.isArray(entry.content)) return
    for (const child of entry.content) walk(child, true)
    if (boundary) parts.push('\n')
  }
  walk(root, false)
  const text = parts.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
  return text.length === 0 ? undefined : text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
}

/** Build bounded ADF paragraphs from plain text. */
function textToAdf(text: string): Record<string, unknown> {
  const paragraphs = text.split(/\r?\n\r?\n/).map(block => block.trim()).filter(block => block.length > 0)
  const content = paragraphs.map((paragraph) => {
    const lines = paragraph.split(/\r?\n/)
    const inline: Record<string, unknown>[] = []
    lines.forEach((line, index) => {
      if (index > 0) inline.push({ type: 'hardBreak' })
      if (line.length > 0) inline.push({ type: 'text', text: line })
    })
    return { type: 'paragraph', content: inline }
  })
  return { type: 'doc', version: 1, content }
}

function mapIssue(value: unknown, config: ResolvedConfig): WorkItem {
  const input = objectValue(value)
  const key = requiredString(input.key, 'key')
  if (!ISSUE_KEY.test(key)) throw new WorkItemsError('invalid-response', 'Jira returned an invalid issue key')
  const fields = objectValue(input.fields)
  const status = objectValue(fields.status)
  const body = adfToText(fields.description)
  const assignee = fields.assignee
  const assignees = assignee === null || assignee === undefined ? [] : [requiredString(objectValue(assignee).displayName, 'assignee')]
  const createdAt = optionalTimestamp(fields.created, 'createdAt')
  const updatedAt = optionalTimestamp(fields.updated, 'updatedAt')
  const comments = mapComments(fields.comment)
  return {
    id: providerItemId('jira:' + key),
    source: 'jira',
    externalId: key,
    key,
    title: requiredString(fields.summary, 'title'),
    ...(body === undefined ? {} : { body }),
    state: requiredString(status.name, 'state'),
    url: config.origin + '/browse/' + key,
    repository: config.project,
    labels: stringList(fields.labels ?? [], 'labels'),
    assignees,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(comments.length === 0 ? {} : { comments }),
  }
}

/** Flatten the issue comment container to a bounded normalized list. */
function mapComments(value: unknown): WorkItemComment[] {
  if (value === null || value === undefined) return []
  const container = objectValue(value)
  const entries = container.comments
  if (!Array.isArray(entries)) return []
  return entries.slice(-MAX_COMMENTS).map((entry) => {
    const comment = objectValue(entry)
    const author = comment.author
    const text = adfToText(comment.body)
    const created = optionalTimestamp(comment.created, 'createdAt')
    const updated = optionalTimestamp(comment.updated, 'updatedAt')
    return {
      ...(author === null || author === undefined ? {} : { author: requiredString(objectValue(author).displayName, 'comment author') }),
      body: text ?? '',
      ...(created === undefined ? {} : { createdAt: created }),
      ...(updated === undefined ? {} : { updatedAt: updated }),
    }
  })
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
      if (total > MAX_RESPONSE_BYTES) throw new WorkItemsError('invalid-response', 'Jira response exceeded the byte limit')
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
    throw new WorkItemsError('invalid-response', 'Jira returned invalid JSON', { cause: error })
  }
}

function requestError(error: unknown, signal: AbortSignal | undefined, timedOut: AbortSignal, disposed: AbortSignal): WorkItemsError {
  if (signal?.aborted === true || disposed.aborted) return new WorkItemsError('aborted', 'Jira Work Items request was cancelled', { cause: error })
  if (timedOut.aborted) return new WorkItemsError('provider-failed', 'Jira Work Items request timed out', { cause: error })
  return new WorkItemsError('provider-failed', 'Jira Work Items request failed', { cause: error })
}

const ISSUE_FIELDS = 'summary,description,status,labels,assignee,created,updated,comment'

/** Jira REST provider for one configured project on one site. */
export class JiraWorkItemsProvider implements WorkItemsProvider {
  readonly id = JIRA_WORK_ITEMS_PROVIDER_ID
  private disposed = false
  private readonly lifecycle = new AbortController()

  readonly writer?: WorkItemsWriter

  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig) {
    if (config.allowWrites) this.writer = {
      scope: JSON.stringify([new URL(config.origin || 'https://unconfigured.invalid').host, config.project, 'sha256:' + credentialScopeFingerprint(config.credentialRef)]),
      validate: async (mutation, signal) => {
        this.validateMutation(mutation, signal)
        const assignee = mutation.kind === 'assign' ? mutation.assignees[0] : undefined
        if (assignee !== undefined) await this.assigneeId(assignee, signal)
      },
      execute: (mutation, signal) => this.executeMutation(mutation, signal),
    }
  }

  /** Return scope availability without network or credential I/O. */
  available(): boolean {
    return !this.disposed && this.config.origin.length > 0 && this.config.project.length > 0
  }

  private assertAvailable(): void {
    if (this.disposed) throw new WorkItemsError('unavailable', 'Jira Work Items provider is disposed')
    if (this.config.origin.length === 0 || this.config.project.length === 0) {
      throw new WorkItemsError('unavailable', 'Jira Work Items project is not configured')
    }
  }

  private assertScope(request: WorkItemListRequest): void {
    if (request.source !== undefined && request.source !== 'jira') throw new WorkItemsError('invalid-request', 'requested Work Items source is not Jira')
    const scope = request.scope
    if (scope !== undefined && (scope.source !== 'jira' || scope.project !== this.config.project)) {
      throw new WorkItemsError('invalid-request', 'requested Jira scope is not configured')
    }
    if (request.query !== undefined && request.query.length > MAX_QUERY_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items query is too long')
    if (request.cursor !== undefined && request.cursor.length > MAX_CURSOR_LENGTH) throw new WorkItemsError('invalid-request', 'Work Items cursor is too long')
  }

  /** Resolve `email:api-token` into an Authorization value. */
  private async authorization(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) throw new WorkItemsError('authentication-required', 'Jira credentials are not configured')
    try {
      const resolved = await credentials.resolve(this.config.credentialRef)
      signal.throwIfAborted()
      const value = resolved?.value
      if (value === undefined || value.length === 0) throw new Error('missing')
      if (this.config.authScheme === 'bearer') return 'Bearer ' + value
      if (!value.includes(':')) throw new Error('missing')
      return 'Basic ' + btoa(value)
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error instanceof WorkItemsError) throw error
      throw new WorkItemsError('authentication-required', 'Jira credentials are not configured or are not in the configured credential form', { cause: error })
    }
  }

  private async request(path: string, signal?: AbortSignal, mutation?: { method: 'POST' | 'PUT'; body: unknown }): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const combined = AbortSignal.any([this.lifecycle.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let response: Response
    try {
      const authorization = await this.authorization(combined)
      response = await fetch(this.config.origin + path, {
        method: mutation?.method ?? 'GET',
        ...(mutation === undefined ? {} : { body: JSON.stringify(mutation.body) }),
        redirect: 'error',
        headers: {
          accept: 'application/json',
          ...(mutation === undefined ? {} : { 'content-type': 'application/json' }),
          authorization,
          'user-agent': 'deepseek-harness',
        },
        signal: combined,
      })
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
    if (response.status === 401) throw new WorkItemsError('authentication-required', 'Jira rejected the configured credentials')
    if (response.status === 403) throw new WorkItemsError('forbidden', 'Jira denied access to the configured project')
    if (response.status === 404) throw new WorkItemsError('not-found', 'Jira project or Work Item was not found')
    if (response.status === 429) throw new WorkItemsError('rate-limited', 'Jira rate limited the Work Items request')
    if (response.status === 400 || response.status === 422) throw new WorkItemsError('write-rejected', 'Jira rejected the mutation fields')
    if (!response.ok) throw new WorkItemsError('provider-failed', 'Jira Work Items returned HTTP ' + String(response.status))
    try {
      return await readJson(response, combined)
    } catch (error) {
      if (error instanceof WorkItemsError) throw error
      throw requestError(error, signal, timeout, this.lifecycle.signal)
    }
  }

  /** List issues from the configured project through JQL search. */
  async list(request: WorkItemListRequest = {}, signal?: AbortSignal): Promise<WorkItemPage> {
    this.assertAvailable()
    this.assertScope(request)
    const limit = requestLimit(request.limit, this.config.maxItems, this.config.maxItems)
    const state = request.state === 'closed' ? 'statusCategory = done' : request.state === 'all' ? undefined : 'statusCategory != done'
    const jql = 'project = ' + this.config.project + (state === undefined ? '' : ' AND ' + state) + (this.config.jql === '' ? '' : ' AND (' + this.config.jql + ')') + ' ORDER BY updated DESC'
    const raw = await this.request('/rest/api/3/search/jql', signal, {
      method: 'POST',
      body: {
        jql,
        maxResults: limit,
        fields: ISSUE_FIELDS.split(','),
        ...(request.cursor === undefined ? {} : { nextPageToken: request.cursor }),
      },
    })
    const page = objectValue(raw)
    const issues = page.issues
    if (!Array.isArray(issues) || issues.length > limit) throw new WorkItemsError('invalid-response', 'Jira issue list was invalid or exceeded its bound')
    const items = issues.map(value => mapIssue(value, this.config))
    const query = request.query?.toLocaleLowerCase()
    const filtered = query === undefined || query.length === 0
      ? items
      : items.filter(value => (value.title + '\n' + (value.body ?? '')).toLocaleLowerCase().includes(query))
    const nextPageToken = page.nextPageToken
    const hasMore = page.isLast === false && typeof nextPageToken === 'string' && nextPageToken.length > 0 && nextPageToken.length <= MAX_CURSOR_LENGTH
    return { items: filtered, ...(hasMore ? { nextCursor: nextPageToken } : {}), truncated: false }
  }

  private issueKey(id: string): string {
    const match = /^jira:([A-Z][A-Z0-9_]*)-([1-9][0-9]*)$/.exec(id)
    if (match === null || match[1] !== this.config.project) {
      throw new WorkItemsError('invalid-request', 'Work Item id does not belong to the configured Jira project')
    }
    return id.slice('jira:'.length)
  }

  /** Read one issue from the configured project. */
  async get(request: WorkItemGetRequest, signal?: AbortSignal): Promise<WorkItem> {
    this.assertAvailable()
    const key = this.issueKey(String(request.id))
    const raw = await this.request('/rest/api/3/issue/' + encodeURIComponent(key) + '?fields=' + ISSUE_FIELDS, signal)
    return mapIssue(raw, this.config)
  }

  private validateMutation(mutation: WorkItemMutation, signal?: AbortSignal): void {
    signal?.throwIfAborted()
    this.assertAvailable()
    if (!this.config.allowWrites) throw new WorkItemsError('write-disabled', 'Jira writes are disabled')
    if (mutation.kind === 'create') {
      if (mutation.source !== 'jira') throw new WorkItemsError('invalid-request', 'Wrong Work Items source')
    } else {
      this.issueKey(mutation.id)
      if (mutation.kind === 'state' && mutation.state !== 'open' && mutation.state !== 'closed') {
        throw new WorkItemsError('invalid-request', 'Jira state must be open or closed')
      }
      if (mutation.kind === 'assign' && mutation.assignees.length > 1) {
        throw new WorkItemsError('invalid-request', 'Jira accepts at most one assignee')
      }
    }
  }

  /** Resolve one display name or email to exactly one account id. */
  private async assigneeId(assignee: string, signal?: AbortSignal): Promise<string> {
    const query = new URLSearchParams({ query: assignee, maxResults: '10' })
    const users = await this.request('/rest/api/3/user/search?' + query.toString(), signal)
    if (!Array.isArray(users)) throw new WorkItemsError('invalid-response', 'Jira returned an invalid user lookup')
    const wanted = assignee.toLowerCase()
    const matches = users.map(objectValue).filter((user) => {
      if (user.accountType !== 'atlassian') return false
      const displayName = typeof user.displayName === 'string' ? user.displayName.toLowerCase() : undefined
      const emailAddress = typeof user.emailAddress === 'string' ? user.emailAddress.toLowerCase() : undefined
      return displayName === wanted || emailAddress === wanted
    })
    const [match] = matches
    if (match === undefined || matches.length !== 1) throw new WorkItemsError('write-rejected', 'Each Jira assignee must resolve to exactly one user')
    return requiredString(match.accountId, 'accountId')
  }

  /** Map an open/closed mutation to one workflow transition id. */
  private async transitionId(key: string, target: 'open' | 'closed', signal?: AbortSignal): Promise<string> {
    const raw = await this.request('/rest/api/3/issue/' + encodeURIComponent(key) + '/transitions', signal)
    const transitions = objectValue(raw).transitions
    if (!Array.isArray(transitions)) throw new WorkItemsError('invalid-response', 'Jira returned invalid transitions')
    const wanted = target === 'closed'
    const match = transitions.map(objectValue).find((transition) => {
      const to = transition.to
      if (typeof to !== 'object' || to === null) return false
      const category = (to as Record<string, unknown>).statusCategory
      if (typeof category !== 'object' || category === null) return false
      return ((category as Record<string, unknown>).key === 'done') === wanted
    })
    if (match === undefined) throw new WorkItemsError('write-rejected', 'Jira workflow has no transition reaching the requested state')
    return requiredString(match.id, 'transition id')
  }

  private async executeMutation(mutation: WorkItemMutation, signal?: AbortSignal): Promise<WorkItemMutationResult> {
    this.validateMutation(mutation, signal)
    if (mutation.kind === 'create') {
      const raw = await this.request('/rest/api/3/issue', signal, {
        method: 'POST',
        body: {
          fields: {
            project: { key: this.config.project },
            summary: mutation.title,
            description: textToAdf(mutation.body),
            issuetype: { name: this.config.issueType },
          },
        },
      })
      const created = objectValue(raw)
      const key = requiredString(created.key, 'key')
      if (!ISSUE_KEY.test(key) || !key.startsWith(this.config.project + '-')) {
        throw new WorkItemsError('invalid-response', 'Jira returned an issue outside the configured project')
      }
      return { itemId: providerItemId('jira:' + key), url: this.config.origin + '/browse/' + key }
    }
    const key = this.issueKey(mutation.id)
    const url = this.config.origin + '/browse/' + key
    if (mutation.kind === 'comment') {
      await this.request('/rest/api/3/issue/' + encodeURIComponent(key) + '/comment', signal, { method: 'POST', body: { body: textToAdf(mutation.body) } })
      return { itemId: mutation.id, url }
    }
    if (mutation.kind === 'state') {
      const transition = await this.transitionId(key, mutation.state as 'open' | 'closed', signal)
      await this.request('/rest/api/3/issue/' + encodeURIComponent(key) + '/transitions', signal, { method: 'POST', body: { transition: { id: transition } } })
      return { itemId: mutation.id, url }
    }
    const assignee = mutation.assignees[0]
    const accountId = assignee === undefined ? null : await this.assigneeId(assignee, signal)
    await this.request('/rest/api/3/issue/' + encodeURIComponent(key) + '/assignee', signal, { method: 'PUT', body: { accountId } })
    return { itemId: mutation.id, url }
  }

  /** Stop future provider operations. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifecycle.abort()
  }
}

/** Register the configured Jira provider. */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new JiraWorkItemsProvider(ctx, resolveJiraWorkItemsConfig(config))
  ctx.effect(() => ctx.workItems.registerProvider(provider), 'work-items-jira: provider')
}
