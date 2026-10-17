/** Resolve the Session held by the main conversation view. */
import type { SidebarSessionList } from '../context-types.ts'

/**
 * Read main-view ownership from the Session catalog.
 * @param snapshot - Catalog with local reference-source counts.
 * @returns The retained main Session, or undefined when no conversation is selected.
 */
export function mainSessionId(snapshot: SidebarSessionList): string | undefined {
  return Object.entries(snapshot.byId).find(([, summary]) => (summary.retainedBy?.mainView ?? 0) > 0)?.[0]
}
