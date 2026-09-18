/** Stable errors for explicitly requested sidebar Git operations. */
import type { SidebarGitErrorCode } from './types.ts'

/** A Git operation refused before dispatch or failed while executing. */
export class SidebarGitError extends Error {
  constructor(readonly code: SidebarGitErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SidebarGitError'
  }
}
