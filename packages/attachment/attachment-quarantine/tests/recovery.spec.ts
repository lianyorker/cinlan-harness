import { describe, expect, it, vi } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { AttachmentId, AttachmentStore, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import {
  attachmentQuarantineProjection,
  attachmentRecoveredProjection,
} from '../src/projection.ts'
import { isAttachmentQuarantined } from '../src/quarantine.ts'
import { recoverAttachment } from '../src/recovery.ts'

const projections = [attachmentQuarantineProjection, attachmentRecoveredProjection]

function createSession(...args: Parameters<typeof Session.create>): Session {
  args[4] = projections
  return Session.create(...args)
}

const idA = `sha256:${'a'.repeat(64)}` as AttachmentId
const idB = `sha256:${'b'.repeat(64)}` as AttachmentId

const imageA: ImageBlock = {
  type: 'image',
  attachment: { attachmentId: idA, name: 'first.png', mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
}

function userMessage(session: Session, content: ContentBlock[]) {
  return session.append(
    'user/message',
    createUserMessage({ content, source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

describe('explicit attachment recovery', () => {
  it('recovers quarantined attachment after verified read and appends attachment/recovered', async () => {
    const session = createSession(SessionId('s-rec-1'))
    userMessage(session, [imageA])
    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'not_found',
    })
    expect(isAttachmentQuarantined(session, idA)).toBe(true)

    const storedAttachment: StoredImageAttachment = {
      ref: imageA.attachment,
      data: new Uint8Array(100),
    }

    const readImageMock = vi.fn(async () => storedAttachment)
    const attachments = {
      readImage: readImageMock,
    } as unknown as AttachmentStore

    const result = await recoverAttachment(session, attachments, idA)
    expect(result).toBe(storedAttachment)
    expect(readImageMock).toHaveBeenCalledTimes(1)
    expect(readImageMock).toHaveBeenCalledWith(imageA.attachment, undefined)

    // isAttachmentQuarantined is now false
    expect(isAttachmentQuarantined(session, idA)).toBe(false)

    // Replay projection restores the image block
    const messages = session.deriveMessages()
    expect(messages[0]?.content[0]).toEqual(imageA)

    // Last session event is attachment/recovered
    const lastEvent = session.snapshotEvents().at(-1)
    expect(lastEvent?.type).toBe('attachment/recovered')
    expect(lastEvent?.data).toEqual({ attachmentId: idA })
  })

  it('rejects with INVALID_ATTACHMENT_REF when attachment is not currently quarantined', async () => {
    const session = createSession(SessionId('s-rec-not-quarantined'))
    userMessage(session, [imageA])

    const attachments = {
      readImage: vi.fn(),
    } as unknown as AttachmentStore

    await expect(recoverAttachment(session, attachments, idA)).rejects.toMatchObject({
      code: 'INVALID_ATTACHMENT_REF',
    })
    expect(attachments.readImage).not.toHaveBeenCalled()
  })

  it('rejects with ATTACHMENT_NOT_FOUND when quarantined id is not in session history', async () => {
    const session = createSession(SessionId('s-rec-not-in-history'))
    // Append quarantine for an attachment that was never in a message
    session.append('attachment/quarantine', {
      attachmentId: idB,
      failureClass: 'not_found',
    })

    const attachments = {
      readImage: vi.fn(),
    } as unknown as AttachmentStore

    await expect(recoverAttachment(session, attachments, idB)).rejects.toMatchObject({
      code: 'ATTACHMENT_NOT_FOUND',
    })
    expect(attachments.readImage).not.toHaveBeenCalled()
  })

  it('does not append attachment/recovered if storage verification fails', async () => {
    const session = createSession(SessionId('s-rec-store-fail'))
    userMessage(session, [imageA])
    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'corrupt',
    })

    const attachments = {
      readImage: vi.fn(async () => {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }),
    } as unknown as AttachmentStore

    await expect(recoverAttachment(session, attachments, idA)).rejects.toMatchObject({
      code: 'ATTACHMENT_CORRUPT',
    })

    // Still quarantined
    expect(isAttachmentQuarantined(session, idA)).toBe(true)

    // No recovered event appended
    const eventTypes = session.snapshotEvents().map(e => e.type)
    expect(eventTypes).not.toContain('attachment/recovered')
  })

  it('honors cancellation via AbortSignal', async () => {
    const session = createSession(SessionId('s-rec-abort'))
    userMessage(session, [imageA])
    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'read_failed',
    })

    const controller = new AbortController()
    controller.abort(new Error('user cancelled'))

    const attachments = {
      readImage: vi.fn(),
    } as unknown as AttachmentStore

    await expect(recoverAttachment(session, attachments, idA, controller.signal)).rejects.toThrow('user cancelled')
    expect(attachments.readImage).not.toHaveBeenCalled()
    expect(isAttachmentQuarantined(session, idA)).toBe(true)
  })
})
