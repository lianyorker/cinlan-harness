/** Configurable permission Consumer for desktop Computer Use tools. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'computer-use-permission-policy'

/** Tool pipeline service required for decisions and monotonic enforcement. */
export const inject = ['tools']

/** One configured permission decision. */
export type ComputerUsePermissionDecision = 'allow' | 'ask' | 'deny'

/** Independent observation and action-class policy. */
export interface Config {
  /** App/window/tree observation policy. Defaults to `ask`. */
  readonly observe?: ComputerUsePermissionDecision
  /** Click, scroll, and drag policy. Defaults to `ask`. */
  readonly pointer?: ComputerUsePermissionDecision
  /** Text, paste, key, and hotkey policy. Defaults to `ask`. */
  readonly keyboard?: ComputerUsePermissionDecision
  /** Secondary-action and set-value policy. Defaults to `ask`. */
  readonly accessibilityAction?: ComputerUsePermissionDecision
}

interface ResolvedConfig {
  readonly observe: ComputerUsePermissionDecision
  readonly pointer: ComputerUsePermissionDecision
  readonly keyboard: ComputerUsePermissionDecision
  readonly accessibilityAction: ComputerUsePermissionDecision
}

type PermissionClass = keyof ResolvedConfig

const CONFIG_KEYS = new Set(['observe', 'pointer', 'keyboard', 'accessibilityAction'])
const DECISIONS = new Set<ComputerUsePermissionDecision>(['allow', 'ask', 'deny'])

/** Approval prompt for desktop observation. */
export const COMPUTER_OBSERVE_APPROVAL_REASON = 'Allow this call to observe local desktop applications or window content?'
/** Approval prompt for pointer input. */
export const COMPUTER_POINTER_APPROVAL_REASON = 'Allow this call to click, scroll, or drag in a local desktop application?'
/** Approval prompt for keyboard or clipboard input. */
export const COMPUTER_KEYBOARD_APPROVAL_REASON = 'Allow this call to send keyboard or clipboard input to a local desktop application?'
/** Approval prompt for accessibility mutations. */
export const COMPUTER_ACCESSIBILITY_APPROVAL_REASON = 'Allow this call to perform an accessibility action or set a desktop element value?'

const ASK_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: COMPUTER_OBSERVE_APPROVAL_REASON,
  pointer: COMPUTER_POINTER_APPROVAL_REASON,
  keyboard: COMPUTER_KEYBOARD_APPROVAL_REASON,
  accessibilityAction: COMPUTER_ACCESSIBILITY_APPROVAL_REASON,
}

const DENY_REASONS: Readonly<Record<PermissionClass, string>> = {
  observe: 'Desktop observation is denied by policy.',
  pointer: 'Desktop pointer input is denied by policy.',
  keyboard: 'Desktop keyboard or clipboard input is denied by policy.',
  accessibilityAction: 'Desktop accessibility mutation is denied by policy.',
}

const CLASS_BY_TOOL: Readonly<Record<string, PermissionClass>> = {
  computer_list_apps: 'observe',
  computer_list_windows: 'observe',
  computer_observe: 'observe',
  computer_pointer: 'pointer',
  computer_keyboard: 'keyboard',
  computer_accessibility: 'accessibilityAction',
}

/** Loader schema for the four independent permission classes. */
export const Config: z<Config> = z.object({
  observe: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  pointer: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  keyboard: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
  accessibilityAction: z.union(['allow', 'ask', 'deny'] as const).default('ask'),
})

/**
 * Validate and default Computer Use permission configuration.
 * @param config Partial permission decisions.
 * @returns Complete validated permission decisions.
 */
export function resolveComputerUsePermissionConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`computer-use-permission-policy: unsupported config key '${key}'`)
  }
  const resolved: ResolvedConfig = {
    observe: config.observe ?? 'ask',
    pointer: config.pointer ?? 'ask',
    keyboard: config.keyboard ?? 'ask',
    accessibilityAction: config.accessibilityAction ?? 'ask',
  }
  for (const key of ['observe', 'pointer', 'keyboard', 'accessibilityAction'] as const) {
    if (!DECISIONS.has(resolved[key])) {
      throw new Error(`computer-use-permission-policy: ${key} must be "allow", "ask", or "deny"`)
    }
  }
  return resolved
}

/** Install permission decisions and the matching monotonic execution guard. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveComputerUsePermissionConfig(config)
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
