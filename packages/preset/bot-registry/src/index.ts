/**
 * Non-technical bot definition registry. Bot rows live in the `bot-registry`
 * settings namespace (profile `settings.yaml`, revision-locked writes); on
 * boot and on every config reload the section is re-read and the diff is
 * applied to {@link AgentPresetRegistry.register}: added bots register,
 * removed bots unregister, updated bots re-register. Write methods validate
 * the caller's role against the namespace's own role table and append an
 * audit row after every committed write.
 * @module @cinlan/bot-registry
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-app-boot'
import type { AgentPresetRegistry, PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import {
  BOT_REGISTRY_NAMESPACE,
  botRecordProblem,
  presetIdFor,
  toPresetDefinition,
  type AuditRow,
  type BotRecord,
  type BotRegistrySection,
} from './form.ts'

export * from './form.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    botRegistry: BotRegistryService
  }
}

/** Service defaults; both are namespace-level knobs, not per-bot fields. */
export interface Config {
  /** Role assumed when the namespace carries no role row for the caller (default `admin`, the single-profile case). */
  readonly defaultRole?: Volatile<'admin' | 'builder' | 'viewer'>
}

const WRITE_ROLES: ReadonlySet<string> = new Set(['admin', 'builder'])

/**
 * Role-gated, audited owner of the `bot-registry` settings namespace.
 *
 * `settings` and `agentPresets` are resolved optionally at call time rather
 * than through `static inject`: a composition without them still stores rows
 * in-memory (tests, minimal hosts), while the write path fails loud when a
 * write cannot be persisted.
 */
export class BotRegistryService extends Service {

  // Init must run after the preset registry is active: the boot-time reload
  // registers every stored bot as an Agent preset, and a noop register at
  // init time would silently drop them until the next config reload.
  static inject = ['agentPresets']

  // The z<Config> annotation is deliberately omitted: volatile() wraps the
  // field type in Volatile<>, and the interface above already reflects that.
  // Top-level volatile, same form as the keybindings namespace: the settings
  // write path only accepts volatile paths, and the whole section (bots,
  // roles, audit) must be writable and readable as one unit. The schema
  // declares the section shape so `describe` projects stored rows back to the
  // browser face; row fields stay loosely typed (union of any) because the
  // registry validates records on read, not the form.
  static Config = z.intersect([
    z.object({
      defaultRole: z.union(['admin', 'builder', 'viewer']).default('admin'),
    }),
    z.object({
      bots: z.array(z.object({
        id: z.string().required(),
        name: z.string().required(),
        description: z.any(),
        persona: z.string().required(),
        tools: z.array(z.any()).default([]),
        credentials: z.array(z.any()).default([]),
        order: z.any(),
      })).default([]),
      roles: z.array(z.object({
        subject: z.string().required(),
        role: z.union(['admin', 'builder', 'viewer']).required(),
      })).default([]),
      audit: z.array(z.any()).default([]),
    }),
  ]).volatile()

