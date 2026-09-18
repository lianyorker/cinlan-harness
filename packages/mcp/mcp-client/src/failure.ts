/** Safe MCP failure codes for credential resolvers and management callers. @module */
import type { McpConnectionError } from './types.ts'

/** An MCP failure whose message contains only its public classification. */
export class McpConnectionFailure extends Error {
  /** Create a safe failure. @param code - fixed public classification. */
  constructor(readonly code: McpConnectionError) {
    super(code)
    this.name = 'McpConnectionFailure'
  }
}

/** Classify an upstream failure without retaining its message. */
export function connectionErrorCode(error: unknown, fallback: McpConnectionError): McpConnectionError {
  if (error instanceof McpConnectionFailure) return error.code
  if (error !== null && typeof error === 'object') {
    const code = 'code' in error ? error.code : undefined
    const status = 'status' in error ? error.status : undefined
    if (code === 401 || code === 403 || status === 401 || status === 403) return 'authentication-failed'
  }
  return fallback
}
