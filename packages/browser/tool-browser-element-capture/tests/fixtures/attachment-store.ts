import AttachmentStore, { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'

/** In-memory attachment provider used by the Loader composition fixture. */
export default class FixtureAttachmentStore extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024,
    maxImagesPerMessage: 1,
    maxMessageImageBytes: 1024,
    maxImagePixels: 1024,
    maxImageDimension: 8192,
    mediaTypes: ['image/png', 'image/jpeg'],
  }

  private stored: StoredImageAttachment | undefined

  validateImage(_input: SaveImageAttachment): Promise<void> {
    return Promise.resolve()
  }

  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    const ref: ImageAttachmentRef = {
      attachmentId: AttachmentId('sha256:loader-element'),
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 30,
      height: 40,
      ...input.name === undefined ? {} : { name: input.name },
    }
    this.stored = { ref, data: Uint8Array.from(input.data) }
    return Promise.resolve(ref)
  }

  readImage(ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    if (this.stored?.ref.attachmentId !== ref.attachmentId) {
      return Promise.reject(new Error(`unknown fixture attachment ${String(ref.attachmentId)}`))
    }
    return Promise.resolve({ ref: { ...this.stored.ref }, data: Uint8Array.from(this.stored.data) })
  }
}
