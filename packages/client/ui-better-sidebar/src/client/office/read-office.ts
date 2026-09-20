/** Adapt the maintained Host converter to the better-sidebar file viewer callback. */
import type { ClientRemote, RemoteFailure } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-office-to-pdf/remote'
import type { OfficeToPdfErrorCode } from '@deepseek-ai/dsh-office-to-pdf/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CopyKey } from '../locales.ts'

/** Converted bytes remain base64 until the mounted viewer owns a PDF Blob URL. */
export interface OfficePreviewFile {
  readonly data: string
  readonly missingFonts: readonly string[]
}

/**
 * Load authorized PDF bytes; cancellation follows the mounted file preview.
 * @param sessionId - Existing Session identity from the sidebar's public API.
 * @param path - Office source path within the Session workspace.
 * @param signal - Canceled when the preview closes or changes source.
 * @returns Complete PDF bytes and unavailable font names.
 */
export type ReadOfficePreview = (sessionId: string, path: string, signal: AbortSignal) => Promise<OfficePreviewFile>

/** A locale key keeps a settled failure responsive to language changes. */
export class OfficePreviewError extends Error {
  readonly key: CopyKey

  constructor(key: CopyKey) {
    super(key)
    this.key = key
  }
}

/**
 * Capture the generated Office Remote without exposing the transport to React.
 * @param remote - Office converter namespace injected by the Client apply lifetime.
 * @returns Session-authorized, cancellable PDF loading callback.
 */
export function createOfficeReader(remote: ClientRemote['officeToPdf']): ReadOfficePreview {
  return async (sessionId, path, signal) => {
    signal.throwIfAborted()
    const result = await remote.render(sessionId as SessionId, path, 'foreground', signal)
    signal.throwIfAborted()
    if (!result.ok) throw new OfficePreviewError(failureKey(result.error))
    return { data: result.value.data, missingFonts: result.value.missingFonts }
  }
}

const conversionCopy = {
  'input-too-large': 'officeTooLarge',
  'output-too-large': 'officeTooLarge',
  'invalid-document': 'officeInvalid',
  'unsupported-format': 'officeInvalid',
  'invalid-output': 'officeFailed',
  timeout: 'officeTimeout',
  unavailable: 'officeUnavailable',
  failed: 'officeFailed',
  busy: 'officeBusy',
  'source-changed': 'officeChanged',
} satisfies Record<OfficeToPdfErrorCode, CopyKey>

function failureKey(failure: RemoteFailure): CopyKey {
  switch (failure.code) {
    case 'document-render/failed': return conversionCopy[failure.details.reason]
    case 'workspace-file/not-found': return 'officeNotFound'
    case 'workspace-file/outside-workspace': return 'officeOutsideWorkspace'
    case 'workspace-file/too-large': return 'officeTooLarge'
    case 'workspace-file/not-regular-file': return 'officeInvalid'
    case 'gateway/invocation-unavailable': case 'gateway/service-unavailable': return 'officeUnavailable'
    // Other owners can extend Remote failures without adding Office-specific recovery.
    default: return 'officeReadFailed'
  }
}
