/** Per-tab shell launch metadata shares the sidebar's existing layout persistence. */
import { allLeaves, patchTab, type SidebarStore, type SidebarTab } from './state.ts'

/** A new tab awaits selection; saved running tabs reconnect directly. */
export interface TerminalLaunch {
  readonly pending: boolean
  readonly shellPath?: string
}

/** @param tab - persisted sidebar tab. @returns validated launch fields, or the default for an existing tab. */
export function terminalLaunchOf(tab: SidebarTab): TerminalLaunch {
  const meta = tab.meta
  if (meta === null || typeof meta !== 'object' || !('terminalLaunch' in meta)) return { pending: false }
  const launch = meta.terminalLaunch
  if (launch === null || typeof launch !== 'object') return { pending: false }
  return {
    pending: 'pending' in launch && launch.pending === true,
    ...('shellPath' in launch && typeof launch.shellPath === 'string' && launch.shellPath !== '' ? { shellPath: launch.shellPath } : {}),
  }
}

/**
 * Remember a successful launch choice without changing floating directory metadata or Settings.
 * @param store - existing sidebar layout owner.
 * @param sessionId - Session that owns the tab.
 * @param tabId - tab receiving the choice.
 * @param launch - selected path; omission keeps the Settings default.
 * @param title - shell label from the Host opening frame.
 */
export function rememberTerminalLaunch(
  store: SidebarStore, sessionId: string, tabId: string, launch: TerminalLaunch, title?: string,
): void {
  if (store.getSnapshot().sessionId !== sessionId) return
  store.reduce((state) => {
    const tab = [...allLeaves(state.splits), ...allLeaves(state.bottomSplits)].flatMap(leaf => leaf.tabs).find(tab => tab.id === tabId)
    if (tab === undefined) return state
    const meta = tab.meta !== null && typeof tab.meta === 'object' ? tab.meta : {}
    return patchTab(state, tabId, { ...title === undefined ? {} : { title }, meta: { ...meta, terminalLaunch: launch } })
  })
}
