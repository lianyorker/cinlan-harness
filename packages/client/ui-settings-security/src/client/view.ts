/** Product-facing capability status derived from the Host Loader inventory. */
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'

/** One raw Host Loader inventory entry. */
export type InventoryEntry = PluginInventorySnapshot['entries'][number]

/** Aggregate runtime status of one capability. */
export type CapabilityStatus = 'ready' | 'loading' | 'attention' | 'missing'

/** One Host component displayed by a capability page. */
export interface CapabilityComponent {
  readonly moduleName: string
  readonly entries: readonly InventoryEntry[]
  readonly status: Exclude<CapabilityStatus, 'missing'>
}

function componentStatus(entries: readonly InventoryEntry[]): Exclude<CapabilityStatus, 'missing'> {
  if (entries.some(entry => entry.fiberPhase === 'failed')) return 'attention'
  if (entries.every(entry => entry.fiberPhase === 'active')) return 'ready'
  return 'loading'
}

/** Group matching Host inventory entries by exact module specifier.
 * @param entries - current Host inventory, including disabled declarations.
 * @param matcher - module specifiers belonging to this capability.
 * @returns enabled components with status derived from their live entries.
 */
export function capabilityComponents(
  entries: readonly InventoryEntry[],
  matcher: RegExp,
): readonly CapabilityComponent[] {
  const grouped = new Map<string, InventoryEntry[]>()
  for (const entry of entries) {
    if (!entry.enabled || !matcher.test(entry.moduleName)) continue
    const current = grouped.get(entry.moduleName)
    if (current === undefined) grouped.set(entry.moduleName, [entry])
    else current.push(entry)
  }
  return [...grouped].map(([moduleName, componentEntries]) => ({
    moduleName,
    entries: componentEntries,
    status: componentStatus(componentEntries),
  }))
}

/** Derive one page-level status, giving failures precedence.
 * @param components - enabled components of the capability.
 * @returns the combined availability state, with missing for an empty list.
 */
export function capabilityStatus(components: readonly CapabilityComponent[]): CapabilityStatus {
  if (components.length === 0) return 'missing'
  if (components.some(component => component.status === 'attention')) return 'attention'
  if (components.every(component => component.status === 'ready')) return 'ready'
  return 'loading'
}
