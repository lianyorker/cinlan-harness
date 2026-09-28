/**
 * Types and SessionEventMap declarations for attachment quarantine and recovery.
 * @module @deepseek-ai/dsh-attachment-quarantine/types
 */

import type { AttachmentId } from '@deepseek-ai/dsh-attachment'

/** Classified failure category that caused attachment quarantine. */
export type AttachmentQuarantineFailureClass = 'not_found' | 'corrupt' | 'read_failed'

/** Durable payload for the `attachment/quarantine` event. */
export interface AttachmentQuarantineEventData {
  /** The quarantined attachment identity. */
  attachmentId: AttachmentId
  /** Classified failure cause. */
  failureClass: AttachmentQuarantineFailureClass
  /** True when the failure was a transient read error that failed retry. */
  retryable?: boolean
}

/** Durable payload for the `attachment/recovered` event. */
export interface AttachmentRecoveredEventData {
  /** The recovered attachment identity. */
  attachmentId: AttachmentId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Quarantine an unreadable historical image attachment.
     * Replaces occurrences of this attachment with deterministic placeholder text
     * and skips reading the object on subsequent model requests.
     * @messageProjection
     */
    'attachment/quarantine': AttachmentQuarantineEventData

    /**
     * Restore a previously quarantined image attachment after verified read recovery.
     * Restores the original image references in model requests.
     * @messageProjection
     */
    'attachment/recovered': AttachmentRecoveredEventData
  }
}
