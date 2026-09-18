/** Wire DTO validation and bounded JSON-RPC transport for execution-host workers. */

import type { ExecutionHostId } from '@deepseek-ai/dsh-execution-host/types'
import { z } from 'zod'

export { createWorkerTransport } from './transport.ts'
export type { WorkerTransport } from './transport.ts'

/** Supported worker protocol version. */
export const PROTOCOL_VERSION = 1

export type { ExportedRoot, WorkerInfo, DirectoryInspection, WorkerResult, InitializeParams, InspectDirectoryParams, CancelParams } from './types.ts'
import type { WorkerInfo, DirectoryInspection, WorkerResult } from './types.ts'

const identifier = z.string().min(1).max(128)
const hostIdSchema = z.string().min(1).transform(value => value as ExecutionHostId)

/** Parser for initialization requests. */
export const initializeParamsSchema = z.strictObject({ protocolVersion: z.number().int() })

/** Parser for inspection requests; filesystem authorization follows parsing. */
export const inspectDirectoryParamsSchema = z.strictObject({
  operationId: identifier,
  expectedHostId: hostIdSchema,
  rootId: identifier,
  path: z.string(),
})

/** Parser for cancellation requests. */
export const cancelParamsSchema = z.strictObject({ operationId: identifier })

/** Shutdown accepts an empty object only. */
export const shutdownParamsSchema = z.strictObject({})

/** Parser for worker identity and implemented capabilities. */
export const workerInfoSchema: z.ZodType<WorkerInfo> = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  executionHost: z.strictObject({
    hostId: hostIdSchema,
    hostname: z.string().min(1),
    pid: z.number().int().positive(),
    platform: z.string().min(1),
    createdAt: z.iso.datetime(),
  }),
  roots: z.array(z.strictObject({ id: identifier, label: z.string().min(1), path: z.string().min(1) })),
  capabilities: z.tuple([z.literal('directory-inspection')]),
})

/** Parser for bounded directory metadata returned by a worker. */
export const directoryInspectionSchema: z.ZodType<DirectoryInspection> = z.strictObject({
  executionHostId: hostIdSchema,
  rootId: identifier,
  path: z.string(),
  entries: z.array(z.strictObject({
    name: z.string().min(1),
    type: z.enum(['file', 'directory', 'symlink', 'other']),
  })),
  truncated: z.boolean(),
})

/**
 * Validate either a typed success value or a sanitized worker failure.
 * @param inner - Parser for the successful result.
 * @returns A discriminated worker-result parser.
 */
export function workerResultSchema<T>(inner: z.ZodType<T>): z.ZodType<WorkerResult<T>> {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value: inner }),
    z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: z.string().min(1), message: z.string() }) }),
  ])
}

/** Cancellation success confirms that filesystem work has settled. */
export const cancelResultSchema = workerResultSchema(z.strictObject({ settled: z.literal(true) }))
