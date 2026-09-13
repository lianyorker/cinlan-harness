/** Permission policy for model-facing Mobile Device tools. @module @deepseek-ai/dsh-mobile-device-permission-policy */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'mobile-device-permission-policy'

/** Tool pipeline service required for decisions and monotonic enforcement. */
export const inject = ['tools']

/** One configured Mobile Device permission decision. */
export type MobileDevicePermissionDecision = 'allow' | 'ask' | 'deny'

/** Independent observation and mutation policy. */
export interface Config {
  /** Device discovery and observation policy. Defaults to `ask`. */
  readonly observe?: MobileDevicePermissionDecision
  /** Tap and swipe policy. Defaults to `ask`. */
  readonly touch?: MobileDevicePermissionDecision
  /** Literal text-input policy. Defaults to `ask`. */
  readonly textInput?: MobileDevicePermissionDecision
  /** Device navigation-button policy. Defaults to `ask`. */
  readonly deviceNavigation?: MobileDevicePermissionDecision
}

interface ResolvedConfig {
  readonly observe: MobileDevicePermissionDecision
  readonly touch: MobileDevicePermissionDecision
  readonly textInput: MobileDevicePermissionDecision
  readonly deviceNavigation: MobileDevicePermissionDecision
}

type PermissionClass = keyof ResolvedConfig

const CONFIG_KEYS = new Set(['observe', 'touch', 'textInput', 'deviceNavigation'])
const DECISIONS = new Set<MobileDevicePermissionDecision>(['allow', 'ask', 'deny'])

/** Approval prompt for mobile-device discovery and observation. */
export const MOBILE_OBSERVE_APPROVAL_REASON = 'Allow this call to list or observe local mobile devices?'
/** Approval prompt for normalized tap and swipe input. */
export const MOBILE_TOUCH_APPROVAL_REASON = 'Allow this call to tap or swipe on a local mobile device?'
/** Approval prompt for literal mobile text input. */
export const MOBILE_TEXT_INPUT_APPROVAL_REASON = 'Allow this call to type text into a local mobile device?'
/** Approval prompt for mobile device navigation buttons. */
export const MOBILE_DEVICE_NAVIGATION_APPROVAL_REASON = 'Allow this call to press a navigation button on a local mobile device?'

const ASK_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: MOBILE_OBSERVE_APPROVAL_REASON,
  touch: MOBILE_TOUCH_APPROVAL_REASON,
  textInput: MOBILE_TEXT_INPUT_APPROVAL_REASON,
  deviceNavigation: MOBILE_DEVICE_NAVIGATION_APPROVAL_REASON,
}

const DENY_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: 'Mobile device observation is denied by policy.',
  touch: 'Mobile device touch input is denied by policy.',
  textInput: 'Mobile device text input is denied by policy.',
  deviceNavigation: 'Mobile device navigation is denied by policy.',
}

const CLASS_BY_TOOL: Readonly<Record<string, PermissionClass>> = {
  mobile_list_devices: 'observe',
  mobile_observe: 'observe',
  mobile_touch: 'touch',
  mobile_type: 'textInput',
  mobile_button: 'deviceNavigation',
}

/** Loader schema for the four independent permission classes. */
export const Config: z<Config> = z.object({
  observe: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  touch: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  textInput: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  deviceNavigation: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
})

/**
 * Validate and default Mobile Device permission configuration.
 * @param config Partial permission decisions.
 * @returns Complete validated permission decisions.
 */
export function resolveMobileDevicePermissionConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`mobile-device-permission-policy: unsupported config key '${key}'`)
  }
  const resolved: ResolvedConfig = {
    observe: config.observe ?? 'ask',
    touch: config.touch ?? 'ask',
    textInput: config.textInput ?? 'ask',
    deviceNavigation: config.deviceNavigation ?? 'ask',
  }
  for (const key of ['observe', 'touch', 'textInput', 'deviceNavigation'] as const) {
    if (!DECISIONS.has(resolved[key])) {
      throw new Error(`mobile-device-permission-policy: ${key} must be "allow", "ask", or "deny"`)
    }
  }
  return resolved
}

/** Install permission decisions and the matching monotonic execution guard. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveMobileDevicePermissionConfig(config)
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
