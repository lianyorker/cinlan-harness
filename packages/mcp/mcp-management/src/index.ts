/** Current-profile desired MCP records and the bridge children that apply them. */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-credentials'
import {
  Config as ClientConfig, launchMcpClient, McpConnectionFailure, resolveReconnectPolicy,
  type Config as ResolvedClientConfig, type ConnectionHandle, type McpConnectionError, type McpServerId,
} from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-mcp-client/registry'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { mcpManagementDomain, serverInputSchema, type McpProfileRecord } from './schema.ts'
import { McpManagementError } from './error.ts'
import type {
  McpExternalServerView, McpManagementSnapshot, McpRemoveRequest, McpSaveRequest, McpSaveResult,
  McpServerInput, McpServerRecord, McpServerRequest, McpSetEnabledRequest,
} from './types.ts'

export type * from './types.ts'
export { McpManagementError } from './error.ts'

/** Explicit current-profile identity supplied by the application composition. */
export interface Config {
  /** Launch profile owning the persisted server definitions and active connections. */
  profile: string
}

interface OwnedServer {
  record: McpServerRecord
  stop(): Promise<void>
  handle?: ConnectionHandle
  failure?: McpConnectionError
  stopping?: Promise<void>
}

const EMPTY_PROFILE: McpProfileRecord = { revision: 0, records: [] }

declare module '@deepseek-ai/cordis' {
  interface Context { mcpManagement: McpManagement }
}

