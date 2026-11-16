/**
 * JSON-persisted engagement ledger store. Ported from the reviewed
 * `dsh-prompt-custom` campaign ledger, minus its autopilot/follow-up engine:
 * the store is a passive bookkeeping surface. It never sends messages,
 * spawns turns, or touches the network.
 *
 * @module @cinlan/engagement-ledger/store
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { LEDGER_STAGES } from './types.ts'
import type {
  LedgerAsset,
  LedgerAssetCloud,
  LedgerAttempt,
  LedgerCampaign,
  LedgerNextStep,
  LedgerStage,
  LedgerStep,
  LedgerSuggestion,
} from './types.ts'

const MAX_CAMPAIGNS = 64
const MAX_STEPS = 200
const MAX_ATTEMPTS = 300
const MAX_KB_HITS = 20
const MAX_FINDING_LINKS = 32
const MAX_CREDENTIAL_REFS = 16
const clamp = (value: string, length: number) => value.slice(0, length)

interface StoreState {
  schema: 1
  updatedAt: number
  items: LedgerCampaign[]
}

const now = () => new Date().toISOString()

const STAGE_INSTRUCTIONS: Record<LedgerStage, string[]> = {
  recon: [
    'Enumerate live hosts and ports inside the declared scope',
    'Write host/port/fingerprint into the ledger via campaign_upsert',
    'Advance to the fingerprint stage when coverage looks complete',
  ],
  fingerprint: [
    'Identify service and version per asset (banner, headers, page traits)',
    'Call playbook_match for each fingerprinted asset',
    'Advance to the match stage',
  ],
  match: [
    'Pick one critical/high candidate per asset from playbook hits',
    'playbook_read the chosen entry for fingerprint, preconditions and PoC',
    'Advance to the verify stage',
  ],
  verify: [
    'Run the minimal read-only verification from the entry',
    'Record the attempt outcome; promote confirmed issues via finding_* tools',
    'Advance to exploit only with reproduced evidence',
  ],
  exploit: [
    'Execute the PoC strictly inside the authorized scope',
    'Attach captured evidence to the finding record',
    'Advance to lateral or report',
  ],
  lateral: [
    'Reuse obtained credentials only against in-scope assets',
    'Update each asset status as it is settled',
    'Advance to report',
  ],
  report: [
    'Export findings via finding_export',
    'Re-check each entry carries reproduction evidence and steps',
    'Terminal stage — do not advance further',
  ],
}

/**
 * Persistent ledger keyed off one JSON file. All mutations write through a
 * temp file + rename so a torn write never leaves a half file.
 */
export class CampaignStore {
  private state: StoreState = { schema: 1, updatedAt: 0, items: [] }

