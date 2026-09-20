/** Durable tab addresses for existing child conversations. */
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SidebarSubagentAddress } from '../context-types.ts'
import type { OpenTabSeed } from './service.ts'

/** Hidden tab type used by both catalog and topology navigation. */
export const SUBAGENT_CHAT_TYPE = 'subagentchat'

/**
 * Encode the direct-parent routing facts needed after restoring a tab.
 * @param address - Child address supplied by the durable catalog.
 * @returns Canonical resource URL.
 */
export function subagentChatAddress(address: SidebarSubagentAddress): string {
  const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode })
  return 'dsh-resource://subagentchat/session/' + encodeURIComponent(address.childSessionId) + '?' + query.toString()
}

/**
 * Decode a persisted tab address without trusting stored JSON.
 * @param value - Possible resource URL.
 * @returns Valid child address, or undefined for another or malformed resource.
 */
export function parseSubagentChatAddress(value: string): SubagentAddress | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch (_invalidUrl) {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'subagentchat') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session') return undefined
  const parent = url.searchParams.get('parent')
  const mode = url.searchParams.get('mode')
  if (!parent || (mode !== 'one-shot' && mode !== 'continuable')) return undefined
  try {
    const child = decodeURIComponent(parts[1] as string)
    if (!child) return undefined
    return { parentSessionId: parent as SessionId, childSessionId: child as SessionId, mode }
  } catch (_invalidEncoding) {
    return undefined
  }
}

/**
 * Create a stable tab seed so repeat opens select its existing split.
 * @param address - Catalog child address.
 * @returns Existing sidebar API tab seed.
 */
export function subagentChatTab(address: SidebarSubagentAddress): OpenTabSeed {
  const path = subagentChatAddress(address)
  return { type: SUBAGENT_CHAT_TYPE, id: path, path, title: address.childSessionId }
}
