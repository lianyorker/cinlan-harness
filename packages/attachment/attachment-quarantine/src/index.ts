/**
 * Cordis plugin and public interface for attachment quarantine and recovery.
 * @module @deepseek-ai/dsh-attachment-quarantine
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-attachment'
import { attachmentQuarantineProjection, attachmentRecoveredProjection } from './projection.ts'

export { attachmentQuarantineProjection, attachmentRecoveredProjection, quarantinedImageText } from './projection.ts'
export type {
  AttachmentQuarantineEventData,
  AttachmentQuarantineFailureClass,
  AttachmentRecoveredEventData,
} from './types.ts'
export { isAttachmentQuarantined, collectRetainedImageRefs } from './quarantine.ts'
export { recoverAttachment } from './recovery.ts'

/** Cordis plugin name. */
export const name = 'attachment-quarantine'

/** Required services. */
export const inject = ['sessions']

/**
 * Register attachment quarantine and recovery message projections on the session store.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  ctx.sessions.registerMessageProjection(attachmentQuarantineProjection)
  ctx.sessions.registerMessageProjection(attachmentRecoveredProjection)
}

export default { name, inject, apply }
