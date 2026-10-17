/**
 * Durable per-host terminal quick commands. The service owns the stored
 * records and their validation; running a command belongs to the terminal
 * that receives it, so this service never executes anything itself.
 *
 * Every read is scoped to one execution host. A cached list therefore cannot
 * be replayed against a different host: the caller names the host it will run
 * on, and receives only that host's commands.
 *
 * @module @deepseek-ai/dsh-terminal-quick-commands
 */
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { LOCAL_QUICK_COMMAND_HOST, quickCommandsDomain, validateDraft } from './spec.ts'
import type {
  QuickCommand, QuickCommandDraft, QuickCommandFailure, QuickCommandHostId,
  QuickCommandHostList, QuickCommandId, QuickCommandRecord, QuickCommandResult,
} from './types.ts'

export type * from './types.ts'
export { quickCommandsDomain, LOCAL_QUICK_COMMAND_HOST, validateDraft } from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of durable per-host terminal quick commands. */
    terminalQuickCommands: TerminalQuickCommands
  }
}

/** Durable terminal quick commands, read and written through Cordis. */
export default class TerminalQuickCommands extends Service {
  static inject = ['storageDomain']

  private table: KvTable<QuickCommandId, QuickCommandRecord> | undefined
  private readonly listeners = new Set<(host: QuickCommandHostId, commands: readonly QuickCommand[]) => void>()
  /** Serializes mutations so two edits cannot interleave their reads and writes. */
  private mutations: Promise<unknown> = Promise.resolve()

  /** @param ctx - Host context. */
  constructor(ctx: Context) {
    super(ctx, 'terminalQuickCommands')
  }

  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(quickCommandsDomain)
    this.table = domain.table('commands')
    this.ctx.effect(() => async () => {
      this.table = undefined
      this.listeners.clear()
      await this.mutations
      await domain.close()
    }, 'terminal quick commands storage')
  }

  /**
   * List the commands bound to one execution host.
   * @param hostId - Host whose commands the caller will run.
   * @returns that host's commands, oldest first; never another host's.
   */
  list(hostId: QuickCommandHostId): QuickCommandHostList {
    const table = this.requireTable()
    const commands = [...table.entries()]
      .map(([, record]) => record)
      .filter(record => record.hostId === hostId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(record => view(record))
    return { hostId, hosts: this.hosts(), commands }
  }

  /**
   * Every execution host that currently owns at least one command, plus the
   * local host so the menu always has a target.
   * @returns host ids in menu order.
   */
  hosts(): readonly QuickCommandHostId[] {
    const table = this.requireTable()
    const seen = new Set<string>([LOCAL_QUICK_COMMAND_HOST])
    for (const [, record] of table.entries()) seen.add(record.hostId)
    return [...seen].map(host => host as QuickCommandHostId)
  }

  /**
   * Save a new command for one host.
   * @param draft - Host, label, text and optional working directory.
   * @returns the stored command, or the reason the draft is unusable.
   */
  create(draft: QuickCommandDraft): Promise<QuickCommandResult> {
    return this.mutate(async () => {
      const validated = validateDraft(draft.name, draft.command, draft.cwd, draft.description)
      if (!validated.ok) return { ok: false, reason: validated.reason } satisfies QuickCommandResult
      const hostId = draft.hostId.trim()
      if (hostId.length === 0) return { ok: false, reason: 'host-unknown' } satisfies QuickCommandResult

      const now = Date.now()
      const record: QuickCommandRecord = {
        id: randomUUID(), hostId, name: validated.name, command: validated.command,
        ...validated.description === undefined ? {} : { description: validated.description },
        ...validated.cwd === undefined ? {} : { cwd: validated.cwd },
        confirm: draft.confirm ?? false, createdAt: now, updatedAt: now,
      }
      await this.requireTable().put(record.id as QuickCommandId, record)
      this.changed(record.hostId as QuickCommandHostId)
      return { ok: true, value: view(record) } satisfies QuickCommandResult
    })
  }

  /**
   * Replace one command's editable fields.
   * @param id - Stored command identity.
   * @param draft - Replacement host, label, text and optional working directory.
   * @returns the stored command, or the reason the edit is refused.
   */
  update(id: QuickCommandId, draft: QuickCommandDraft): Promise<QuickCommandResult> {
    return this.mutate(async () => {
      const table = this.requireTable()
      const current = table.get(id)
      if (current === undefined) return { ok: false, reason: 'unknown-command' } satisfies QuickCommandResult
      const validated = validateDraft(draft.name, draft.command, draft.cwd, draft.description)
      if (!validated.ok) return { ok: false, reason: validated.reason } satisfies QuickCommandResult
      const hostId = draft.hostId.trim()
      if (hostId.length === 0) return { ok: false, reason: 'host-unknown' } satisfies QuickCommandResult

      const record: QuickCommandRecord = {
        id: current.id, hostId, name: validated.name, command: validated.command,
        ...validated.description === undefined ? {} : { description: validated.description },
        ...validated.cwd === undefined ? {} : { cwd: validated.cwd },
        confirm: draft.confirm ?? current.confirm, createdAt: current.createdAt, updatedAt: Date.now(),
      }
      await table.put(id, record)
      // Both hosts change when a command moves between them.
      this.changed(current.hostId as QuickCommandHostId)
      if (record.hostId !== current.hostId) this.changed(record.hostId as QuickCommandHostId)
      return { ok: true, value: view(record) } satisfies QuickCommandResult
    })
  }

  /**
   * Delete one stored command.
   * @param id - Stored command identity.
   * @returns the removed command, or `unknown-command` when none matched.
   */
  remove(id: QuickCommandId): Promise<QuickCommandResult> {
    return this.mutate(async () => {
      const table = this.requireTable()
      const current = table.get(id)
      if (current === undefined) return { ok: false, reason: 'unknown-command' } satisfies QuickCommandResult
      await table.delete(id)
      this.changed(current.hostId as QuickCommandHostId)
      return { ok: true, value: view(current) } satisfies QuickCommandResult
    })
  }

  /**
   * Observe the commands of one host; the listener also fires when another
   * host's edit does not concern it, so callers re-read rather than diff.
   * @param listener - Receives the host whose commands changed.
   * @returns unsubscribe.
   */
  observe(listener: (host: QuickCommandHostId) => void): () => void {
    const wrapped = (host: QuickCommandHostId): void => { listener(host) }
    this.listeners.add(wrapped)
    return () => { this.listeners.delete(wrapped) }
  }

  private changed(host: QuickCommandHostId): void {
    for (const listener of [...this.listeners]) {
      try { listener(host, this.list(host).commands) } catch { /* one observer must not stop the rest */ }
    }
  }

  /** Run one mutation after the previous one settled, keeping writes ordered. */
  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation, operation)
    this.mutations = next.catch(() => {})
    return next
  }

  private requireTable(): KvTable<QuickCommandId, QuickCommandRecord> {
    if (this.table === undefined) throw new Error('terminal quick commands are not available before the storage domain opens')
    return this.table
  }
}

/** Project a stored record onto the wire view. */
function view(record: QuickCommandRecord): QuickCommand {
  return {
    id: record.id as QuickCommandId,
    hostId: record.hostId as QuickCommandHostId,
    name: record.name,
    command: record.command,
    ...record.description === undefined ? {} : { description: record.description },
    ...record.cwd === undefined ? {} : { cwd: record.cwd },
    confirm: record.confirm,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/** Failure reason the settings page reports when storage is not open yet. */
export const STORAGE_UNAVAILABLE: QuickCommandFailure = 'storage-unavailable'
