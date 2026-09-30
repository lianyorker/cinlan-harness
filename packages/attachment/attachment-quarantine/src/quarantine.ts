/**
 * Quarantine state checks and pre-dispatch preparation helpers.
 * @module @deepseek-ai/dsh-attachment-quarantine/quarantine
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { Message } from '@deepseek-ai/dsh-llm'

/**
 * Whether one attachment id is currently quarantined in session history.
 * @param session - session or event snapshot container.
 * @param attachmentId - attachment id to check.
 * @returns true if quarantined without subsequent recovery.
 */
export function isAttachmentQuarantined(
  session: { snapshotEvents(): readonly { type: string; data?: unknown }[] },
  attachmentId: unknown,
): boolean {
  for (const event of session.snapshotEvents().slice().reverse()) {
    if (event.type === 'attachment/recovered' && (event.data as { attachmentId?: unknown })?.attachmentId === attachmentId) {
      return false
    }
    if (event.type === 'attachment/quarantine' && (event.data as { attachmentId?: unknown })?.attachmentId === attachmentId) {
      return true
    }
  }
  return false
}

/**
 * Collect all unique non-offloaded image attachment references across messages.
 * @param messages - messages to inspect.
 * @returns unique non-offloaded image attachment references.
 */
export function collectRetainedImageRefs(messages: readonly Message[]): ImageAttachmentRef[] {
  const byId = new Map<string, ImageAttachmentRef>()
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'image' && (block as { offloaded?: boolean }).offloaded !== true) {
        byId.set(String(block.attachment.attachmentId), block.attachment)
      }
    }
  }
  return [...byId.values()]
}