  constructor(readonly filePath: string) {
    this.load()
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<StoreState>
      this.state = {
        schema: 1,
        updatedAt: Number(parsed.updatedAt) || 0,
        items: Array.isArray(parsed.items) ? parsed.items.slice(0, MAX_CAMPAIGNS) : [],
      }
    } catch {
      this.state = { schema: 1, updatedAt: 0, items: [] }
    }
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    this.state.updatedAt = Date.now()
    const temp = this.filePath + '.tmp'
    writeFileSync(temp, JSON.stringify(this.state, null, 2) + '\n', 'utf8')
    renameSync(temp, this.filePath)
  }

  /** Full snapshot for service-level listing. */
  snapshot(): { updatedAt: number; items: LedgerCampaign[]; path: string } {
    return { updatedAt: this.state.updatedAt, items: this.state.items, path: this.filePath }
  }

  /** Compact per-campaign listing. */
  list(): Array<Pick<LedgerCampaign, 'id' | 'name' | 'stage' | 'sessionId' | 'done' | 'updatedAt'> & { assets: number; steps: number }> {
    return this.state.items.map(c => ({
      id: c.id, name: c.name, stage: c.stage, sessionId: c.sessionId, done: c.done,
      assets: c.assets.length, steps: c.steps.length, updatedAt: c.updatedAt,
    }))
  }

  /** Create a campaign. `scope`/`grantId` come from the service's live grant. */
  create(input: {
    name: string
    objective: string
    note?: string
    sessionId?: string | null
    scope: { targets: string[]; excluded: string[] }
    grantId: string
  }): LedgerCampaign {
    if (this.state.items.length >= MAX_CAMPAIGNS) {
      throw new Error(`engagement-ledger: campaign limit reached (${MAX_CAMPAIGNS})`)
    }
    const campaign: LedgerCampaign = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: clamp(input.name, 120) || 'unnamed engagement',
      stage: 'recon',
      scope: { targets: [...input.scope.targets], excluded: [...input.scope.excluded] },
      grantId: input.grantId,
      assets: [],
      steps: [],
      attempts: [],
      note: clamp(String(input.note ?? ''), 2000),
      objective: clamp(input.objective, 300),
      done: false,
      doneNote: '',
      rounds: 0,
      lastProgress: -1,
      sessionId: input.sessionId ?? null,
      createdAt: now(),
      updatedAt: now(),
    }
    this.state.items = [campaign, ...this.state.items]
    this.save()
    return campaign
  }

  /** Fetch one campaign or throw. */
  get(id: string): LedgerCampaign {
    const campaign = this.state.items.find(c => c.id === id)
    if (!campaign) throw new Error(`engagement-ledger: no campaign ${clamp(String(id), 64)}`)
    return campaign
  }

  /** Patch metadata fields (name, stage, note, objective, done, sessionId). */
  patch(id: string, body: {
    name?: string
    stage?: string
    note?: string
    objective?: string
    done?: boolean
    doneNote?: string
    sessionId?: string | null
  }): LedgerCampaign {
    const campaign = this.get(id)
    if (body.name !== undefined) campaign.name = clamp(String(body.name), 120)
    if (body.stage !== undefined) {
      if (!(LEDGER_STAGES as readonly string[]).includes(body.stage)) {
        throw new Error(`engagement-ledger: stage must be one of ${LEDGER_STAGES.join('/')}`)
      }
      campaign.stage = body.stage as LedgerStage
    }
    if (body.note !== undefined) campaign.note = clamp(String(body.note), 2000)
    if (body.objective !== undefined) campaign.objective = clamp(String(body.objective), 300)
    if (body.done !== undefined) campaign.done = body.done === true
    if (body.doneNote !== undefined) campaign.doneNote = clamp(String(body.doneNote), 500)
    if (body.sessionId !== undefined) {
      const session = body.sessionId === null ? null : clamp(String(body.sessionId), 120)
      if (session !== null) {
        for (const other of this.state.items) {
          if (other.id !== id && other.sessionId === session) other.sessionId = null
        }
      }
      campaign.sessionId = session
    }
    campaign.updatedAt = now()
    this.save()
    return campaign
  }

  /**
   * Upsert one asset. The caller must have already checked `host` against
   * the live grant; the store only normalizes and persists. Finding and
   * credential-reference links accumulate by union across upserts; the cloud
   * identity replaces any previous value.
   */
  upsertAsset(
    id: string,
    host: string,
    body: {
      port?: number | null
      fingerprint?: string
      status?: string
      note?: string
      kbHits?: string[]
      findingIds?: string[]
      credentialRefs?: string[]
      cloud?: LedgerAssetCloud
    } = {},
  ): LedgerAsset {
    const campaign = this.get(id)
    const port = Number.isFinite(Number(body.port)) && body.port !== null ? Number(body.port) : null
    const existing = campaign.assets.find(a => a.host === host && a.port === port)
    const asset = existing ?? {
      host, port, fingerprint: '', status: 'new', kbHits: [], findings: [], credentialRefs: [],
      ...(body.cloud === undefined ? {} : { cloud: body.cloud }),
      note: '', firstSeenAt: now(), lastSeenAt: now(),
    }
    if (body.fingerprint !== undefined) asset.fingerprint = clamp(String(body.fingerprint), 300)
    if (body.status !== undefined) asset.status = clamp(String(body.status), 40)
    if (body.note !== undefined) asset.note = clamp(String(body.note), 500)
    if (Array.isArray(body.kbHits)) asset.kbHits = body.kbHits.map(k => clamp(String(k), 120)).slice(0, MAX_KB_HITS)
    if (Array.isArray(body.findingIds)) {
      const merged = new Set(asset.findings)
      for (const finding of body.findingIds) merged.add(clamp(String(finding), 120))
      asset.findings = [...merged].slice(0, MAX_FINDING_LINKS)
    }
    if (Array.isArray(body.credentialRefs)) {
      const merged = new Set(asset.credentialRefs)
      for (const ref of body.credentialRefs) merged.add(clamp(String(ref), 120))
      asset.credentialRefs = [...merged].slice(0, MAX_CREDENTIAL_REFS)
    }
    if (body.cloud !== undefined) asset.cloud = body.cloud
    asset.lastSeenAt = now()
    if (!existing) campaign.assets.push(asset)
    campaign.updatedAt = asset.lastSeenAt
    this.save()
    return asset
  }

  /** Record one execution step. */
  addStep(id: string, body: { stage?: string; command?: string; result?: string } = {}): LedgerStep {
    const campaign = this.get(id)
    const step: LedgerStep = {
      id: 's' + (campaign.steps.length + 1) + '-' + Math.random().toString(36).slice(2, 5),
      stage: (LEDGER_STAGES as readonly string[]).includes(String(body.stage)) ? body.stage as LedgerStage : campaign.stage,
      action: clamp(String(body.command ?? ''), 500),
      result: clamp(String(body.result ?? ''), 4000),
      at: now(),
    }
    campaign.steps.push(step)
    if (campaign.steps.length > MAX_STEPS) campaign.steps = campaign.steps.slice(-MAX_STEPS)
    campaign.updatedAt = step.at
    this.save()
    return step
  }

  /** Record one PoC/playbook attempt. */
  addAttempt(id: string, body: { asset?: string; kb?: string; payload?: string; outcome?: string } = {}): LedgerAttempt {
    const campaign = this.get(id)
    const attempt: LedgerAttempt = {
      id: 'a' + (campaign.attempts.length + 1),
      asset: clamp(String(body.asset ?? ''), 220),
      kb: clamp(String(body.kb ?? ''), 120),
      payload: clamp(String(body.payload ?? ''), 800),
      outcome: clamp(String(body.outcome ?? ''), 120),
      at: now(),
    }
    campaign.attempts.push(attempt)
    if (campaign.attempts.length > MAX_ATTEMPTS) campaign.attempts = campaign.attempts.slice(-MAX_ATTEMPTS)
    campaign.updatedAt = attempt.at
    this.save()
    return attempt
  }

  /** Advance one stage forward; stops at `report`. */
  advance(id: string): { campaign: LedgerCampaign; from: LedgerStage; to: LedgerStage; changed: boolean } {
    const campaign = this.get(id)
    const from = campaign.stage
    const index = LEDGER_STAGES.indexOf(from)
    const to = index < 0 || index >= LEDGER_STAGES.length - 1 ? campaign.stage : LEDGER_STAGES[index + 1] ?? campaign.stage
    campaign.stage = to
    campaign.updatedAt = now()
    this.save()
    return { campaign, from, to, changed: from !== to }
  }

  /** Remove one campaign. */
  remove(id: string): void {
    const before = this.state.items.length
    this.state.items = this.state.items.filter(c => c.id !== id)
    if (this.state.items.length === before) throw new Error(`engagement-ledger: no campaign ${clamp(String(id), 64)}`)
    this.save()
  }

  /** Campaign bound to a session id, if any (one session binds at most one). */
  forSession(sessionId: string): LedgerCampaign | null {
    return this.state.items.find(c => c.sessionId !== null && c.sessionId === sessionId) ?? null
  }

  /**
   * Record one ledger round and the progress observed at its start. The
   * service calls this from `next()` so repeated zero-progress queries
   * surface the stall hint in {@link nextStep}.
   */
  noteRound(id: string, progress: number): void {
    const campaign = this.get(id)
    campaign.rounds += 1
    campaign.lastProgress = progress
    campaign.updatedAt = now()
    this.save()
  }

  /**
   * Coarse objective progress: stage 0-60%, assets/attempts/hits 0-40%.
   * Bookkeeping signal only — never an authorization or completion check.
   */
  progressOf(campaign: LedgerCampaign): number {
    const stageIndex = Math.max(0, LEDGER_STAGES.indexOf(campaign.stage))
    const stagePart = (stageIndex / (LEDGER_STAGES.length - 1)) * 60
    const assetsPart = Math.min(10, campaign.assets.length * 4)
    const attemptsPart = Math.min(10, campaign.attempts.length * 3)
    const hitPart = Math.min(20, campaign.attempts.filter(a => /hit|success|ok|命中/i.test(a.outcome)).length * 10)
    return Math.round(Math.min(100, stagePart + assetsPart + attemptsPart + hitPart))
  }

  /** Done criteria derived from the objective when none are explicit. */
  criteriaOf(campaign: LedgerCampaign): string[] {
    const out = ['at least one verified finding as objective evidence']
    const objective = campaign.objective || campaign.name
    if (/后台|管理员|admin|管理端/i.test(objective)) out.push('admin-level access to a protected interface demonstrated')
    if (/数据|会员|拖库|导出/i.test(objective)) out.push('cross-account business data read demonstrated (redacted sample)')
    if (/shell|rce|命令执行|服务器/i.test(objective)) out.push('one command executed on target with output captured')
    return out
  }

  /**
   * Next-step projection. `match` is the playbook matcher injected by the
   * service so the store stays free of service imports.
   */
  nextStep(
    id: string,
    match?: (input: { port: number | null; text: string }, limit: number) => Array<{ file: string; cve: string; title: string }>,
  ): LedgerNextStep {
    const campaign = this.get(id)
    const index = LEDGER_STAGES.indexOf(campaign.stage)
    const pending = campaign.assets.filter(a => a.status === 'new' || a.status === 'fingerprinted')
    const suggestions: LedgerSuggestion[] = []
    if (campaign.assets.length === 0) {
      suggestions.push({ kind: 'recon', text: 'No assets in the ledger yet: enumerate the in-scope hosts and write host/port into assets.' })
    }
    if (pending.length > 0 && match !== undefined) {
      for (const asset of pending.slice(0, 5)) {
        const hits = match({ port: asset.port, text: asset.fingerprint }, 3)
        if (hits.length > 0) {
          suggestions.push({
            kind: 'match',
            asset: asset.host + (asset.port !== null ? ':' + asset.port : ''),
            text: 'Fingerprint candidates: ' + hits.map(h => `${h.cve} ${h.title}`).join(' / '),
            hits: hits.map(h => h.file),
          })
        }
      }
    }
    const nextStage = index < 0 || index >= LEDGER_STAGES.length - 1 ? campaign.stage : LEDGER_STAGES[index + 1] ?? campaign.stage
    const progress = this.progressOf(campaign)
    const stalled = progress <= campaign.lastProgress && campaign.rounds >= 2 && !campaign.done
    const tried = new Set(campaign.attempts.map(a => a.kb))
    const nextActions: LedgerSuggestion[] = []
    for (const suggestion of suggestions) {
      for (const hit of suggestion.hits ?? []) {
        if (tried.has(hit)) continue
        nextActions.push({
          kind: 'verify',
          ...(suggestion.asset !== undefined ? { asset: suggestion.asset } : {}),
          text: `Minimal read-only verification per ${hit}`,
          hits: [hit],
        })
      }
    }
    if (nextActions.length === 0 && pending.length > 0) {
      nextActions.push({ kind: 'fingerprint', text: 'Fingerprint pending assets (banner/headers/JS paths), then playbook_match' })
    }
    if (stalled) {
      nextActions.unshift({ kind: 'pivot', text: 'Two rounds without progress: try another entry point or a different candidate instead of repeating the same payload' })
    }
    return {
      campaignId: campaign.id,
      objective: campaign.objective || campaign.name,
      done: campaign.done,
      doneCriteria: this.criteriaOf(campaign),
      progress,
      stalled,
      rounds: campaign.rounds,
      stage: campaign.stage,
      nextStage,
      assets: campaign.assets.length,
      pending: pending.length,
      steps: campaign.steps.length,
      attempts: campaign.attempts.length,
      instructions: STAGE_INSTRUCTIONS[campaign.stage],
      nextActions: nextActions.slice(0, 3),
      suggestions,
    }
  }
}
