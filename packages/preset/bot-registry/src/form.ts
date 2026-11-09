/**
 * The bot form projection: a bot definition is a constrained view over an
 * AgentPresetRegistry {@link PresetDefinition} — persona prefix, tool
 * allow-list, and authorization-scope references. Everything a non-technical
 * editor must not set (plugin names, config blocks, JS expressions) has no
 * form field, so it cannot be expressed from the form.
 * @module @cinlan/bot-registry/form
 */

import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'

/** One bot row as stored in the `bot-registry` settings namespace. */
export interface BotRecord {
  /** Stable bot identity, also the preset id (`bot-<slug>`). */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-line purpose shown in the roster. */
  readonly description?: string
  /** Persona prefix prepended to the agent's system prompt. */
  readonly persona: string
  /** Model-facing tool plugin names the bot may mount. */
  readonly tools: readonly string[]
  /** Authorization scope references (names, never secrets). */
  readonly credentials: readonly string[]
  /** Roster sort weight; lower comes first. */
  readonly order?: number
}

/** Settings namespace this registry owns. */
export const BOT_REGISTRY_NAMESPACE = 'bot-registry'

/** Shape of the whole namespace section (see the package README for YAML). */
export interface BotRegistrySection {
  readonly bots: readonly BotRecord[]
  /** Minimal v1 role table; the subject is the profile owner in v1. */
  readonly roles: readonly { readonly subject: string; readonly role: 'admin' | 'builder' | 'viewer' }[]
  /** Append-only change audit. */
  readonly audit: readonly AuditRow[]
}

/** One audited change to the namespace. */
export interface AuditRow {
  /** Epoch milliseconds of the committed write. */
  readonly at: number
  /** Action performed. */
  readonly action: 'create' | 'update' | 'delete' | 'seed-roles'
  /** Bot the action touched, when any. */
  readonly botId?: string
  /** One-line field-level summary. */
  readonly summary: string
}

const BOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/**
 * Validate one bot row from the form.
 * @param record Form-submitted bot row.
 * @returns The first problem sentence, or undefined when the row is valid.
 */
export function botRecordProblem(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null || Array.isArray(record)) return 'a bot row must be an object'
  const row = record as Record<string, unknown>
  if (typeof row.id !== 'string' || !BOT_ID_PATTERN.test(row.id)) {
    return 'id must be lowercase letters, digits, and hyphens, at most 64 characters'
  }
  if (typeof row.name !== 'string' || row.name.trim() === '') return 'name is required'
  if (row.description !== undefined && typeof row.description !== 'string') return 'description must be a string'
  if (typeof row.persona !== 'string' || row.persona.trim() === '') return 'persona is required'
  if (row.persona.length > 8192) return 'persona must stay under 8192 characters'
  if (!Array.isArray(row.tools) || row.tools.some(tool => typeof tool !== 'string' || tool === '')) {
    return 'tools must be a list of plugin names'
  }
  if (!Array.isArray(row.credentials) || row.credentials.some(item => typeof item !== 'string' || item === '')) {
    return 'credentials must be a list of scope names'
  }
  if (row.order !== undefined && (typeof row.order !== 'number' || !Number.isInteger(row.order))) {
    return 'order must be an integer'
  }
  return undefined
}

/**
 * Project a validated bot row into a PresetDefinition for
 * {@link AgentPresetRegistry.register}. The projection is additive: persona
 * becomes the `@deepseek-ai/dsh-persona` row, each tool name becomes one
 * plugin row named verbatim, credential scopes become
 * `@deepseek-ai/dsh-credentials/grant` rows carrying only scope names.
 * @param bot Validated bot row.
 * @returns The preset declaration to register.
 */
export function toPresetDefinition(bot: BotRecord): PresetDefinition {
  return {
    id: `bot-${bot.id}`,
    ...(bot.name === undefined ? {} : { name: bot.name }),
    ...(bot.description === undefined ? {} : { description: bot.description }),
    ...(bot.order === undefined ? {} : { order: bot.order }),
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { prefix: bot.persona },
      },
      ...bot.tools.map(tool => ({ id: tool, name: tool })),
      ...bot.credentials.map(scope => ({
        id: `credentials-${scope}`,
        name: '@deepseek-ai/dsh-credentials/grant',
        config: { scope },
      })),
    ],
  }
}

/**
 * The preset id a bot row registers under.
 * @param botId Bot identity.
 * @returns The preset id (`bot-<id>`).
 */
export function presetIdFor(botId: string): string {
  return `bot-${botId}`
}

/**
 * Extract the bot id a registered preset came from.
 * @param presetId Registered preset id.
 * @returns The bot id, or undefined when the preset was not bot-born.
 */
export function botIdFor(presetId: string): string | undefined {
  return presetId.startsWith('bot-') ? presetId.slice('bot-'.length) : undefined
}
