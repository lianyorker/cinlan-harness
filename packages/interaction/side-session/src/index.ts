/**
 * Interactive side sessions and merge-back mechanics.
 *
 * @module @deepseek-ai/dsh-side-session
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'

export const SIDECHAT_PLUGIN_ID = 'sidechat'

/**
 * Identify the balanced completed-turn prefix of a parent session.
 * Open turns and trailing step activity are excluded so the seed is contiguous
 * and closed.
 * @param events - the parent session's full event log.
 * @returns the contiguous sequence of events ending outside any open turn.
 */
export function balancedCompletedTurnPrefix(events: readonly SessionEvent[]): SessionEvent[] {
  let lastValidBoundary = -1
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event !== undefined && event.type === 'turn/end') {
      lastValidBoundary = i
      break
    }
  }
  if (lastValidBoundary < 0) return []
  return events.slice(0, lastValidBoundary + 1)
}

export interface SideSessionMessageSource {
  readonly kind: 'side-session'
  readonly plugin: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'side-session': SideSessionMessageSource
  }
}

/**
 * Frame an advisor or critique side session with a guiding non-system-prompt
 * context message. This prevents changing the system prompt and invalidating
 * the provider prefix cache.
 * @param child - the newly created side session agent.
 * @param explanation - optional framing text.
 */
export function frameAdvisor(child: Agent, explanation?: string): void {
  const text = explanation ?? 'This is a side conversation. Explain or analyze the preceding context without mutating or continuing the parent task.'
  child.inject(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'side-session', plugin: SIDECHAT_PLUGIN_ID },
  }))
}

/**
 * Merge a condensed note from a side session back into its parent session.
 * Injects one plugin-sourced user message into the parent. The next parent
 * request sees it at its logged position, preserving replay and reconstructability.
 * @param parent - the parent agent to merge back into.
 * @param sourceSessionId - the id of the side session producing the note.
 * @param note - the condensed text to merge back.
 */
export function mergeSideSessionBack(parent: Agent, sourceSessionId: SessionId, note: string): void {
  // Cap the length to prevent consuming parent context unbounded.
  const MAX_MERGE_LENGTH = 4000
  const text = note.length > MAX_MERGE_LENGTH
    ? note.slice(0, MAX_MERGE_LENGTH) + '…\n\n(Note truncated)'
    : note

  parent.inject(createUserMessage({
    content: [{ type: 'text', text: `Side session ${sourceSessionId} conclusion:\n\n${text}` }],
    source: { kind: 'side-session', plugin: SIDECHAT_PLUGIN_ID },
  }))
}
