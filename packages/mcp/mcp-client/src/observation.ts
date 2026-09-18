/** Immutable metadata and contained observers for MCP lifecycle publication. @module */
import type { Context } from '@deepseek-ai/cordis'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { McpConnectionFailure } from './failure.ts'
import type { McpToolDescriptor } from './types.ts'

/** Invoke every observer without allowing subscriber failures to alter lifecycle work. */
export function notifyObservers(ctx: Context, listeners: ReadonlySet<() => unknown>): void {
  for (const listener of [...listeners]) {
    try {
      void Promise.resolve(listener()).catch(() => { ctx.logger.warn('mcp-client: observer failed') })
    } catch {
      ctx.logger.warn('mcp-client: observer failed')
    }
  }
}

/** Redact JSON strings and property names without changing the live protocol schema. */
function redactValue(value: unknown, redact: (text: string) => string): unknown {
  if (typeof value === 'string') return redact(value)
  if (Array.isArray(value)) return value.map(item => redactValue(item, redact))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [redact(key), redactValue(item, redact)]))
  }
  return value
}

/** Prepare detached public descriptors before any tool registration is replaced. */
export function describeTool(
  name: string,
  description: string,
  inputSchema: JsonSchemaNode,
  redact?: (text: string) => string,
): McpToolDescriptor {
  // A public name must identify the actual registration; an echoed credential
  // cannot be replaced with a display-only alias and still satisfy that promise.
  if (redact !== undefined && redact(name) !== name) throw new McpConnectionFailure('tool-sync-failed')
  return deepFreeze({
    name,
    description: redact === undefined ? description : redact(description),
    inputSchema: redact === undefined ? structuredClone(inputSchema) : redactValue(inputSchema, redact) as JsonSchemaNode,
  })
}
