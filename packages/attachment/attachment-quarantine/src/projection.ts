/**
 * Session message projections for attachment quarantine and recovery.
 * @module @deepseek-ai/dsh-attachment-quarantine/projection
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { quarantinedImageText } from '@deepseek-ai/dsh-llm'
import type { AttachmentId, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionMessageProjection, SessionMessageProjectionContext } from '@deepseek-ai/dsh-session/surface'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { AttachmentQuarantineEventData } from './types.ts'

export { quarantinedImageText } from '@deepseek-ai/dsh-llm'
export type { AttachmentQuarantineEventData, AttachmentQuarantineFailureClass, AttachmentRecoveredEventData } from './types.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function replaceInBlocks(
  blocks: readonly ContentBlock[],
  targetId: AttachmentId,
  makePlaceholder: (ref: ImageAttachmentRef) => string,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    let projected: ContentBlock = block
    if (block.type === 'image' && block.attachment.attachmentId === targetId) {
      projected = { type: 'text', text: makePlaceholder(block.attachment) }
    } else if (block.type === 'tool-result') {
      const content = replaceInBlocks(block.content, targetId, makePlaceholder)
      if (content !== block.content) {
        projected = { ...block, content }
      }
    }
    if (projected !== block) {
      next ??= blocks.slice(0, index)
    }
    next?.push(projected)
  }
  return next ?? blocks as ContentBlock[]
}

function restoreBlocks(
  currentBlocks: readonly ContentBlock[],
  originalBlocks: readonly ContentBlock[],
  targetId: AttachmentId,
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (let i = 0; i < currentBlocks.length; i++) {
    const curr = currentBlocks[i]
    if (curr === undefined) continue
    const orig = originalBlocks[i]
    let restored: ContentBlock = curr
    if (orig !== undefined && orig.type === 'image' && orig.attachment.attachmentId === targetId) {
      if (curr.type === 'text') {
        restored = orig
      }
    } else if (curr.type === 'tool-result' && orig !== undefined && orig.type === 'tool-result') {
      const content = restoreBlocks(curr.content, orig.content, targetId)
      if (content !== curr.content) {
        restored = { ...curr, content }
      }
    }
    if (restored !== curr) {
      next ??= currentBlocks.slice(0, i)
    }
    next?.push(restored)
  }
  return next ?? currentBlocks as ContentBlock[]
}

function originalMessageOf(context: SessionMessageProjectionContext, seq: SessionSeq): Message {
  const source = context.events[seq - context.baseSeq]
  if (source === undefined) throw new Error(`attachment projection: missing source event at seq ${seq}`)
  if (source.type === 'user/message') return source.data as Message
  if (source.type === 'tool/result') return (source.data as { message: Message }).message
  if (source.type === 'system/message') return (source.data as { message: Message }).message
  if (source.type === 'assistant/message') return (source.data as { message: Message }).message
  throw new Error(`attachment projection: unsupported surface event type "${source.type}"`)
}

/** Pure session projection that replaces quarantined images with deterministic text placeholders. */
export const attachmentQuarantineProjection: SessionMessageProjection<'attachment/quarantine'> = {
  type: 'attachment/quarantine',
  project(event: SessionEvent<'attachment/quarantine'>, context: SessionMessageProjectionContext) {
    const data = event.data
    if (!isRecord(data) || typeof data['attachmentId'] !== 'string' || typeof data['failureClass'] !== 'string') {
      throw new Error('attachment/quarantine: data must contain attachmentId and failureClass')
    }
    const targetId = data['attachmentId'] as AttachmentId
    const failureClass = data['failureClass'] as AttachmentQuarantineEventData['failureClass']
    const messages = new Map<SessionSeq, Message>()

    for (const seq of context.nodes) {
      const current = context.messages.get(seq) ?? originalMessageOf(context, seq)
      const replaced = replaceInBlocks(
        current.content,
        targetId,
        ref => quarantinedImageText(ref, failureClass),
      )
      if (replaced !== current.content) {
        messages.set(seq, deepFreeze({ ...current, content: replaced }))
      }
    }
    return messages
  },
}

/** Pure session projection that restores previously quarantined images from original history. */
export const attachmentRecoveredProjection: SessionMessageProjection<'attachment/recovered'> = {
  type: 'attachment/recovered',
  project(event: SessionEvent<'attachment/recovered'>, context: SessionMessageProjectionContext) {
    const data = event.data
    if (!isRecord(data) || typeof data['attachmentId'] !== 'string') {
      throw new Error('attachment/recovered: data must contain attachmentId')
    }
    const targetId = data['attachmentId'] as AttachmentId
    const messages = new Map<SessionSeq, Message>()

    for (const seq of context.nodes) {
      const current = context.messages.get(seq) ?? originalMessageOf(context, seq)
      const original = originalMessageOf(context, seq)
      const restored = restoreBlocks(current.content, original.content, targetId)
      if (restored !== current.content) {
        messages.set(seq, deepFreeze({ ...current, content: restored }))
      }
    }
    return messages
  },
}