/** Persist desired state independently from connection readiness and own only programmatic children. */
export class McpManagement extends Service {
  static inject = ['storageDomain', 'credentials', 'mcpRegistry', 'tools']
  static Config: Schema<Config> = Schema.object({ profile: Schema.string().required().pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/) })
  private readonly owner: Context
  private domain!: Domain<typeof mcpManagementDomain>
  private readonly children = new Map<McpServerId, OwnedServer>()
  private readonly listeners = new Set<() => void>()
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private closing = false
  private snapshot: McpManagementSnapshot

  /** @param ctx - Profile services and the lifetime owning every managed child. @param config - Explicit profile identity. */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'mcpManagement')
    this.owner = ctx
    this.snapshot = { profile: config.profile, revision: 0, reconciling: false, servers: [], external: [] }
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.owner.storageDomain.open(mcpManagementDomain)
    this.domain = domain
    this.owner.effect(() => async () => {
      this.closing = true
      await this.tail
      for (const child of this.children.values()) await this.quiesceChild(child)
      this.children.clear()
      this.publish()
      this.listeners.clear()
      await domain.close()
    }, 'mcp-management.domain-and-children')
    this.owner.effect(() => this.owner.mcpRegistry.subscribe(() => { this.publish() }), 'mcp-management.registry')
    for (const record of this.profile().records) this.validateTiming(record)
    await this.reconcile()
    this.publish()
  }

  /**
   * Read the manager's current complete profile view.
   * @returns Stable readback between desired or observed changes.
   */
  getSnapshot(): McpManagementSnapshot { return this.snapshot }

  /**
   * Observe committed desired state and actual connection changes.
   * @param listener - Notification callback.
   * @returns Disposer for this observer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Persist a validated definition at the requested profile revision, then start applying it.
   * @param request - New or existing record and revision last observed by the editor.
   * @returns Durable identity and a readback that separates desired state from connection state.
   */
  async save(request: McpSaveRequest): Promise<McpSaveResult> {
    const parsed = serverInputSchema.safeParse(request.record)
    if (!parsed.success) throw new McpManagementError('invalid-config')
    const record = parsed.data
    this.validateTiming(record)
    const id = request.id ?? brandString<McpServerId>(randomUUID())
    await this.enqueue(async () => {
      const current = this.requireRevision(request.expectedRevision)
      const existing = current.records.find(item => item.id === id)
      if (this.children.get(id)?.failure === 'close-timeout') throw new McpManagementError('close-failed')
      if (request.id !== undefined && existing === undefined) throw new McpManagementError('not-found')
      if (current.records.some(item => item.id !== id && item.serverName === record.serverName)) {
        throw new McpManagementError('invalid-config')
      }
      const replacement: McpServerRecord = { ...record, id }
      const records = existing === undefined ? [...current.records, replacement]
        : current.records.map(item => item.id === id ? replacement : item)
      await this.commit({ revision: current.revision + 1, records })
      await this.reconcile()
    })
    return { id, snapshot: this.getSnapshot() }
  }

  /**
   * Remove a record only after its owned connection has stopped.
   * @param request - Owned record and expected collection revision.
   * @returns Durable removal and completed child teardown.
   */
  async remove(request: McpRemoveRequest): Promise<McpManagementSnapshot> {
    await this.enqueue(async () => {
      const current = this.requireRevision(request.expectedRevision)
      this.requireRecord(request.id, current)
      await this.stopChild(request.id)
      const records = current.records.filter(record => record.id !== request.id)
      try { await this.commit({ revision: current.revision + 1, records }) } catch (error) {
        await this.reconcile()
        throw error
      }
    })
    return this.getSnapshot()
  }

  /**
   * Save enablement before reconciling its connection lifetime.
   * @param request - Explicit desired enablement and expected revision.
   * @returns Saved switch and current observed connection state.
   */
  async setEnabled(request: McpSetEnabledRequest): Promise<McpManagementSnapshot> {
    await this.enqueue(async () => {
      const current = this.requireRevision(request.expectedRevision)
      this.requireRecord(request.id, current)
      if (request.enabled && this.children.get(request.id)?.failure === 'close-timeout') throw new McpManagementError('close-failed')
      const records = current.records.map(record => record.id === request.id ? { ...record, enabled: request.enabled } : record)
      await this.commit({ revision: current.revision + 1, records })
      await this.reconcile()
    })
    return this.getSnapshot()
  }

  /**
   * Replace an enabled owned child after its previous lifetime has quiesced; resolve credentials anew.
   * @param request - Owned record identity.
   * @returns Connecting or failed observed state without changing the desired revision.
   */
  async reconnect(request: McpServerRequest): Promise<McpManagementSnapshot> {
    await this.enqueue(async () => {
      const record = this.requireRecord(request.id)
      if (!record.enabled) throw new McpManagementError('disabled')
      await this.stopChild(record.id)
      if (!this.closing) this.startChild(record)
    })
    return this.getSnapshot()
  }

  /**
   * Refresh tools through an initialized managed bridge; never starts a disabled server or calls a tool.
   * @param request - Owned record identity.
   * @param signal - Caller cancellation of the tools/list request.
   * @returns Current status and the newly observed tool descriptors.
   */
  async probe(request: McpServerRequest, signal: AbortSignal): Promise<McpManagementSnapshot> {
    this.assertOpen()
    signal.throwIfAborted()
    const record = this.requireRecord(request.id)
    if (!record.enabled) throw new McpManagementError('disabled')
    const child = this.children.get(record.id)
    const handle = child?.handle
    if (handle === undefined || (handle.getSnapshot().phase !== 'ready' && handle.getSnapshot().phase !== 'error')) {
      throw new McpManagementError('not-ready')
    }
    try { await handle.probe(signal) } catch {
      signal.throwIfAborted()
      throw new McpManagementError('probe-failed')
    }
    signal.throwIfAborted()
    this.publish()
    return this.getSnapshot()
  }

  private assertOpen(): void {
    if (this.closing) throw new McpManagementError('stopped')
  }

  private profile(): McpProfileRecord {
    return this.domain.table('profiles').get(this.config.profile) ?? EMPTY_PROFILE
  }

  private requireRevision(revision: number): McpProfileRecord {
    const current = this.profile()
    if (revision !== current.revision) throw new McpManagementError('conflict')
    if (current.revision === Number.MAX_SAFE_INTEGER) throw new McpManagementError('storage-failed')
    return current
  }

  private requireRecord(id: McpServerId, current = this.profile()): McpServerRecord {
    const record = current.records.find(item => item.id === id)
    if (record === undefined) throw new McpManagementError('not-found')
    return record
  }

  private validateTiming(record: McpServerInput): void {
    try { resolveReconnectPolicy(record.reconnect, 'mcp-management.reconnect') } catch {
      throw new McpManagementError('invalid-config')
    }
  }

  private async commit(next: McpProfileRecord): Promise<void> {
    try { await this.domain.table('profiles').put(this.config.profile, next) } catch {
      throw new McpManagementError('storage-failed')
    }
    this.publish()
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen()
    this.pending += 1
    const run = this.tail.then(async () => {
      this.assertOpen()
      return operation()
    }).finally(() => {
      this.pending -= 1
      this.publish()
    })
    // The operation's caller owns rejection; the queue must continue admitting later operations.
    this.tail = run.then(() => {}, () => {})
    this.publish()
    return run
  }

  private async reconcile(): Promise<void> {
    const records = this.profile().records
    for (const [id, child] of this.children) {
      const desired = records.find(record => record.id === id)
      if (desired === undefined || !desired.enabled || !isDeepStrictEqual(desired, child.record)) await this.stopChild(id)
    }
    if (this.closing) return
    for (const record of records) if (record.enabled && !this.children.has(record.id)) this.startChild(record)
  }

  private quiesceChild(child: OwnedServer): Promise<void> {
    return child.stopping ??= child.stop()
  }

  private async stopChild(id: McpServerId): Promise<void> {
    const child = this.children.get(id)
    if (child === undefined) return
    await this.quiesceChild(child)
    if (child.handle?.getSnapshot().errorCode === 'close-timeout') {
      child.failure = 'close-timeout'
      this.publish()
      throw new McpManagementError('close-failed')
    }
    this.children.delete(id)
    this.publish()
  }

  private startChild(record: McpServerRecord): void {
    const child: OwnedServer = { record, stop: async () => {
      await fiber.dispose()
      while (fiber.inertia !== undefined) await fiber.inertia
    } }
    this.children.set(record.id, child)
    // Old credential values are retained only for redacting late diagnostics, never reused for authentication.
    const secrets = new Set<string>()
    const fiber = this.owner.plugin({
      name: 'mcp-managed-server',
      apply: (ctx: Context) => {
        try {
          const handle = launchMcpClient(ctx, this.transportConfig(record), {
            owner: { kind: 'managed', recordId: record.id },
            resolveConfig: signal => this.resolveConfig(record, secrets, signal),
            redact: (text) => {
              let redacted = text
              for (const secret of secrets) redacted = redacted.replaceAll(secret, '[redacted]')
              return redacted
            },
          })
          child.handle = handle
          ctx.effect(() => handle.subscribe(() => { this.publish() }), 'mcp-management.connection-view')
        } catch (error) {
          /* v8 ignore next -- Admitted synchronous launches only throw branded namespace failures; retain a safe unexpected-error code. */
          child.failure = error instanceof McpConnectionFailure ? error.code : 'connection-failed'
        }
        this.publish()
      },
    })
    this.publish()
  }

  private transportConfig(record: McpServerInput, values: Record<string, string> = {}): ResolvedClientConfig {
    const common = {
      serverName: record.serverName, failOnStartupError: false,
      ...record.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: record.toolCallTimeoutMs },
      ...record.reconnect === undefined ? {} : { reconnect: record.reconnect },
    }
    return record.transport === 'stdio'
      ? ClientConfig({ ...common, transport: 'stdio', command: record.command, args: record.args, cwd: record.cwd, env: values })
      : ClientConfig({ ...common, transport: 'streamable-http', url: record.url, headers: values })
  }

  private async resolveConfig(record: McpServerRecord, secrets: Set<string>, signal: AbortSignal): Promise<ResolvedClientConfig> {
    const values = Object.create(null) as Record<string, string>
    const entries = record.transport === 'stdio'
      ? Object.entries(record.env).map(([name, ref]) => ({ name, ref, prefix: '' }))
      : Object.entries(record.headers).map(([name, binding]) => ({ name, ...binding }))
    for (const { name, ref, prefix } of entries) {
      signal.throwIfAborted()
      const credential = await this.owner.credentials.resolve(ref)
      signal.throwIfAborted()
      if (credential === undefined) throw new McpConnectionFailure('missing-credential')
      secrets.add(credential.value)
      values[name] = prefix + credential.value
    }
    return this.transportConfig(record, values)
  }

  private publish(): void {
    const current = this.profile()
    this.snapshot = {
      profile: this.config.profile, revision: current.revision, reconciling: this.pending > 0,
      servers: current.records.map((record) => {
        const child = this.children.get(record.id)
        return {
          record,
          observed: child?.handle?.getSnapshot() ?? {
            phase: child?.failure === undefined ? 'stopped' : 'error', attempt: 0, tools: [],
            ...child?.failure === undefined ? {} : { errorCode: child.failure },
          },
          applying: child?.failure === 'close-timeout' ? false : record.enabled
            ? child === undefined || !isDeepStrictEqual(record, child.record) || (child.handle === undefined && child.failure === undefined)
            : child !== undefined,
        }
      }),
      external: this.owner.mcpRegistry.getSnapshot().filter((connection): connection is McpExternalServerView =>
        connection.owner.kind === 'composition'),
    }
    for (const listener of this.listeners) {
      try { listener() } catch { this.owner.logger.warn('MCP management observer failed') }
    }
  }
}

export default McpManagement
