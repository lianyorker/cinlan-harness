/** Host Remote for the Harness-native Security Research composition. */
import { createRequire } from 'node:module'
import { Context, FiberState } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { AssessmentTargetId } from '@deepseek-ai/dsh-assessment-scope'
import type { AssessmentGrant } from '@deepseek-ai/dsh-assessment-scope'
import type { FindingSnapshot } from '@deepseek-ai/dsh-finding'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-assessment-scope'
import type {} from '@deepseek-ai/dsh-artifact'
import type {} from '@deepseek-ai/dsh-finding'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-skill'
import { SecuritySkillResourceError } from '@deepseek-ai/dsh-security-skills/resources'
import type { SecurityResearchResourceCancelRequest, SecurityResourceAvailability, SecuritySkillResourceStatus } from './types.ts'
import type {} from 'zod'
import type {} from '@deepseek-ai/dsh-vuln-kb-service'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-execution-host'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-assessment-scope-session'
import { FindingCursor } from '@deepseek-ai/dsh-finding'
import { exportFindingsJson, exportFindingsMarkdown, exportFindingsSarif } from '@deepseek-ai/dsh-finding-export'
import type { SecurityResearchComponents, SecurityResearchReportRequest, SecurityResearchReportValue, SecurityResearchScopeStatus, SecurityResearchSnapshot } from './types.ts'

export type * from './types.ts'

const { version: packageVersion } = createRequire(import.meta.url)('../package.json') as { version: string }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Security resource management and Session assessment observations. */
    securityResearchController: SecurityResearchController
  }
}

function isAborted(signal: AbortSignal): boolean { return signal.aborted }

/** Module names that make up the Security Research Host layer. */
const SECURITY_MODULES = {
  securitySkills: '@deepseek-ai/dsh-security-skills',
  workflowPrompt: '@deepseek-ai/dsh-security-workflow-prompt',
  findingTools: '@deepseek-ai/dsh-tool-finding',
} as const

/** Bounds for a complete report; truncated reports are never returned. */
export interface Config {
  /** Maximum complete-report Finding count; default 2000. */
  readonly maxFindings?: number
  /** Maximum UTF-8 report bytes; default 4 MiB. */
  readonly maxReportBytes?: number
}

/** Host Remote for resource management, assessment status, and authorized report downloads. */
export class SecurityResearchController extends TypertRemoteService {
  static inject = ['typert']
  static Config: Schema<Config> = Schema.object({
    maxFindings: Schema.number().step(1).min(1).max(100_000).default(2_000),
    maxReportBytes: Schema.number().step(1).min(1).max(100 * 1024 * 1024).default(4 * 1024 * 1024),
  })
  private readonly resourceObservers = new AbortController()
  private readonly maxFindings: number
  private readonly maxReportBytes: number

  /** @param ctx - Host context with optional security services. @param config - Complete-report limits. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'securityResearchController', { namespace: 'securityResearch' })
    ctx.effect(() => () => { this.resourceObservers.abort() }, 'security resource observers')
    if (Object.keys(config).some(key => key !== 'maxFindings' && key !== 'maxReportBytes')) throw new TypeError('Unknown report limit')
    this.maxFindings = config.maxFindings ?? 2_000
    this.maxReportBytes = config.maxReportBytes ?? 4 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxFindings) || this.maxFindings < 1 || this.maxFindings > 100_000
      || !Number.isSafeInteger(this.maxReportBytes) || this.maxReportBytes < 1 || this.maxReportBytes > 100 * 1024 * 1024) {
      throw new TypeError('Invalid Security Research report limits')
    }
  }

  /**
   * Describe the current Harness-native security composition without exposing
   * target values, credentials, authorization references, or provider paths.
   * @param signal - Caller cancellation.
   * @returns A redacted point-in-time status for the Settings page.
   */
  @Remote('describe')
  async describe(signal: AbortSignal): Promise<SecurityResearchSnapshot> {
    signal.throwIfAborted()
    const preset = await this.presetStatus(signal)
    signal.throwIfAborted()
    const components = this.componentStatus()
    const scope = this.scopeStatus()
    const skills = await this.skillStatus(signal)
    signal.throwIfAborted()
    const coreReady = components.assessmentScope
      && components.findings
      && components.artifacts
      && components.vulnerabilityKnowledgeBase
      && components.securitySkills
      && components.workflowPrompt
      && components.findingTools
    const status = !preset.present
      ? 'not-configured'
      : preset.broken !== undefined || !coreReady || !skills.skillsComplete || skills.skillCount === 0
        ? 'attention'
        : scope.state === 'configured'
          ? 'configured'
          : 'not-configured'
    return { status, preset, scope, components, ...skills }
  }

