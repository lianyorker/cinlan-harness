/**
 * Engagement ledger service (`ctx.engagementLedger`): persistent campaign
 * bookkeeping for authorized security engagements — assets, fingerprint
 * notes, execution steps, PoC attempts, and stage progression. Asset writes
 * are validated against the *live* `ctx.assessmentScope` root grant, so the
 * ledger can never record work outside the operator-declared scope.
 *
 * Unlike the plugin this was ported from, the ledger is passive: it never
 * sends follow-up turns, spawns agents, or performs network effects. The
 * model-facing surface is the `campaign_*` tool set.
 *
 * @module @cinlan/engagement-ledger
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AssessmentGrant } from '@deepseek-ai/dsh-assessment-scope'
import { clhHomePath } from '@deepseek-ai/dsh-home-paths'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@cinlan/vuln-playbook'
import { CampaignStore } from './store.ts'
import { assertHostInGrant, normalizeLedgerHost, scopeSnapshot } from './scope.ts'
import { LEDGER_STAGES } from './types.ts'
import type { LedgerAsset, LedgerAttempt, LedgerCampaign, LedgerNextStep, LedgerStep } from './types.ts'

export type {
  LedgerAsset,
  LedgerAssetStatus,
  LedgerAttempt,
  LedgerCampaign,
  LedgerNextStep,
  LedgerStage,
  LedgerStep,
  LedgerSuggestion,
} from './types.ts'
export { LEDGER_STAGES } from './types.ts'
export { CampaignStore } from './store.ts'
export {
  assertHostInGrant,
  cidrContains,
  normalizeLedgerHost,
  scopeSnapshot,
  targetMatchesHost,
} from './scope.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    engagementLedger: EngagementLedger
  }
}

/** Plugin configuration; every deployment-varying choice lives here. */
export interface Config {
  /** Ledger JSON file; defaults to `<clh home>/security/engagement-ledger/campaigns.json`. */
  readonly storeFile?: string
  /** Maximum campaigns kept; defaults to 64. */
  readonly maxCampaigns?: number
}

const CONFIG_KEYS = new Set(['storeFile', 'maxCampaigns'])

