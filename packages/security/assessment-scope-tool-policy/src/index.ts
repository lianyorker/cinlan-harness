/** Tool-pipeline Consumer that enforces assessment scope before shell, web, and Browser effects. */
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { AssessmentTargetId } from '@deepseek-ai/dsh-assessment-scope'
import type { AssessmentAction, AssessmentOperationEgress, AssessmentTarget } from '@deepseek-ai/dsh-assessment-scope'
import type { AssessmentScopeSessions, AssessmentSessionOperation } from '@deepseek-ai/dsh-assessment-scope-session'
import type { ExecutionHostService } from '@deepseek-ai/dsh-execution-host'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'assessment-scope-tool-policy'

/** Scope-enforced model effects. */
export interface Config {
  /** Tool names that run shell commands and need active-validation authority. */
  readonly shellTools?: readonly string[]
  /** Tool names that contact network targets and need reconnaissance authority. */
  readonly networkTools?: readonly string[]
  /** Tool names that inspect or operate Browser pages. */
  readonly browserTools?: readonly string[]
}

/** Loader schema for Consumer tool-name overrides. */
export const Config = schema.object({
  shellTools: schema.array(schema.string()),
  networkTools: schema.array(schema.string()),
  browserTools: schema.array(schema.string()),
})

/** Required fail-closed services. */
export const inject = ['tools', 'assessmentScopeSessions', 'executionHost']

const DEFAULT_SHELL = ['bash', 'pwsh'] as const
const DEFAULT_NETWORK = ['web_search', 'web_fetch'] as const
const DEFAULT_BROWSER = [
  'browser_list', 'browser_snapshot', 'browser_screenshot', 'browser_select_element',
  'browser_capture_element', 'browser_downloads', 'browser_upload', 'browser_save_download',
  'browser_history', 'browser_network', 'browser_home', 'browser_search', 'browser_back',
  'browser_forward', 'browser_open', 'browser_navigate', 'browser_click', 'browser_close',
] as const
const CONFIG_KEYS = new Set(['shellTools', 'networkTools', 'browserTools'])

function selected(value: readonly string[] | undefined, fallback: readonly string[], name: string): Set<string> {
  const result = value === undefined || value.length === 0 ? fallback : value
  const invalid = result.length === 0 || result.some(item => item.length === 0 || item.trim() !== item)
    || new Set(result).size !== result.length
  if (invalid) throw new TypeError(`assessment-scope-tool-policy: invalid ${name}`)
  return new Set(result)
}
function argsOf(exec: ToolExecution): Record<string, unknown> { return typeof exec.arguments === 'object' && exec.arguments !== null && !Array.isArray(exec.arguments) ? exec.arguments as Record<string, unknown> : {} }
function urlOf(value: unknown): URL | undefined { if (typeof value !== 'string') return undefined; try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined } catch { return undefined } }
function targetFor(grant: { readonly targets: readonly AssessmentTarget[] }, value: string | undefined): AssessmentTarget | undefined {
  if (value === undefined) return grant.targets.length === 1 ? grant.targets[0] : undefined
  const lower = value.toLowerCase()
  return grant.targets.find(target => target.value.toLowerCase() === lower || (target.kind === 'url-prefix' && lower.startsWith(target.value.toLowerCase())))
}
function denial(decision: { readonly outcome: string; readonly code: string }): string { return `Assessment scope ${decision.outcome} (${decision.code}).` }

/** Install a fail-closed monotonic guard for matched effect Consumers. */
export function apply(ctx: Context, config: Config = {}): void {
  for (const key of Object.keys(config)) if (!CONFIG_KEYS.has(key)) throw new TypeError(`assessment-scope-tool-policy: unsupported config key '${key}'`)
  const shell = selected(config.shellTools, DEFAULT_SHELL, 'shellTools')
  const network = selected(config.networkTools, DEFAULT_NETWORK, 'networkTools')
  const browser = selected(config.browserTools, DEFAULT_BROWSER, 'browserTools')
  const sessions: AssessmentScopeSessions | undefined = ctx.get('assessmentScopeSessions')
  const hosts: ExecutionHostService | undefined = ctx.get('executionHost')
  if (sessions === undefined || hosts === undefined) throw new Error('assessment-scope-tool-policy requires assessment scope and execution host services')
  const admitted = new WeakSet<ToolExecution>()
  const operationFor = (exec: ToolExecution): AssessmentSessionOperation => {
    const agent = exec.agent
    if (agent === undefined) throw new Error('Assessment scope authorization requires an Agent')
    const grant = sessions.require(agent.session)
    const args = argsOf(exec)
    const explicit = typeof args.target_id === 'string' ? args.target_id : undefined
    let target = targetFor(grant, explicit)
    const url = urlOf(args.url)
    if (url !== undefined) target = targetFor(grant, url.hostname) ?? target
    const browserRead = exec.name === 'browser_list' || exec.name === 'browser_snapshot' || exec.name === 'browser_screenshot'
      || exec.name === 'browser_history' || exec.name === 'browser_network' || exec.name === 'browser_downloads'
    const action: AssessmentAction = browser.has(exec.name)
      ? (browserRead ? 'reconnaissance' : 'active-validation')
      : network.has(exec.name) ? 'reconnaissance' : 'active-validation'
    const egress: AssessmentOperationEgress | undefined = url === undefined ? undefined : {
      protocol: url.protocol.slice(0, -1) as 'http' | 'https', host: url.hostname,
      port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), purpose: 'target-access',
    }
    return { action, targetId: target?.id ?? AssessmentTargetId('missing-target'), executionHostId: hosts.current().hostId, ...(egress === undefined ? {} : { egress }) }
  }
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const agent = exec.agent
    if (agent === undefined || (!shell.has(exec.name) && !network.has(exec.name) && !browser.has(exec.name))) return next()
    try {
      const decision = sessions.authorize(agent.session, operationFor(exec))
      if (decision.outcome === 'allow') { admitted.add(exec); return await next() }
      if (decision.outcome === 'approval-required') { admitted.add(exec); return { kind: 'ask', reason: denial(decision) } }
      return { kind: 'deny', reason: denial(decision) }
    } catch (error) { return { kind: 'deny', reason: error instanceof Error ? error.message : 'Assessment scope authorization failed.' } }
  })
  ctx.tools.guard((exec) => {
    if (exec.agent === undefined || (!shell.has(exec.name) && !network.has(exec.name) && !browser.has(exec.name))) return undefined
    return admitted.delete(exec) ? undefined : 'Assessment scope authorization was not admitted for this tool call.'
  })
}