  /**
   * Export a complete same-Session report after every contained target passes report-download authorization.
   * @param request - Live Session and report format; free-text Finding metadata is exported verbatim.
   * @param signal - Caller cancellation, checked again after every asynchronous operation.
   * @returns Bounded deterministic bytes after the authorization decisions reach Session storage.
   */
  @Remote('exportReport')
  async exportReport(request: SecurityResearchReportRequest, signal: AbortSignal): Promise<SecurityResearchReportValue> {
    signal.throwIfAborted()
    const agents = this.ctx.get('agents')
    const agent = agents?.get(request.sessionId)
    const unavailable = (): RemoteError => new RemoteError('security-research/session-not-live',
      'Security report export requires a live Session', { sessionId: request.sessionId })
    if (agent === undefined) throw unavailable()
    const scopes = this.ctx.get('assessmentScopeSessions')
    const policy = this.ctx.get('assessmentScope')
    const host = this.ctx.get('executionHost')
    const service = this.ctx.get('findings')
    const sessions = this.ctx.get('sessions')
    const scopeRequired = (): RemoteError => new RemoteError('security-research/scope-required',
      'Security report export requires active assessment services', { sessionId: request.sessionId })
    if (scopes === undefined || policy === undefined || host === undefined || service === undefined || sessions === undefined) {
      throw scopeRequired()
    }
    const denied = (code: string): RemoteError => new RemoteError('security-research/export-not-authorized',
      'Security report export was refused by the assessment scope', { sessionId: request.sessionId, code })
    const requireGrant = (): AssessmentGrant => {
      try { return scopes.require(agent.session) } catch (_invalidBinding) { throw scopeRequired() }
    }
    requireGrant()
    const revision = agent.session.seq
    const findings: FindingSnapshot[] = []
    let cursor: ReturnType<typeof FindingCursor> | undefined
    const cursors = new Set<string>()
    do {
      signal.throwIfAborted()
      const page = await service.query(agent, { ...(cursor === undefined ? {} : { cursor }), limit: 100 }, { signal })
      signal.throwIfAborted()
      if (agents?.get(request.sessionId) !== agent) throw unavailable()
      findings.push(...page.items)
      if (findings.length > this.maxFindings) throw new RemoteError('security-research/report-limit', 'Report exceeds the Finding limit', {})
      cursor = page.nextCursor
      if (cursor !== undefined) {
        if (cursors.has(cursor)) throw new RemoteError('security-research/report-changed', 'Finding pagination did not advance', {})
        cursors.add(cursor)
      }
    } while (cursor !== undefined)
    if (agent.session.seq !== revision) throw new RemoteError('security-research/report-changed', 'Session changed while reading Findings', {})
    const grant = requireGrant()
    const targetIds = new Set(findings.flatMap(finding => finding.targets.map(target => String(target.id))))
    if (targetIds.size === 0) {
      const target = grant.targets.find(item => !grant.excludedTargetIds.includes(item.id))
      if (target === undefined) throw denied('ASSESSMENT_TARGET_OUT_OF_SCOPE')
      targetIds.add(target.id)
    }
    const executionHostId = host.current().hostId
    for (const id of [...targetIds].sort()) {
      const decision = scopes.authorize(agent.session, {
        action: 'report-download', targetId: AssessmentTargetId(id), executionHostId,
        evidence: { retainUntil: grant.evidence.retainUntil, redaction: 'none' },
      })
      if (decision.outcome !== 'allow') throw denied(decision.code)
    }
    const data = request.format === 'json' ? exportFindingsJson(findings)
      : request.format === 'markdown' ? exportFindingsMarkdown(findings) : exportFindingsSarif(findings, packageVersion)
    if (data.byteLength > this.maxReportBytes) throw new RemoteError('security-research/report-limit', 'Report exceeds the byte limit', {})
    if (!await sessions.flush(agent.session)) throw new RemoteError('security-research/report-storage', 'No Session storage checkpoint completed', {})
    signal.throwIfAborted()
    if (agents.get(request.sessionId) !== agent) throw unavailable()
    const current = requireGrant()
    if (policy.status(current, Date.now()) !== 'active' || host.current().hostId !== executionHostId) throw scopeRequired()
    const mediaType = request.format === 'json' ? 'application/json' : request.format === 'markdown' ? 'text/markdown' : 'application/sarif+json'
    const fileName = request.format === 'sarif' ? 'security-findings.sarif.json' : request.format === 'markdown' ? 'security-findings.md' : 'security-findings.json'
    return { fileName, mediaType, bytes: data.byteLength, base64: Buffer.from(data).toString('base64'), findingCount: findings.length }
  }

