/** Fixed management operation errors; transport and credential values never enter messages. */
import type { McpManagementErrorCode } from './types.ts'

/** A management refusal that may safely cross the Remote boundary. */
export class McpManagementError extends Error {
  /** @param code - Stable refusal category, without user or external-server text. */
  constructor(readonly code: McpManagementErrorCode) {
    super('MCP management operation failed: ' + code)
    this.name = 'McpManagementError'
  }
}
