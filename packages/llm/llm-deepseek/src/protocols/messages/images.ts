/** Deterministic Messages image preparation for Files references and bounded inline fallback. */

import type { AttachmentStore, ImageAttachmentRef, RequestImageAttachment } from '@deepseek-ai/dsh-attachment'
import { contentHasImage, LlmError, offloadedImageText, offloadRequestImagesWithPolicy } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ImageAttachmentAccessResolver, Message } from '@deepseek-ai/dsh-llm'
import type { DeepSeekConnectionOptions as Connection } from '../../adapter.ts'
import { resolveRequestImagePolicy } from '../../request-pricing.ts'
import type { DeepSeekFileId } from '../../file-id.ts'
import type { RequestFiles } from '../../request-files.ts'

export { deepSeekImageRequestPricing as imagePricing } from '../../request-pricing.ts'

function bounds(connection: Connection, representation: 'raw' | 'base64') {
  return {
    representation,
    maxBytes: representation === 'raw' ? connection.maxRequestFilesBytes : connection.maxInlineRequestImageBytes,
    maxImages: connection.maxImagesPerRequest,
    byteQuantum: representation === 'raw' ? connection.imageOffloadByteQuantum : connection.inlineImageOffloadByteQuantum,
    countQuantum: connection.imageOffloadCountQuantum,
  }
}

function* imageRefs(blocks: readonly ContentBlock[]): Generator<ImageAttachmentRef> {
  for (const block of blocks) {
    if (block.type === 'image') yield block.attachment
    else if (block.type === 'tool-result') yield* imageRefs(block.content)
  }
}

/** Normalize retained image references before converting Messages content.
 * @param history - durable history; never mutated.
 * @param connection - request-local image budgets.
 * @param modelId - target model id.
 * @param attachments - mounted attachment store, required only for image requests.
 * @param access - current execution-world path resolver.
 * @param signal - request cancellation.
 * @returns projected history and prepared image bytes keyed by attachment id.
 */
export async function prepareImages(
  history: readonly Message[], connection: Connection, modelId: string,
  attachments: AttachmentStore | undefined, access: ImageAttachmentAccessResolver, signal: AbortSignal,
): Promise<{ messages: readonly Message[]; versions: Map<ImageAttachmentRef['attachmentId'], RequestImageAttachment> }> {
  const versions = new Map<ImageAttachmentRef['attachmentId'], RequestImageAttachment>()
  if (!history.some(message => contentHasImage(message.content))) return { messages: history, versions }
  const model = connection.models.find(entry => entry.id === modelId)
  if (model?.inputModalities?.includes('image') !== true || attachments === undefined) {
    throw new LlmError('DeepSeek Messages image input requires a vision model and attachment service', 'UNSUPPORTED_CONTENT')
  }
  if (history.some(message => message.role !== 'user' && contentHasImage(message.content))) {
    throw new LlmError('DeepSeek Messages supports images only in user messages and tool results', 'UNSUPPORTED_CONTENT')
  }
  const policy = resolveRequestImagePolicy(model)
  const messages = offloadRequestImagesWithPolicy(history, {
    ...bounds(connection, 'raw'),
    byteLength: ref => Math.min(ref.bytes, policy.maxBytes),
    placeholder: ref => offloadedImageText(ref, access(ref)),
  })
  for (const message of messages) {
    for (const ref of imageRefs(message.content)) {
      if (!versions.has(ref.attachmentId)) {
        versions.set(ref.attachmentId, await attachments.readImageRequest(ref, policy, signal))
      }
    }
  }
  return { messages: projectImages(messages, versions, connection, 'raw', access), versions }
}

/** Project retained images into the tighter inline request budget after Files fails.
 * @param messages - history already within the Files budget.
 * @param versions - normalized versions prepared for retained references.
 * @param connection - resolved inline bounds.
 * @param access - current execution-world path resolver.
 * @returns history with oldest excess image occurrences replaced by stable text.
 */
export function inlineImages(
  messages: readonly Message[], versions: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>,
  connection: Connection, access: ImageAttachmentAccessResolver,
): readonly Message[] {
  return projectImages(messages, versions, connection, 'base64', access)
}

function projectImages(
  messages: readonly Message[], versions: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>,
  connection: Connection, representation: 'raw' | 'base64', access: ImageAttachmentAccessResolver,
): readonly Message[] {
  return offloadRequestImagesWithPolicy(messages, {
    ...bounds(connection, representation),
    byteLength: ref => (versions.get(ref.attachmentId) as RequestImageAttachment).bytes,
    placeholder: ref => offloadedImageText(ref, access(ref)),
  })
}

/** Resolve retained images to Files ids, recording every occurrence for failure diagnostics.
 * @param messages - history within the Files byte/count budget.
 * @param versions - normalized versions for every retained reference.
 * @param files - request-owned Files resolution and recovery.
 * @returns ids keyed by durable attachment identity.
 */
export async function prepareFileIds(
  messages: readonly Message[], versions: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>, files: RequestFiles,
): Promise<Map<ImageAttachmentRef['attachmentId'], DeepSeekFileId>> {
  const ids = new Map<ImageAttachmentRef['attachmentId'], DeepSeekFileId>()
  for (const [index, message] of messages.entries()) {
    let image = 0
    for (const ref of imageRefs(message.content)) {
      const version = versions.get(ref.attachmentId) as RequestImageAttachment
      ids.set(ref.attachmentId, await files.resolve(version, { message: index + 1, image: ++image }))
    }
  }
  return ids
}
