/** Schema for durable external-write approvals and receipts, separate from local associations. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { WorkItemId, WorkItemWriteId, WorkItemWriteOperation } from './types.ts'

const id = z.string().min(1).max(500).transform(value => value as WorkItemId)
const source = z.enum(['github', 'linear'])
const text = z.string().max(20_000)
/** Validated mutation payload shared by preview admission and stored-record parsing. */
export const mutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), source, title: z.string().trim().min(1).max(500), body: text }).strict(),
  z.object({ kind: z.literal('comment'), id, body: text.refine(value => value.trim().length > 0) }).strict(),
  z.object({ kind: z.literal('state'), id, state: z.string().trim().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('assign'), id, assignees: z.array(z.string().trim().min(1).max(500)).max(10) }).strict(),
])
const errorCode = z.enum([
  'unavailable', 'configured-missing', 'configured-unavailable', 'ambiguous', 'authentication-required',
  'forbidden', 'not-found', 'rate-limited', 'invalid-response', 'provider-failed', 'invalid-request', 'aborted',
  'write-disabled', 'write-conflict', 'write-not-found', 'write-rejected',
])
const recordSchema = z.object({
  operationId: z.uuid().transform(value => value as WorkItemWriteId), source, scope: z.string().min(1),
  mutation: mutationSchema,
  status: z.enum(['prepared', 'running', 'succeeded', 'failed', 'unknown', 'canceled', 'expired']),
  createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  target: z.object({ id, title: text, updatedAt: z.string().optional() }).optional(),
  result: z.object({ itemId: id, url: z.url().max(20_000) }).optional(),
  errorCode: errorCode.optional(), revision: z.string().optional(),
})
/** Private stored record extends the public preview with its preflight content revision. */
export type WriteRecord = WorkItemWriteOperation & { readonly revision?: string }
/** Durable execution state prevents repeating a mutation after an interrupted process. */
export const workItemWriteDomain = defineDomain({
  name: 'work_item_writes', version: 1,
  tables: { operations: domainTable<WorkItemWriteId, WriteRecord>(recordSchema.transform(value => ({
    operationId: value.operationId, source: value.source, scope: value.scope,
    mutation: value.mutation, status: value.status, createdAt: value.createdAt, expiresAt: value.expiresAt,
    ...(value.target === undefined ? {} : { target: {
      id: value.target.id, title: value.target.title,
      ...(value.target.updatedAt === undefined ? {} : { updatedAt: value.target.updatedAt }),
    } }),
    ...(value.result === undefined ? {} : { result: value.result }),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
    ...(value.revision === undefined ? {} : { revision: value.revision }),
  }))) },
})
