/**
 * Explicit attachment recovery API.
 * @module @deepseek-ai/dsh-attachment-quarantine/recovery
 */

import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentId, AttachmentStore, ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { isAttachmentQuarantined } from './quarantine.ts'

function findRef(blocks: readonly ContentBlock[], targetId: AttachmentId): ImageAttachmentRef | undefined {
  for (const block of blocks) {
    if (block.type === 'image' && block.attachment.attachmentId === targetId) return block.attachment
  }
  return undefined
}

function findAttachmentRefInSession(session: Session, attachmentId: AttachmentId): ImageAttachmentRef | undefined {
  for (const event of session.snapshotEvents()) {
    if (event.type === 'user/message') {
      const found = findRef((event.data as Message).content, attachmentId)
      if (found !== undefined) return found
    } else if (event.type === 'tool/result') {
      const found = findRef((event.data as { message: Message }).message.content, attachmentId)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * Explicitly verify and recover one quarantined image attachment in a session.
 * Verification reads the object and checks digest and metadata. Only upon verified success
 * is `attachment/recovered` appended to the session log, restoring image projection.
 *
 * @param session - live session owning the quarantined reference.
 * @param attachments - mounted attachment store.
 * @param attachmentId - identity of the attachment to recover.
 * @param signal - optional cancellation.
 * @returns the verified stored image attachment.
 * @throws an AttachmentError if the object is missing, corrupt, unreadable, or unquarantined.
 */
export async function recoverAttachment(
  session: Session,
  attachments: AttachmentStore,
  attachmentId: AttachmentId,
  signal?: AbortSignal,
): Promise<StoredImageAttachment> {
  signal?.throwIfAborted()
  if (!isAttachmentQuarantined(session, attachmentId)) {
    throw new AttachmentError(
      `Attachment "${attachmentId}" is not currently quarantined.`,
      'INVALID_ATTACHMENT_REF',
    )
  }
  const ref = findAttachmentRefInSession(session, attachmentId)
  if (ref === undefined) {
    throw new AttachmentError(
      `Attachment "${attachmentId}" was not found in session history.`,
      'ATTACHMENT_NOT_FOUND',
    )
  }
  const stored = await attachments.readImage(ref, signal)
  signal?.throwIfAborted()
  session.append('attachment/recovered', { attachmentId })
  return stored
}
