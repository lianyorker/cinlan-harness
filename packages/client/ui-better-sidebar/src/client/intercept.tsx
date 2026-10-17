/** File opens delegate to the sidebar editor while its preferences permit interception. */
import type { Context } from '../context-types.ts'
import type { SidebarStore } from './state.ts'
import { resolveSidebarPath } from './produced-files.ts'
import { wrapOpenPath } from './openpath-intercept.ts'
import { mainSessionId } from './main-session.ts'

/** Open a file in the sidebar's editor from the explorer or a file-open request. */
export function openSidebarFile(ctx: Context, store: SidebarStore, sessionId: string, path: string): void {
  const byId = ctx.sessions.list.getSnapshot().byId
  const summary = byId[sessionId as keyof typeof byId]
  const absolute = resolveSidebarPath(summary?.cwd, path)
  const at = Math.max(absolute.lastIndexOf('/'), absolute.lastIndexOf('\\'))
  const title = at === -1 ? absolute : absolute.slice(at + 1)
  // Route through the sidebar service so the editor descriptor's dedupeKey
  // (per-path) applies; the id is path-derived so multiple editors coexist.
  ctx.betterSidebar?.openTab({ type: 'editor', title, path: absolute, id: `editor:${absolute}` })
}

/**
 * Register the chat file-open interception: wraps `ctx.workspaces.openPath`
 * — the single funnel every chat-side file open goes through (tool-row path
 * links, the produced-files row, prose mentions) — so opens land in the
 * sidebar editor instead of the Host OS. Gated by BOTH the `interceptOpenPath`
 * pref and the editor tab's enable switch; declined opens fall through to
 * the original method. Returns the disposer restoring the original (HMR-safe).
 */
export function registerOpenPathInterception(ctx: Context, store: SidebarStore): () => void {
  return wrapOpenPath(ctx.workspaces, {
    takeoverEnabled: () => !store.getSuspended()
      && store.getPrefs().interceptOpenPath !== false
      && store.getPrefs().tabsEnabled['editor'] !== false,
    currentSessionId: () => mainSessionId(ctx.sessions.list.getSnapshot()),
    openInSidebar: (path, sessionId) => { openSidebarFile(ctx, store, sessionId, path) },
  })
}
