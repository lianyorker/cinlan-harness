import { describe, expect, it } from 'vitest'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageBlock, TextBlock } from '@deepseek-ai/dsh-llm'
import { deriveEventMessage, foldSurface, Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  attachmentQuarantineProjection,
  attachmentRecoveredProjection,
  quarantinedImageText,
} from '../src/projection.ts'

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

const imageB: ImageBlock = {
  type: 'image',
  attachment: { attachmentId: idB, name: 'second.png', mediaType: 'image/png', bytes: 200, width: 20, height: 20 },
}

function userMessage(session: Session, content: ContentBlock[]) {
  return session.append(
    'user/message',
    createUserMessage({ content, source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
}

describe('attachment quarantine and recovery message projections', () => {
  it('replaces target quarantined image with deterministic placeholder text while preserving original events', () => {
    const session = createSession(SessionId('s-quarantine-basic'))
    const source = userMessage(session, [
      { type: 'text', text: 'prompt before' },
      imageA,
      imageB,
    ])

    const before = session.deriveMessages()
    expect(before[0]?.content[1]).toEqual(imageA)
    expect(before[0]?.content[2]).toEqual(imageB)

    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'not_found',
    })

    const after = session.deriveMessages()
    expect(after[0]?.id).toBe(before[0]?.id)
    expect(after[0]).toBe(session.deriveEventMessage(source))
    expect(Object.isFrozen(after[0])).toBe(true)

    const expectedPlaceholder = quarantinedImageText(imageA.attachment, 'not_found')
    expect(expectedPlaceholder).toBe(`[image quarantined: not_found; "first.png" (${idA.slice(0, 15)})]`)

    const block1 = after[0]?.content[1] as TextBlock
    expect(block1.type).toBe('text')
    expect(block1.text).toBe(expectedPlaceholder)

    // Other image remains untouched
    expect(after[0]?.content[2]).toEqual(imageB)

    // Original event payload in append-only history is unchanged
    const sourceInHistory = session.snapshotEvents().find(e => e.seq === source.seq)
    expect(JSON.stringify(sourceInHistory)).not.toContain('quarantined')
    expect(JSON.stringify(sourceInHistory)).toContain('first.png')
  })

  it('replaces multiple occurrences including nested tool-result blocks', () => {
    const session = createSession(SessionId('s-nested'))
    const toolCallId = ToolCallId('tool-call-1')
    const source = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({
        callId: toolCallId,
        isError: false,
        content: [
          { type: 'text', text: 'result text' },
          imageA,
          { type: 'text', text: 'more text' },
        ],
      }),
    }, { surfaceOp: 'append' })

    const userSource = userMessage(session, [imageA, imageB, imageA])

    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'corrupt',
    })

    const derivedTool = session.deriveEventMessage(source)
    expect(derivedTool).toBeDefined()
    expect(derivedTool?.role).toBe('user')

    const nested = (derivedTool?.content[0] as { content: ContentBlock[] }).content
    expect(nested[1]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageA.attachment, 'corrupt'),
    })

    const derivedUser = session.deriveEventMessage(userSource)
    expect(derivedUser?.content[0]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageA.attachment, 'corrupt'),
    })
    expect(derivedUser?.content[1]).toEqual(imageB)
    expect(derivedUser?.content[2]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageA.attachment, 'corrupt'),
    })
  })

  it('restores quarantined image references from history upon attachment/recovered', () => {
    const session = createSession(SessionId('s-recovery'))
    userMessage(session, [
      { type: 'text', text: 'intro' },
      imageA,
      imageB,
    ])

    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'read_failed',
      retryable: true,
    })

    const quarantinedMessages = session.deriveMessages()
    expect(quarantinedMessages[0]?.content[1]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageA.attachment, 'read_failed'),
    })

    session.append('attachment/recovered', {
      attachmentId: idA,
    })

    const recoveredMessages = session.deriveMessages()
    expect(recoveredMessages[0]?.content[1]).toEqual(imageA)
    expect(recoveredMessages[0]?.content[2]).toEqual(imageB)
  })

  it('reconstructs identical state through foldSurface, restore, and session fork', () => {
    const session = createSession(SessionId('s-replay'))
    const source = userMessage(session, [imageA])

    session.append('attachment/quarantine', {
      attachmentId: idA,
      failureClass: 'not_found',
    })

    const events = session.snapshotEvents()
    const fold = foldSurface(events, projections)
    expect(deriveEventMessage(source, fold.projectedMessages)).toEqual(session.deriveMessages()[0])

    const restored = Session.fromRestore(
      session.id,
      events,
      session.header,
      SessionLogOffset(0),
      'shared-frozen',
      projections,
    )
    expect(restored.deriveMessages()).toEqual(session.deriveMessages())

    const childId = SessionId('s-child')
    const child = createSession(
      childId,
      events,
      { ...session.header, id: childId, parentSession: session.id, isSeeded: true },
      SessionLogOffset(events.length),
    )
    expect(child.deriveMessages()).toEqual(session.deriveMessages())
  })

  it('validates durable event payload invariants', () => {
    const session = createSession(SessionId('s-invalid'))
    userMessage(session, [imageA])

    expect(() => session.append('attachment/quarantine', {} as never)).toThrow(/attachmentId and failureClass/)
    expect(() => session.append('attachment/quarantine', { attachmentId: idA } as never)).toThrow(/attachmentId and failureClass/)
    expect(() => session.append('attachment/quarantine', { failureClass: 'not_found' } as never)).toThrow(/attachmentId and failureClass/)
    expect(() => session.append('attachment/recovered', {} as never)).toThrow(/attachmentId/)
  })

  it('matches keyless snapshot of placeholder text and durable quarantine event', () => {
    const unnamedImage: ImageBlock = {
      type: 'image',
      attachment: { attachmentId: idA, mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
    }
    expect(quarantinedImageText(imageA.attachment, 'not_found')).toMatchInlineSnapshot(
      '"[image quarantined: not_found; "first.png" (sha256:aaaaaaaa)]"',
    )
    expect(quarantinedImageText(imageA.attachment, 'corrupt')).toMatchInlineSnapshot(
      '"[image quarantined: corrupt; "first.png" (sha256:aaaaaaaa)]"',
    )
    expect(quarantinedImageText(imageA.attachment, 'read_failed')).toMatchInlineSnapshot(
      '"[image quarantined: read_failed; "first.png" (sha256:aaaaaaaa)]"',
    )
    expect(quarantinedImageText(unnamedImage.attachment, 'not_found')).toMatchInlineSnapshot(
      '"[image quarantined: not_found; sha256:aaaaaaaa]"',
    )
  })
})