  /**
   * Read resource status without starting an installation or checking the network.
   * @param signal - Caller cancellation for this observation.
   * @returns The manager snapshot or explicit component absence.
   */
  @Remote('describeResources')
  async describeResources(signal: AbortSignal): Promise<SecurityResourceAvailability> {
    signal.throwIfAborted()
    const manager = this.ctx.get('securitySkillResources')
    if (manager === undefined) return { state: 'unavailable', reason: 'component-missing' }
    const snapshot = await manager.status()
    signal.throwIfAborted()
    return snapshot
  }

  /**
   * Observe replacement snapshots; slow consumers retain only a pending refresh.
   * @param signal - Observer lifetime; cancellation never stops a resource operation.
   * @returns Initial state and manager changes until cancellation or controller disposal.
   */
  @Remote({ mode: 'stream' })
  async *observeResources(signal: AbortSignal): AsyncIterable<SecurityResourceAvailability> {
    const lifetime = AbortSignal.any([signal, this.resourceObservers.signal])
    lifetime.throwIfAborted()
    let changed = true
    let wake: (() => void) | undefined
    const refresh = (): void => { changed = true; wake?.() }
    const offChanged = this.ctx.on('security-skill-resources/changed', refresh)
    const offService = this.ctx.on('internal/service', (name) => {
      if (name === 'securitySkillResources') refresh()
    })
    const cleanup = (): void => { offChanged(); offService(); wake?.() }
    lifetime.addEventListener('abort', cleanup, { once: true })
    try {
      while (!lifetime.aborted) {
        if (changed) {
          changed = false
          let snapshot: SecurityResourceAvailability
          try { snapshot = await this.describeResources(lifetime) } catch (error) {
            if (isAborted(lifetime)) return
            throw error
          }
          if (isAborted(lifetime)) break
          yield snapshot
          continue
        }
        await new Promise<void>((resolve) => {
          const done = (): void => { wake = undefined; resolve() }
          wake = done
          if (lifetime.aborted || changed) done()
        })
      }
    } finally {
      lifetime.removeEventListener('abort', cleanup)
      cleanup()
    }
  }

