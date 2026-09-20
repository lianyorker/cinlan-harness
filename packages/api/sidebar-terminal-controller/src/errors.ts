/** Stable, value-free diagnostics for terminal provider failures on the Remote wire. */
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { SidebarTerminalErrorCode } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type {} from './types.ts'

const messages = {
  'invalid-request': 'Invalid terminal request; check the target, attachment, and display dimensions',
  'invalid-directory': 'Choose an existing directory inside the session workspace',
  'invalid-shell': 'Selected shell is unavailable; choose a shell in a new terminal tab',
  unavailable: 'Terminal service is unavailable; check the configured shell and native dependencies',
  'not-found': 'Terminal or session was not found; refresh the sidebar terminal list',
  'stale-attachment': 'Terminal attachment is stale; reopen the terminal before sending commands',
  'output-overflow': 'Terminal output exceeded its buffer; reopen the terminal',
  'ack-timeout': 'Terminal output acknowledgement timed out; reopen the terminal',
} satisfies Record<SidebarTerminalErrorCode, string>

/**
 * Remove provider paths and diagnostics from serialized operational errors.
 * @param error - Provider or validation failure.
 * @returns Closed typed failure with stable repair guidance and no private values.
 */
export function terminalFailure(error: unknown): RemoteError {
  if (error instanceof SidebarTerminalError) {
    return new RemoteError(`sidebarTerminals/${error.code}`, messages[error.code], {}, { cause: error })
  }
  return new RemoteError('sidebarTerminals/operation-failed', 'Terminal operation failed; reopen the terminal and check the configured shell', {}, { cause: error })
}
