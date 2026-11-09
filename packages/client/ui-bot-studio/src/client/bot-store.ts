/**
 * Bot-studio store: the bot roster, the edit draft, and the audit trail.
 *
 * Reads go through the `botRegistry` remote (listBots / auditTrail). Writes
 * merge the whole `bot-registry` settings section through
 * `remote.settings.update` — the host side converges registrations on
 * `app-boot/config-reload`, so a committed write is the only UI action the
 * flow needs.
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AuditRow, BotRecord } from '@cinlan/bot-registry'

/** The bot-registry settings namespace on the host wire. */
export const BOT_REGISTRY_SETTINGS_NS = 'bot-registry'

/** One editable bot form row (client-side draft shape; strings/arrays only). */
export type BotDraft = {
  id: string
  name: string
  description: string
  persona: string
  tools: string[]
  credentials: string[]
  order: number | null
}

/** The read-only audit viewer row. */
export type AuditView = AuditRow

/** Settings page state. */
export interface BotStudioState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  saving: boolean
  rows: readonly BotRecord[]
  audit: readonly AuditView[]
  /** The bot currently open in the form editor, or null. */
  draft: BotDraft | null
}

const INITIAL: BotStudioState = { status: 'idle', error: null, saving: false, rows: [], audit: [], draft: null }
const message = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** The empty draft a "new bot" action opens. */
export function emptyDraft(): BotDraft {
  return { id: '', name: '', description: '', persona: '', tools: [], credentials: [], order: null }
}

/** A stored row as the form editor opens it. */
export function draftOf(bot: BotRecord): BotDraft {
  return {
    id: bot.id,
    name: bot.name,
    description: bot.description ?? '',
    persona: bot.persona,
    tools: [...bot.tools],
    credentials: [...bot.credentials],
    order: bot.order ?? null,
  }
}

/** The wire shape a saved draft persists as; empty strings collapse to absent. */
export function recordOf(draft: BotDraft): BotRecord {
  return {
    id: draft.id,
    name: draft.name,
    ...(draft.description === '' ? {} : { description: draft.description }),
    persona: draft.persona,
    tools: [...draft.tools],
    credentials: [...draft.credentials],
    ...(draft.order === null ? {} : { order: draft.order }),
  }
}

/**
 * Loads the roster and audit trail, opens the editor, and saves through the
 * settings namespace.
 */
export class BotStudioController {
  /** Observable studio state. */
  readonly store: SnapshotStore<BotStudioState> = createSnapshotStore(INITIAL)
  private loading: Promise<void> | undefined
  private pendingSave: Promise<string | null> | undefined

  constructor(private readonly ctx: Context) {}

  private set(patch: Partial<BotStudioState>): void { this.store.set({ ...this.store.getSnapshot(), ...patch }) }

  /** Refresh the roster and audit; concurrent calls share one read.
   * @returns Once the read settles.
   */
  load(): Promise<void> {
    return this.loading ??= this.read().finally(() => { this.loading = undefined })
  }

  private async read(): Promise<void> {
    try {
      const describe = await this.ctx.remote.settings.describe()
      if (!describe.ok) throw new Error(describe.error.message)
      const section = describe.value.namespaces.find(row => row.ns === BOT_REGISTRY_SETTINGS_NS)
      const user = (section?.user ?? {}) as { bots?: BotRecord[]; audit?: AuditRow[] }
      const bots = Array.isArray(user.bots) ? user.bots : []
      const audit = Array.isArray(user.audit) ? user.audit : []
      this.set({ status: 'ready', error: null, rows: bots, audit })
    } catch (error) { this.set({ status: 'error', error: message(error) }) }
  }

  /** Open the editor on an empty draft.
   * @param id Optional existing bot id (defaults to empty for create).
   */
  openCreate(): void {
    this.set({ error: null, draft: emptyDraft() })
  }

  /**
   * Open the editor on a stored row.
   * @param botId Bot to edit.
   */
  openEdit(botId: string): void {
    const row = this.store.getSnapshot().rows.find(row => row.id === botId)
    if (row === undefined) return
    this.set({ error: null, draft: draftOf(row) })
  }

  /** Close the editor without saving. */
  closeEditor(): void {
    this.set({ draft: null, error: null })
  }

  /**
   * Patch the open draft.
   * @param patch Fields to merge into the draft.
   */
  patchDraft(patch: Partial<BotDraft>): void {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return
    this.set({ draft: { ...draft, ...patch } })
  }

  /**
   * Save the open draft: validate client-side, then merge the whole section
   * through the settings namespace.
   * @returns the failure message, or null once the write landed.
   */
  save(): Promise<string | null> {
    return this.pendingSave ??= this.saveNow().finally(() => { this.pendingSave = undefined })
  }

  private async saveNow(): Promise<string | null> {
    const draft = this.store.getSnapshot().draft
    if (draft === null) return 'no open draft'
    const problem = clientDraftProblem(draft)
    if (problem !== undefined) return problem
    this.set({ saving: true, error: null })
    try {
      const bot = recordOf(draft)
      const stored = this.store.getSnapshot().rows.find(row => row.id === bot.id)
      // The section merges array-per-array; wholesale replacement of `bots`
      // keeps one write atomic even as another surface edits roles.
      const nextBots = stored === undefined
        ? [...this.store.getSnapshot().rows, bot]
        : this.store.getSnapshot().rows.map(row => row.id === bot.id ? bot : row)
      const response = await this.ctx.remote.settings.update(
        BOT_REGISTRY_SETTINGS_NS,
        { bots: nextBots } as never,
        undefined,
      )
      if (!response.ok) {
        this.set({ saving: false, error: response.error.message })
        return response.error.message
      }
      this.set({ saving: false, draft: null })
      await this.load()
      return null
    } catch (error) {
      this.set({ saving: false })
      return message(error)
    }
  }

  /**
   * Delete a stored bot.
   * @param botId Bot to remove.
   * @returns the failure message, or null once the write landed.
   */
  async remove(botId: string): Promise<string | null> {
    const row = this.store.getSnapshot().rows.find(row => row.id === botId)
    if (row === undefined) return `unknown bot: ${botId}`
    const nextBots = this.store.getSnapshot().rows.filter(row => row.id !== botId)
    const response = await this.ctx.remote.settings.update(
      BOT_REGISTRY_SETTINGS_NS,
      { bots: nextBots } as never,
      undefined,
    )
    if (!response.ok) {
      this.set({ error: response.error.message })
      return response.error.message
    }
    await this.load()
    return null
  }
}

/**
 * Client-side form validation mirroring the host's `botRecordProblem`; the
 * host re-validates on every write, so this only shapes early feedback.
 * @param draft The draft under edit.
 * @returns the first problem sentence, or undefined when the draft is valid.
 */
export function clientDraftProblem(draft: BotDraft): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.id)) return 'id must be lowercase letters, digits, and hyphens, at most 64 characters'
  if (draft.name.trim() === '') return 'name is required'
  if (draft.persona.trim() === '') return 'persona is required'
  if (draft.persona.length > 8192) return 'persona must stay under 8192 characters'
  if (draft.tools.some(tool => tool === '')) return 'tools must be a list of plugin names'
  if (draft.credentials.some(scope => scope === '')) return 'credentials must be a list of scope names'
  return undefined
}
