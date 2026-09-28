import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, ImageBlock, StreamChunk } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import attachmentQuarantinePlugin from '../src/index.ts'
import { quarantinedImageText } from '../src/projection.ts'
import { isAttachmentQuarantined } from '../src/quarantine.ts'

class RecordingAdapter extends LlmAdapter {
  dispatchedOptions: GenerateOptions[] = []

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.dispatchedOptions.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'response' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function collectChunks(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) {
    chunks.push(chunk)
  }
  return chunks
}

describe('attachment quarantine end-to-end integration with LLM stream', () => {
  let ctx: Context
  let adapter: RecordingAdapter
  const idMissing = `sha256:${'1'.repeat(64)}` as AttachmentId
  const idCorrupt = `sha256:${'2'.repeat(64)}` as AttachmentId
  const idTransient = `sha256:${'3'.repeat(64)}` as AttachmentId
  const idPersistent = `sha256:${'4'.repeat(64)}` as AttachmentId
  const idHealthy = `sha256:${'5'.repeat(64)}` as AttachmentId

  const imageMissing: ImageBlock = {
    type: 'image',
    attachment: { attachmentId: idMissing, name: 'missing.png', mediaType: 'image/png', bytes: 100, width: 10, height: 10 },
  }

  const imageCorrupt: ImageBlock = {
    type: 'image',
    attachment: { attachmentId: idCorrupt, name: 'corrupt.png', mediaType: 'image/png', bytes: 200, width: 20, height: 20 },
  }

  const imageTransient: ImageBlock = {
    type: 'image',
    attachment: { attachmentId: idTransient, name: 'transient.png', mediaType: 'image/png', bytes: 300, width: 30, height: 30 },
  }

  const imagePersistent: ImageBlock = {
    type: 'image',
    attachment: { attachmentId: idPersistent, name: 'persistent.png', mediaType: 'image/png', bytes: 400, width: 40, height: 40 },
  }

  const imageHealthy: ImageBlock = {
    type: 'image',
    attachment: { attachmentId: idHealthy, name: 'healthy.png', mediaType: 'image/png', bytes: 500, width: 50, height: 50 },
  }

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(attachmentQuarantinePlugin)

    adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['mock'], adapter)
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
  })

  it('quarantines missing historical image and reprojects before adapter dispatch', async () => {
    const readImageMock = vi.fn(async (ref: { attachmentId: AttachmentId }) => {
      if (ref.attachmentId === idMissing) {
        throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
      }
      return { ref: imageHealthy.attachment, data: new Uint8Array(100) }
    })

    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const session = ctx.sessions.create(SessionId('s-missing-img'))
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'look at this' }, imageMissing, imageHealthy],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }))

    // Stream completed with stop
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })

    // Session has recorded attachment/quarantine
    expect(isAttachmentQuarantined(session, idMissing)).toBe(true)
    const quarantineEvent = session.snapshotEvents().find(e => e.type === 'attachment/quarantine')
    expect(quarantineEvent?.data).toEqual({
      attachmentId: idMissing,
      failureClass: 'not_found',
    })

    // Adapter received reprojected messages with placeholder text
    expect(adapter.dispatchedOptions).toHaveLength(1)
    const dispatchedContent = adapter.dispatchedOptions[0]?.messages[0]?.content
    expect(dispatchedContent?.[0]).toEqual({ type: 'text', text: 'look at this' })
    expect(dispatchedContent?.[1]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageMissing.attachment, 'not_found'),
    })
    expect(dispatchedContent?.[2]).toEqual(imageHealthy)

    // Subsequent call skips readImage for quarantined image
    readImageMock.mockClear()
    await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }))

    expect(readImageMock).toHaveBeenCalledTimes(1)
    expect(readImageMock).toHaveBeenCalledWith(imageHealthy.attachment, undefined)
  })

  it('quarantines corrupt historical image', async () => {
    const readImageMock = vi.fn(async () => {
      throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
    })

    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const session = ctx.sessions.create(SessionId('s-corrupt-img'))
    session.append('user/message', createUserMessage({
      content: [imageCorrupt],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }))

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    expect(isAttachmentQuarantined(session, idCorrupt)).toBe(true)
    const quarantineEvent = session.snapshotEvents().find(e => e.type === 'attachment/quarantine')
    expect(quarantineEvent?.data).toEqual({
      attachmentId: idCorrupt,
      failureClass: 'corrupt',
    })

    const dispatchedContent = adapter.dispatchedOptions[0]?.messages[0]?.content
    expect(dispatchedContent?.[0]).toEqual({
      type: 'text',
      text: quarantinedImageText(imageCorrupt.attachment, 'corrupt'),
    })
  })

  it('retries transient read failure once and does not quarantine if retry succeeds', async () => {
    let callCount = 0
    const readImageMock = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        throw new AttachmentError('Unable to read image attachment.', 'ATTACHMENT_READ_FAILED')
      }
      return { ref: imageTransient.attachment, data: new Uint8Array(300) }
    })

    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const session = ctx.sessions.create(SessionId('s-transient-img'))
    session.append('user/message', createUserMessage({
      content: [imageTransient],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }))

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    // Called twice: 1st failed, 2nd retry succeeded
    expect(readImageMock).toHaveBeenCalledTimes(2)

    // Not quarantined!
    expect(isAttachmentQuarantined(session, idTransient)).toBe(false)
    expect(session.snapshotEvents().filter(e => e.type === 'attachment/quarantine')).toHaveLength(0)

    // Dispatched original image
    const dispatchedContent = adapter.dispatchedOptions[0]?.messages[0]?.content
    expect(dispatchedContent?.[0]).toEqual(imageTransient)
  })

  it('quarantines with retryable: true when ATTACHMENT_READ_FAILED fails retry', async () => {
    const readImageMock = vi.fn(async () => {
      throw new AttachmentError('Unable to read image attachment.', 'ATTACHMENT_READ_FAILED')
    })

    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const session = ctx.sessions.create(SessionId('s-persistent-img'))
    session.append('user/message', createUserMessage({
      content: [imagePersistent],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
    }))

    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    // Initial attempt + single retry
    expect(readImageMock).toHaveBeenCalledTimes(2)

    expect(isAttachmentQuarantined(session, idPersistent)).toBe(true)
    const quarantineEvent = session.snapshotEvents().find(e => e.type === 'attachment/quarantine')
    expect(quarantineEvent?.data).toEqual({
      attachmentId: idPersistent,
      failureClass: 'read_failed',
      retryable: true,
    })

    const dispatchedContent = adapter.dispatchedOptions[0]?.messages[0]?.content
    expect(dispatchedContent?.[0]).toEqual({
      type: 'text',
      text: quarantinedImageText(imagePersistent.attachment, 'read_failed'),
    })
  })

  it('fails loud for auxiliary calls without a live session', async () => {
    const readImageMock = vi.fn(async () => {
      throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    })

    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: [createUserMessage({
        content: [imageMissing],
        source: { kind: 'user' },
      })],
      // No sessionId: auxiliary call
    }))

    expect(chunks).toHaveLength(1)
    const finish = chunks[0]
    expect(finish?.type).toBe('finish')
    if (finish?.type === 'finish') {
      expect(finish.reason.kind).toBe('error')
      if (finish.reason.kind === 'error') {
        expect(finish.reason.failure.code).toBe('ATTACHMENT_NOT_FOUND')
      }
    }
  })

  it('does not quarantine when request is cancelled via AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort(new Error('client aborted'))

    const readImageMock = vi.fn()
    ctx.provide('attachments', {
      readImage: readImageMock,
    } as unknown as AttachmentStore)

    const session = ctx.sessions.create(SessionId('s-abort'))
    session.append('user/message', createUserMessage({
      content: [imageMissing],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const chunks = await collectChunks(ctx.llm.stream({
      provider: 'mock',
      model: 'default',
      messages: session.deriveMessages(),
      sessionId: session.id,
      signal: controller.signal,
    }))

    expect(chunks).toHaveLength(1)
    const finish = chunks[0]
    expect(finish?.type).toBe('finish')
    if (finish?.type === 'finish') {
      expect(finish.reason.kind).toBe('aborted')
    }

    // Must NOT have quarantined
    expect(isAttachmentQuarantined(session, idMissing)).toBe(false)
    expect(session.snapshotEvents().filter(e => e.type === 'attachment/quarantine')).toHaveLength(0)
  })
})