interface ResolvedConfig {
  readonly storeFile: string
  readonly maxCampaigns: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`engagement-ledger: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    storeFile: config.storeFile ?? clhHomePath('security', 'engagement-ledger', 'campaigns.json'),
    maxCampaigns: config.maxCampaigns ?? 64,
  }
  if (!Number.isSafeInteger(resolved.maxCampaigns) || resolved.maxCampaigns < 1) {
    throw new TypeError('engagement-ledger: maxCampaigns must be a positive safe integer')
  }
  return resolved
}

/**
 * Ledger service. `static inject` keeps the three dependencies explicit:
 * `tools` hosts the model surface, `assessmentScope` supplies the live root
 * grant that guards asset writes, and `vulnPlaybook` feeds next-step hints.
 */
export class EngagementLedger extends Service {
  static inject = ['tools', 'assessmentScope', 'vulnPlaybook']

  private readonly config: ResolvedConfig
  private readonly store: CampaignStore

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'engagementLedger')
    this.config = resolveConfig(config)
    this.store = new CampaignStore(this.config.storeFile)
    registerLedgerTools(ctx, this)
  }

  /** Live root grant from the active assessment-scope provider. */
  private rootGrant(): AssessmentGrant {
    return this.ctx.assessmentScope.rootGrant
  }

  /** Compact campaign list for `campaign_list`. */
  list(): { updatedAt: number; items: ReturnType<CampaignStore['list']> } {
    return { updatedAt: this.store.snapshot().updatedAt, items: this.store.list() }
  }

  /** One full campaign for `campaign_get`. */
  get(id: string): LedgerCampaign {
    return this.store.get(id)
  }

  /**
   * Create a campaign scoped by the *current* root grant. Empty grants are
   * rejected here so a ledger cannot be opened without authorized targets.
   */
  create(input: { name: string; objective: string; note?: string; sessionId?: string | null }): LedgerCampaign {
    const grant = this.rootGrant()
    const scope = scopeSnapshot(grant)
    if (scope.targets.length === 0) {
      throw new Error('engagement-ledger: the assessment grant declares no targets; add authorized targets to the profile before opening an engagement')
    }
    return this.store.create({ ...input, scope, grantId: String(grant.grantId) })
  }

  /** Asset upsert guarded by the live grant. */
  upsertAsset(id: string, host: string, body: Parameters<CampaignStore['upsertAsset']>[2] = {}): LedgerAsset {
    const normalized = normalizeLedgerHost(host)
    assertHostInGrant(normalized, this.rootGrant())
    return this.store.upsertAsset(id, normalized, body)
  }

  /** Patch campaign metadata (name/stage/note/objective/done/sessionId). */
  patch(id: string, body: Parameters<CampaignStore['patch']>[1]): LedgerCampaign {
    return this.store.patch(id, body)
  }

  /** Record one execution step. */
  addStep(id: string, body: Parameters<CampaignStore['addStep']>[1]): LedgerStep {
    return this.store.addStep(id, body)
  }

  /** Record one PoC/playbook attempt. */
  addAttempt(id: string, body: Parameters<CampaignStore['addAttempt']>[1]): LedgerAttempt {
    return this.store.addAttempt(id, body)
  }

  /** Advance the campaign one stage forward. */
  advance(id: string): ReturnType<CampaignStore['advance']> {
    return this.store.advance(id)
  }

  /** Delete one campaign. */
  remove(id: string): void {
    this.store.remove(id)
  }

  /**
   * Next-step projection enriched with playbook hints. Each call counts as
   * one ledger round so repeated zero-progress calls surface a stall hint.
   */
  next(id: string): LedgerNextStep {
    const result = this.store.nextStep(id, (input, limit) =>
      this.ctx.vulnPlaybook.match({ ...(input.port !== null ? { port: input.port } : {}), text: input.text }, limit))
    this.store.noteRound(id, result.progress)
    return result
  }
}

const campaignSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    stage: { type: 'string', required: true },
    done: { type: 'boolean', required: true },
    assets: { type: 'integer', required: true },
    steps: { type: 'integer', required: true },
    updatedAt: { type: 'string', required: true },
  },
} as const

const stageParam = {
  type: 'string',
  description: `Stage: ${LEDGER_STAGES.join(' | ')}`,
} as const

/**
 * Register the `campaign_*` tool set on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry.
 * @param ledger - the ledger service the tools delegate to.
 */
export function registerLedgerTools(ctx: Context, ledger: EngagementLedger): void {
  ctx.tools.register(defineTool({
    name: 'campaign_create',
    description:
      'Open an engagement ledger scoped by the current authorized assessment grant. '
      + 'Returns the new campaign id used by all other campaign_* calls. Fails when '
      + 'the grant declares no targets.',
    parameters: {
      name: { type: 'string', required: true, description: 'Engagement name.' },
      objective: { type: 'string', required: true, description: 'One-line objective driving done criteria.' },
      note: { type: 'string', description: 'Free-form engagement note.' },
      sessionId: { type: 'string', description: 'Optional session id to bind this campaign to.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          scope: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              targets: { type: 'array', required: true, items: { type: 'string' } },
              excluded: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Campaign ${value.id} "${value.name}" opened (stage ${value.stage}); scope: ${value.scope.targets.join(', ') || '(empty)'}`,
      }],
    },
    async execute(args) {
      const campaign = ledger.create({
        name: String(args.name),
        objective: String(args.objective),
        ...(args.note !== undefined ? { note: String(args.note) } : {}),
        ...(args.sessionId !== undefined ? { sessionId: String(args.sessionId) } : {}),
      })
      return { id: campaign.id, name: campaign.name, stage: campaign.stage, scope: campaign.scope }
    },
    presentCall: args => ({ card: 'generic', title: 'Open engagement ledger', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'campaign_list',
    description: 'List engagement campaigns with stage, asset and step counts.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: { type: 'array', required: true, items: campaignSummarySchema },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.items.length === 0
          ? 'No campaigns yet.'
          : `Campaigns:\n${value.items.map(c => `  - ${c.id} [${c.stage}] ${c.name} (${c.assets} assets, ${c.steps} steps${c.done ? ', done' : ''})`).join('\n')}`,
      }],
    },
    async execute() {
      return {
        items: ledger.list().items.map(item => ({
          id: item.id,
          name: item.name,
          stage: item.stage,
          done: item.done,
          assets: item.assets,
          steps: item.steps,
          updatedAt: item.updatedAt,
        })),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List campaigns', kind: 'other' }),
  }))

  ctx.tools.register(defineTool({
    name: 'campaign_get',
    description: 'Read one full campaign ledger including assets, steps and attempts.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id from campaign_create or campaign_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          campaign: { type: 'object', required: true, additionalProperties: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.campaign, null, 2) }],
    },
    async execute(args) {
      return { campaign: ledger.get(String(args.campaignId)) as unknown as Record<string, JsonValue> }
    },
    presentCall: args => ({ card: 'generic', title: 'Read campaign ledger', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'campaign_upsert',
    description:
      'Bookkeep into an existing campaign: record or update an asset (host is validated '
      + 'against the authorized grant — out-of-scope hosts are rejected), append a step '
      + 'or attempt, advance the stage, or mark the objective done.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id.' },
      stage: stageParam,
      host: { type: 'string', description: 'Asset host; must sit inside the authorized grant scope.' },
      port: { type: 'integer', description: 'Asset port.' },
      fingerprint: { type: 'string', description: 'Observed fingerprint/banner for the asset.' },
      status: { type: 'string', description: 'Asset status: new | fingerprinted | verified | exploited | blocked' },
      assetNote: { type: 'string', description: 'Note attached to the asset.' },
      kbHits: { type: 'array', items: { type: 'string' }, description: 'Playbook file ids matched for this asset.' },
      command: { type: 'string', description: 'Command or action performed in this step (recorded).' },
      result: { type: 'string', description: 'Outcome of this step (recorded).' },
      attemptAsset: { type: 'string', description: 'Attempt record: asset label (host:port).' },
      attemptKb: { type: 'string', description: 'Attempt record: playbook file id used.' },
      attemptPayload: { type: 'string', description: 'Attempt record: payload summary.' },
      attemptOutcome: { type: 'string', description: 'Attempt record: outcome (e.g. hit, blocked, error).' },
      advance: { type: 'boolean', description: 'Move the stage one step forward (recon → … → report).' },
      done: { type: 'boolean', description: 'Mark the engagement objective as achieved.' },
      doneNote: { type: 'string', description: 'Note recorded with completion.' },
      objective: { type: 'string', description: 'Replace the one-line objective.' },
      sessionId: { type: 'string', description: 'Bind this campaign to a session id (unbinds any other campaign using it).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          campaign: { type: 'object', required: true, additionalProperties: true },
        },
      },
      render: (_args, value) => {
        const c = value.campaign as unknown as LedgerCampaign
        return [{
          type: 'text',
          text: `Campaign ${c.id} [${c.stage}] ${c.name}: ${c.assets.length} assets, ${c.steps.length} steps, ${c.attempts.length} attempts${c.done ? ' — done' : ''}`,
        }]
      },
    },
    async execute(args) {
      const id = String(args.campaignId)
      if (args.host !== undefined) {
        ledger.upsertAsset(id, String(args.host), {
          ...(args.port !== undefined ? { port: Number(args.port) } : {}),
          ...(args.fingerprint !== undefined ? { fingerprint: String(args.fingerprint) } : {}),
          ...(args.status !== undefined ? { status: String(args.status) } : {}),
          ...(args.assetNote !== undefined ? { note: String(args.assetNote) } : {}),
          ...(Array.isArray(args.kbHits) ? { kbHits: args.kbHits.map(String) } : {}),
        })
      }
      const patch: Parameters<EngagementLedger['patch']>[1] = {}
      if (args.stage !== undefined) patch.stage = String(args.stage)
      if (args.objective !== undefined) patch.objective = String(args.objective)
      if (args.done !== undefined) patch.done = args.done === true
      if (args.doneNote !== undefined) patch.doneNote = String(args.doneNote)
      if (args.sessionId !== undefined) patch.sessionId = String(args.sessionId)
      if (Object.keys(patch).length > 0) ledger.patch(id, patch)
      if (args.command !== undefined || args.result !== undefined) {
        ledger.addStep(id, {
          ...(args.stage !== undefined ? { stage: String(args.stage) } : {}),
          ...(args.command !== undefined ? { command: String(args.command) } : {}),
          ...(args.result !== undefined ? { result: String(args.result) } : {}),
        })
      }
      if (args.attemptAsset !== undefined || args.attemptKb !== undefined || args.attemptOutcome !== undefined) {
        ledger.addAttempt(id, {
          ...(args.attemptAsset !== undefined ? { asset: String(args.attemptAsset) } : {}),
          ...(args.attemptKb !== undefined ? { kb: String(args.attemptKb) } : {}),
          ...(args.attemptPayload !== undefined ? { payload: String(args.attemptPayload) } : {}),
          ...(args.attemptOutcome !== undefined ? { outcome: String(args.attemptOutcome) } : {}),
        })
      }
      if (args.advance === true) ledger.advance(id)
      return { campaign: ledger.get(id) as unknown as Record<string, JsonValue> }
    },
    presentCall: args => ({ card: 'generic', title: 'Update campaign ledger', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'campaign_next',
    description:
      'Return the suggested next step for a campaign: stage instructions, pending assets, '
      + 'playbook candidates per fingerprint, and a stall hint when progress flattened. '
      + 'Each call counts as one ledger round.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          next: { type: 'object', required: true, additionalProperties: true },
        },
      },
      render: (_args, value) => {
        const next = value.next as unknown as LedgerNextStep
        return [{
          type: 'text',
          text: `[${next.stage} → ${next.nextStage}] progress ${next.progress}%${next.stalled ? ' (stalled)' : ''}\n${next.instructions.map(i => `  · ${i}`).join('\n')}${next.nextActions.length > 0 ? '\nNext: ' + next.nextActions.map(a => a.text).join(' | ') : ''}`,
        }]
      },
    },
    async execute(args) {
      return { next: ledger.next(String(args.campaignId)) as unknown as Record<string, JsonValue> }
    },
    presentCall: args => ({ card: 'generic', title: 'Suggest next campaign step', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'campaign_remove',
    description: 'Delete one campaign ledger by id.',
    parameters: {
      campaignId: { type: 'string', required: true, description: 'Campaign id to delete.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { removed: { type: 'boolean', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: value.removed ? 'Campaign removed.' : 'Campaign not found.' }],
    },
    async execute(args) {
      ledger.remove(String(args.campaignId))
      return { removed: true }
    },
    presentCall: args => ({ card: 'generic', title: 'Remove campaign', kind: 'other', rawInput: args }),
  }))
}
