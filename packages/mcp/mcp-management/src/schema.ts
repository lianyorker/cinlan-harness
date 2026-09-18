/** Parse managed configuration at durable and Remote input boundaries. */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { McpServerId } from '@deepseek-ai/dsh-mcp-client'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { McpServerCommon, McpServerInput, McpServerRecord } from './types.ts'

const reference = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).transform(value => brandString<CredentialRef>(value))
const identifier = z.uuid().transform(value => brandString<McpServerId>(value))
const timer = z.number().int().min(1).max(MAX_TIMER_DELAY_MS)
const common = {
  serverName: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  enabled: z.boolean(),
  toolCallTimeoutMs: timer.optional(),
  reconnect: z.object({
    enabled: z.boolean().optional(), initialDelayMs: timer.optional(), maxDelayMs: timer.optional(),
    maxAttempts: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
  }).strict().optional(),
}
const stdio = z.object({
  ...common, transport: z.literal('stdio'), command: z.string().trim().min(1), args: z.array(z.string()),
  cwd: z.string(), env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), reference),
}).strict()
const http = z.object({
  ...common, transport: z.literal('streamable-http'), url: z.url().refine((value) => {
    let url: URL
    try { url = new URL(value) } catch { return false }
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
      && url.search === '' && url.hash === ''
  }),
  headers: z.record(z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_~|\x60-]+$/), z.object({
    ref: reference, prefix: z.string().refine(value => !/[\r\n]/.test(value)),
  }).strict()),
}).strict()

/** Omit absent parser fields so persisted objects keep exact optional-property semantics. */
function options(value: z.infer<typeof stdio> | z.infer<typeof http>): Pick<McpServerCommon, 'reconnect' | 'toolCallTimeoutMs'> {
  const reconnect = value.reconnect
  return {
    ...value.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: value.toolCallTimeoutMs },
    ...reconnect === undefined ? {} : { reconnect: {
      ...reconnect.enabled === undefined ? {} : { enabled: reconnect.enabled },
      ...reconnect.initialDelayMs === undefined ? {} : { initialDelayMs: reconnect.initialDelayMs },
      ...reconnect.maxDelayMs === undefined ? {} : { maxDelayMs: reconnect.maxDelayMs },
      ...reconnect.maxAttempts === undefined ? {} : { maxAttempts: reconnect.maxAttempts },
    } },
  }
}

/** Strict inputs admit only credential references in environment and header fields. */
export const serverInputSchema: z.ZodType<McpServerInput> = z.discriminatedUnion('transport', [stdio, http]).transform((value) => {
  const { toolCallTimeoutMs: _timeout, reconnect: _reconnect, ...record } = value
  return { ...record, ...options(value) }
})
const recordSchema: z.ZodType<McpServerRecord> = z.discriminatedUnion('transport', [
  stdio.extend({ id: identifier }), http.extend({ id: identifier }),
]).transform((value) => {
  const { toolCallTimeoutMs: _timeout, reconnect: _reconnect, ...record } = value
  return { ...record, ...options(value) }
})

/** One profile is the atomic unit of revisioned server configuration. */
export interface McpProfileRecord { revision: number; records: McpServerRecord[] }
const profileSchema: z.ZodType<McpProfileRecord> = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), records: z.array(recordSchema),
}).strict().refine(value => new Set(value.records.map(record => record.id)).size === value.records.length
  && new Set(value.records.map(record => record.serverName)).size === value.records.length)

/** Desired configuration only; resolved credentials and observed states are never persisted. */
export const mcpManagementDomain = defineDomain({
  name: 'mcp_management', version: 1, layout: 'per-record',
  tables: { profiles: domainTable<string, McpProfileRecord>(profileSchema) },
})