  private readonly registered = new Map<string, () => Promise<void>>()
  /** In-memory section for compositions without settings; never authoritative once settings is mounted. */
  private memory: BotRegistrySection = { bots: [], roles: [], audit: [] }

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'botRegistry')
  }

  protected async [Service.init](): Promise<void> {
    await this.reload()
    this.ctx.on('app-boot/config-reload', () => { void this.reload() })
    // UI writes go straight through remote.settings.update and never call
    // putBot, so registration and the audit trail converge here: on every
    // document update, re-register and append an audit row when the bots
    // roster changed and the write did not already carry one.
    this.ctx.on('settings/document-updated', (ns: string) => {
      if (ns !== BOT_REGISTRY_NAMESPACE) return
      this.convergeExternalWrite().catch((error) => {
        this.ctx.logger.error('bot-registry external-write convergence failed: %o', error)
      })
    })
  }

  /** Guards re-entry: the audit append below triggers another document
   *  update, which must not append again. */
  private converging = false
  /** Bots content fingerprint seen at the last convergence; undefined until the first event. */
  private lastSeen: string | undefined

  private async convergeExternalWrite(): Promise<void> {
    if (this.converging) return
    this.converging = true
    try {
      const section = await this.section()
      // Content fingerprint, not just ids: an edit that only changes a
      // bot's description is still an external write and still gets audited.
      const fingerprint = JSON.stringify(section.bots)
      const previous = this.lastSeen
      this.lastSeen = fingerprint
      if (previous === undefined || previous === fingerprint) { await this.reload(); return }
      // A putBot write already named the changed bot in its own audit row.
      const ids = section.bots.map(row => row.id)
      const last = section.audit[section.audit.length - 1]
      const alreadyAudited = last !== undefined
        && last.botId !== undefined
        && ids.includes(last.botId)
        && last.at > Date.now() - 60_000
      if (alreadyAudited) { await this.reload(); return }
      const previousIds: readonly string[] = previous === undefined ? [] : JSON.parse(previous).map((row: BotRecord) => row.id)
      const added = ids.filter(id => !previousIds.includes(id))
      const summary = added.length > 0
        ? `external write: created ${added.join(', ')} (${ids.length} bot(s) total)`
        : `external write: ${ids.length} bot(s) now registered`
      await this.appendAudit(section, summary)
      await this.reload()
    } finally { this.converging = false }
  }

  private async appendAudit(section: BotRegistrySection, summary: string): Promise<void> {
    const settings: SettingsForms | undefined = this.ctx.get('settings')
    if (settings === undefined || this.ctx.fiber.entry === undefined) {
      this.memory = { ...section, audit: [...section.audit, { at: Date.now(), action: 'update', summary }] }
      return
    }
    await settings.update(BOT_REGISTRY_NAMESPACE, {
      bots: section.bots,
      roles: section.roles,
      audit: [...section.audit, { at: Date.now(), action: 'update', summary }],
    })
  }

  /** Every bot row currently stored in the namespace. Host-side reads; the
   *  browser face reads the same section through the settings controller. */
  async listBots(): Promise<BotRecord[]> {
    return [...(await this.section()).bots]
  }

  /**
   * Create or replace one bot, then apply the registration diff.
   * @param caller Subject whose role gates the write (the profile owner in v1).
   * @param bot Validated form row.
   */
  async putBot(caller: string, bot: BotRecord): Promise<void> {
    const problem = botRecordProblem(bot)
    if (problem !== undefined) throw new Error(`Invalid bot row: ${problem}`)
    await this.assertWriter(caller)
    const existing = (await this.section()).bots.find(row => row.id === bot.id)
    await this.writeSection(section => ({
      ...section,
      bots: section.bots.some(row => row.id === bot.id)
        ? section.bots.map(row => row.id === bot.id ? bot : row)
        : [...section.bots, bot],
      audit: [
        ...section.audit,
        {
          at: Date.now(),
          action: existing === undefined ? 'create' : 'update',
          botId: bot.id,
          summary: `${bot.tools.length} tools, ${bot.credentials.length} credentials, persona ${bot.persona.length} chars`,
        },
      ],
    }))
    await this.reload()
  }

  /**
   * Remove one bot, then apply the registration diff.
   * @param caller Subject whose role gates the write.
   * @param botId Bot identity to delete.
   * @throws when the bot does not exist.
   */
  async deleteBot(caller: string, botId: string): Promise<void> {
    await this.assertWriter(caller)
    const removed = (await this.section()).bots.find(row => row.id === botId)
    if (removed === undefined) throw new Error(`Unknown bot: ${botId}`)
    await this.writeSection(section => ({
      ...section,
      bots: section.bots.filter(row => row.id !== botId),
      audit: [...section.audit, { at: Date.now(), action: 'delete', botId, summary: 'removed' }],
    }))
    await this.reload()
  }

  /** Audit trail, newest last. */
  async auditTrail(): Promise<AuditRow[]> {
    return [...(await this.section()).audit]
  }

  /**
   * Re-read the namespace and converge registrations with it. Bots removed
   * from the namespace unregister; new bots register; changed bots re-register.
   *
   * Serialized: init, config-reload, and document-updated can all fire close
   * together, and two interleaved reloads would each see an empty `registered`
   * map and register the same preset twice, which the preset registry rejects
   * as a duplicate. Each queued run re-reads the section, so the last run
   * converges to the newest content.
   */
  private reloadQueue: Promise<void> = Promise.resolve()

  reload(): Promise<void> {
    this.reloadQueue = this.reloadQueue.then(() => this.reloadNow()).catch(() => {})
    return this.reloadQueue
  }

  private async reloadNow(): Promise<void> {
    const section = await this.section()
    const wanted = new Map(section.bots.map(bot => [presetIdFor(bot.id), bot]))
    for (const [presetId, disposer] of [...this.registered]) {
      if (wanted.has(presetId)) continue
      await disposer()
      this.registered.delete(presetId)
    }
    for (const [presetId, bot] of wanted) {
      const existing = this.registered.get(presetId)
      if (existing !== undefined) {
        // The definition may have changed; re-register to converge. The old
        // disposer runs first so the registry's duplicate check never fires.
        await existing()
        this.registered.delete(presetId)
      }
      const definition = toPresetDefinition(bot)
      const disposer = await this.register(definition)
      this.registered.set(presetId, disposer)
    }
  }

  private async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    const presets: AgentPresetRegistry | undefined = this.ctx.get('agentPresets')
    if (presets === undefined) {
      // A registry-less composition (tests, minimal hosts) still stores rows.
      return async () => {}
    }
    return presets.register(definition)
  }

  private async assertWriter(caller: string): Promise<void> {
    const section = await this.section()
    const fallback = this.config.defaultRole
    const role = section.roles.find(row => row.subject === caller)?.role
      ?? (typeof fallback === 'string' ? fallback : fallback?.get()) ?? 'admin'
    if (!WRITE_ROLES.has(role)) {
      throw new Error(`Bot write refused: subject "${caller}" holds role "${role}" (admin or builder required)`)
    }
  }

  private async section(): Promise<BotRegistrySection> {
    const settings: SettingsForms | undefined = this.ctx.get('settings')
    if (settings === undefined) return this.memory
    const descriptor = settings.describe().find(row => row.ns === BOT_REGISTRY_NAMESPACE)
    const user = descriptor?.user as Partial<BotRegistrySection> | undefined
    if (user === undefined) return this.memory
    return {
      bots: Array.isArray(user.bots) ? user.bots as BotRecord[] : [],
      roles: Array.isArray(user.roles) ? user.roles as BotRegistrySection['roles'] : [],
      audit: Array.isArray(user.audit) ? user.audit as AuditRow[] : [],
    }
  }

  /**
   * Persist the next section through the settings service, with an audit row
   * the caller composes. The settings revision lock makes concurrent UI
   * writes fail loud instead of last-write-wins.
   */
  private async writeSection(
    next: (section: BotRegistrySection) => BotRegistrySection,
  ): Promise<void> {
    const current = await this.section()
    const section = next(current)
    const settings: SettingsForms | undefined = this.ctx.get('settings')
    if (settings === undefined || this.ctx.fiber.entry === undefined) {
      // Without a persistable settings namespace the section lives in memory
      // only; callers see the same audit/permission behavior, while the data
      // does not survive a restart.
      this.memory = section
      return
    }
    // The settings revision lock makes concurrent UI writes fail loud
    // instead of last-write-wins.
    await settings.update(BOT_REGISTRY_NAMESPACE, section)
  }
}

export default BotRegistryService
