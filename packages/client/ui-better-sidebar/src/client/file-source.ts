/** File preview identity and retained reader scope in persisted sidebar tabs. */
import type { SessionScope } from './api.ts'
import type { SidebarTab } from './state.ts'

/**
 * Read the source Session retained by a file opened from another Conversation.
 * @param tab - Persisted file tab; absent source metadata uses its layout's Session.
 * @returns The source scope, or undefined for a layout-local file.
 * @throws When saved source metadata is malformed; it must never select another Session's reader.
 */
export function fileSourceScope(tab: SidebarTab): SessionScope | undefined {
  if (tab.meta === null || typeof tab.meta !== 'object' || !('fileSource' in tab.meta)) return undefined
  const source = tab.meta.fileSource
  if (source === null || typeof source !== 'object'
    || !('sessionId' in source) || typeof source.sessionId !== 'string' || source.sessionId === ''
    || ('cwd' in source && source.cwd !== undefined && typeof source.cwd !== 'string')) {
    throw new Error('Invalid saved file source Session')
  }
  return { sessionId: source.sessionId, ...('cwd' in source && typeof source.cwd === 'string' ? { cwd: source.cwd } : {}) }
}

/**
 * Distinguish file tabs with the same path but different Session readers.
 * @param tab - File tab with optional persisted source metadata.
 * @returns Its source/path key, or undefined for a path-less Files window.
 */
export function editorFileKey(tab: SidebarTab): string | undefined {
  if (tab.path === undefined) return undefined
  const source = fileSourceScope(tab)
  return JSON.stringify([source?.sessionId ?? null, tab.path])
}
