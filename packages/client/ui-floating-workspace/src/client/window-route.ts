/** Same-artifact app-window URL; launch credentials and arbitrary query parameters never travel. */

import type { FloatingWorkspaceWindowId } from '@deepseek-ai/dsh-sidebar-terminals/types'

/** Nonsecret identity of the opener-owned floating app renderer. */
export interface FloatingRoute {
  readonly owner: FloatingWorkspaceWindowId
  readonly session?: string
}

const OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const KEYS = new Set(['dsh-floating-workspace', 'dsh-floating-owner', 'dsh-floating-session'])

/**
 * Read only the exact feature route, never an arbitrary window target.
 * @param url - current app URL.
 * @returns validated nonsecret target fields, or undefined for another/invalid route.
 */
export function floatingRoute(url: URL): FloatingRoute | undefined {
  if (url.username !== '' || url.password !== '' || url.hash !== '' || !['http:', 'https:', 'dsh-app:'].includes(url.protocol)) return undefined
  if (url.protocol === 'dsh-app:' && (url.hostname !== 'app' || url.port !== '' || url.pathname !== '/index.html')) return undefined
  if (url.searchParams.get('dsh-floating-workspace') !== '1') return undefined
  for (const key of url.searchParams.keys()) {
    if (!KEYS.has(key) || url.searchParams.getAll(key).length !== 1) return undefined
  }
  const owner = url.searchParams.get('dsh-floating-owner')
  const session = url.searchParams.get('dsh-floating-session')
  if (owner === null || !OWNER.test(owner)) return undefined
  if (session !== null && (session.length === 0 || session.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(session))) return undefined
  return { owner: owner as FloatingWorkspaceWindowId, ...(session === null ? {} : { session }) }
}

/**
 * Build a new same-origin app URL from only approved nonsecret parameters.
 * @param current - current supported app location, possibly carrying login query data.
 * @param owner - unique id for this plugin activation's window.
 * @param session - optional already-listed initial Session.
 * @returns same app path with only the floating route parameters.
 */
export function floatingUrl(current: URL, owner: string, session?: string): URL {
  const target = new URL(current.href)
  target.username = ''; target.password = ''; target.search = ''; target.hash = ''
  target.searchParams.set('dsh-floating-workspace', '1')
  target.searchParams.set('dsh-floating-owner', owner)
  if (session !== undefined) target.searchParams.set('dsh-floating-session', session)
  return target
}
