/** Public automation failures omit underlying storage and provider diagnostics. */
import { AutomationError } from '@deepseek-ai/dsh-automation'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { AutomationErrorCode } from './types.ts'

const messages: Record<AutomationErrorCode, string> = {
  unavailable: 'Automation runtime is unavailable.',
  'not-found': 'Automation or invocation was not found.',
  conflict: 'Automation changed; refresh before retrying.',
  invalid: 'Automation request is invalid.',
  busy: 'Automation has an active invocation.',
  resource: 'An automation resource is unavailable.',
  storage: 'Automation storage operation failed.',
}

/** Remove private diagnostics from an operation failure.
 * @param error - local failure.
 * @returns a bounded, safe Remote failure.
 */
export function automationFailure(error: unknown): RemoteError<'automation/operation-failed'> {
  const code = error instanceof AutomationError ? error.code : 'resource'
  return new RemoteError('automation/operation-failed', messages[code], { code }, { cause: error })
}

/** Map synchronous and asynchronous runtime exceptions consistently.
 * @param operation - runtime command.
 * @returns its committed result or a safe Remote failure.
 */
export async function automationOperation<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw automationFailure(error)
  }
}
