/**
 * Configurable permission Consumer for persistent browser tools. Observation,
 * navigation, and interaction are independent `allow | ask | deny` classes;
 * a monotonic ToolRuntime guard prevents listener-order bypasses.
 * @module @deepseek-ai/dsh-browser-permission-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'browser-permission-policy'

/** Tool pipeline service required for decisions and monotonic enforcement. */
export const inject = ['tools']

/** One configured permission decision. */
export type BrowserPermissionDecision = 'allow' | 'ask' | 'deny'

/** Independent policy for browser observation, navigation, and interaction. */
export interface Config {
  /** list/snapshot/screenshot policy. Defaults to `ask`. */
  readonly observe?: BrowserPermissionDecision
  /** open/navigate policy. Defaults to `ask`. */
  readonly navigate?: BrowserPermissionDecision
  /** click/close policy. Defaults to `ask`. */
  readonly interact?: BrowserPermissionDecision
}

interface ResolvedConfig {
  readonly observe: BrowserPermissionDecision
  readonly navigate: BrowserPermissionDecision
  readonly interact: BrowserPermissionDecision
}

type PermissionClass = keyof ResolvedConfig

const CONFIG_KEYS = new Set(['observe', 'navigate', 'interact'])
const DECISIONS = new Set<BrowserPermissionDecision>(['allow', 'ask', 'deny'])

/** Approval prompt for read-only persistent-browser observation. */
export const BROWSER_OBSERVE_APPROVAL_REASON = 'Allow this call to observe persistent browser tabs or page content?'
/** Approval prompt for opening or navigating persistent browser pages. */
export const BROWSER_NAVIGATE_APPROVAL_REASON = 'Allow this call to open or navigate a persistent browser page and contact its destination?'
/** Approval prompt for browser interaction or tab closure. */
export const BROWSER_INTERACT_APPROVAL_REASON = 'Allow this call to interact with or close a persistent browser page?'

const ASK_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: BROWSER_OBSERVE_APPROVAL_REASON,
  navigate: BROWSER_NAVIGATE_APPROVAL_REASON,
  interact: BROWSER_INTERACT_APPROVAL_REASON,
}

const DENY_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: 'Persistent browser observation is denied by policy.',
  navigate: 'Persistent browser navigation is denied by policy.',
  interact: 'Persistent browser interaction is denied by policy.',
}

const CLASS_BY_TOOL: Readonly<Record<string, PermissionClass>> = {
  browser_list: 'observe',
  browser_snapshot: 'observe',
  browser_screenshot: 'observe',
  browser_select_element: 'observe',
  browser_capture_element: 'observe',
  browser_downloads: 'observe',
  browser_upload: 'interact',
  browser_save_download: 'interact',
  browser_history: 'observe',
  browser_network: 'observe',
  browser_home: 'navigate',
  browser_search: 'navigate',
  browser_back: 'navigate',
  browser_forward: 'navigate',
  browser_open: 'navigate',
  browser_navigate: 'navigate',
  browser_click: 'interact',
  browser_close: 'interact',
}

/** Loader schema for the three independent permission classes. */
export const Config: z<Config> = z.object({
  observe: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  navigate: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  interact: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
})

/**
 * Validate and default browser permission config.
 * @param config - Loader or direct-plugin config.
 * @returns Complete permission policy.
 */
export function resolveBrowserPermissionConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`browser-permission-policy: unsupported config key '${key}'`)
    }
  }
  const resolved: ResolvedConfig = {
    observe: config.observe ?? 'ask',
    navigate: config.navigate ?? 'ask',
    interact: config.interact ?? 'ask',
  }
  for (const key of ['observe', 'navigate', 'interact'] as const) {
    const value = resolved[key]
    if (!DECISIONS.has(value)) {
      throw new Error(`browser-permission-policy: ${key} must be "allow", "ask", or "deny"`)
    }
  }
  return resolved
}

/**
 * Install permission decisions and the matching monotonic execution guard.
 * @param ctx - Context carrying the ToolRuntime pipeline.
 * @param config - Independent observe/navigate/interact decisions.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveBrowserPermissionConfig(config)
  const admitted = new WeakSet<ToolExecution>()

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const permissionClass = CLASS_BY_TOOL[exec.name]
    if (permissionClass === undefined) return next()
    const decision = resolved[permissionClass]
    if (decision === 'deny') return { kind: 'deny', reason: DENY_REASONS[permissionClass] }
    admitted.add(exec)
    if (decision === 'ask') return { kind: 'ask', reason: ASK_REASONS[permissionClass] }
    return next()
  })

  ctx.tools.guard((exec) => {
    const permissionClass = CLASS_BY_TOOL[exec.name]
    if (permissionClass === undefined) return undefined
    if (resolved[permissionClass] === 'allow') return undefined
    return admitted.delete(exec)
      ? undefined
      : resolved[permissionClass] === 'ask'
        ? ASK_REASONS[permissionClass]
        : DENY_REASONS[permissionClass]
  })
}