  /**
   * Start a Host-owned release lookup.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The admitted operation and current installation.
   */
  @Remote('checkResourceUpdate')
  checkResourceUpdate(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.checkUpdate())
  }

  /**
   * Start a Host-owned download and installation.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The admitted operation and current installation.
   */
  @Remote('installResource')
  installResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.install())
  }

  /**
   * Replace installed resources using the configured release source.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The admitted operation while the committed installation remains available.
   */
  @Remote('reinstallResource')
  reinstallResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.reinstall())
  }

  /**
   * Start installation of an available resource update.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The admitted operation and current installation.
   */
  @Remote('updateResource')
  updateResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.update())
  }

  /**
   * Explicitly install the package's bundled resources without a download source.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The admitted operation and bundled provenance after commit.
   */
  @Remote('installBundledResource')
  installBundledResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.installBundled())
  }

  /**
   * Cancel only the exact operation the caller observed.
   * @param request - Manager-issued operation identity.
   * @param signal - Caller cancellation before admission.
   * @returns Manager state after the explicit cancellation request.
   */
  @Remote('cancelResource')
  cancelResource(request: SecurityResearchResourceCancelRequest, signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.cancel(request.operationId))
  }

  /**
   * Remove the managed installation through its generation owner.
   * @param signal - Caller cancellation before admission, independent of admitted work.
   * @returns The manager's removal state.
   */
  @Remote('removeResource')
  removeResource(signal: AbortSignal): Promise<SecuritySkillResourceStatus> {
    const manager = this.resourceManager(signal)
    return this.resourceRequest(() => manager.remove())
  }

  private async resourceRequest(operation: () => Promise<SecuritySkillResourceStatus>): Promise<SecuritySkillResourceStatus> {
    try { return await operation() } catch (error) {
      if (error instanceof SecuritySkillResourceError) {
        throw new RemoteError('security-research/resource-request-failed',
          'Security skill resource request was refused', { code: error.code })
      }
      throw new RemoteError('gateway/internal', 'Security skill resource request failed', {})
    }
  }

  private resourceManager(signal: AbortSignal) {
    signal.throwIfAborted()
    const manager = this.ctx.get('securitySkillResources')
    if (manager === undefined) throw new RemoteError('security-research/resources-unavailable',
      'Security skill resource manager is not mounted', { reason: 'component-missing' })
    return manager
  }

  private async presetStatus(signal: AbortSignal): Promise<SecurityResearchSnapshot['preset']> {
    const presets = this.ctx.get('agentPresets')
    if (presets === undefined) return { present: false }
    const rows = await presets.list()
    signal.throwIfAborted()
    const row = rows.find(item => item.id === 'security-research')
    if (row === undefined) return { present: false }
    return {
      present: true,
      trust: row.trust,
      ...(row.broken === undefined ? {} : { broken: 'preset-invalid' }),
    }
  }

  private componentStatus(): SecurityResearchComponents {
    const modules = new Set<string>()
    const loader = this.ctx.get('loader')
    for (const entry of loader?.entries() ?? []) {
      if (entry.options.group || entry.disabled || entry.fiber?.state !== FiberState.ACTIVE) continue
      modules.add(entry.options.name)
    }
    return {
      assessmentScope: this.ctx.get('assessmentScope') !== undefined,
      findings: this.ctx.get('findings') !== undefined,
      artifacts: this.ctx.get('artifacts') !== undefined,
      vulnerabilityKnowledgeBase: this.ctx.get('vulnKb') !== undefined,
      securitySkills: modules.has(SECURITY_MODULES.securitySkills),
      workflowPrompt: modules.has(SECURITY_MODULES.workflowPrompt),
      findingTools: modules.has(SECURITY_MODULES.findingTools),
    }
  }

  private scopeStatus(): SecurityResearchScopeStatus {
    const service = this.ctx.get('assessmentScope')
    if (service === undefined) {
      return {
        present: false,
        state: 'missing',
        targetCount: 0,
        actionCount: 0,
        executionHostCount: 0,
        egressCount: 0,
        credentialCount: 0,
      }
    }
    const grant = service.rootGrant
    const targetCount = grant.targets.length
    const actionCount = grant.actions.length
    const validity = service.status(grant, Date.now())
    return {
      present: true,
      state: validity !== 'active' ? validity
        : targetCount === 0 || actionCount === 0 || grant.executionHostIds.length === 0 ? 'empty' : 'configured',
      targetCount,
      actionCount,
      executionHostCount: grant.executionHostIds.length,
      egressCount: grant.egress.length,
      credentialCount: grant.credentials.length,
      minimumRedaction: grant.evidence.minimumRedaction,
      externalReporting: grant.evidence.externalReporting,
    }
  }

  private async skillStatus(signal: AbortSignal): Promise<Pick<SecurityResearchSnapshot, 'skillCount' | 'skillsComplete'>> {
    const skills = this.ctx.get('skills')
    if (skills === undefined) return { skillCount: 0, skillsComplete: false }
    try {
      const snapshot = await skills.snapshot({ signal })
      return {
        skillCount: snapshot.skills.filter(skill => skill.provider === 'security-skills').length,
        skillsComplete: snapshot.complete,
      }
    } catch (_skillLookupFailure) {
      signal.throwIfAborted()
      this.ctx.logger.warn('Security Research skill status is unavailable.')
      return { skillCount: 0, skillsComplete: false }
    }
  }
}

export default SecurityResearchController
