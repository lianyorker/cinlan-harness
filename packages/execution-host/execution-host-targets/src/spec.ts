/** Authoritative durable target records, validated on read and mutation. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionTargetId, SavedTarget } from './types.ts'

const targetId = z.uuid().transform(value => value as ExecutionTargetId)
const revision = z.number().int().positive()
const label = z.string().trim().min(1).max(120)
const sshAlias = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/)

/** User-provided names and a concrete OpenSSH configuration alias. */
export const createTargetSchema = z.strictObject({ label, sshAlias })
/** Revision-bound changes to an existing target. */
export const updateTargetSchema = createTargetSchema.extend({ id: targetId, revision })
/** Revision admission for connect and remove. */
export const targetRevisionSchema = z.strictObject({ id: targetId, revision })
/** Exact target identity. */
export const targetRequestSchema = z.strictObject({ id: targetId })
/** A root-relative path tied to the current SSH connection. */
export const inspectDirectorySchema = z.strictObject({
  id: targetId, generation: z.number().int().positive(), rootId: z.string().min(1).max(128), path: z.string().max(4096),
})
const savedTargetSchema: z.ZodType<SavedTarget> = createTargetSchema.extend({
  id: targetId, revision, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
})

/** Durable target registry; runtime observations are never written here. */
export const executionTargetsDomain = defineDomain({
  name: 'execution_host_targets', version: 1,
  tables: { targets: domainTable<ExecutionTargetId, SavedTarget>(savedTargetSchema) },
})
