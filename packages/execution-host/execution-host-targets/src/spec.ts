/** Authoritative durable target records, validated on read and mutation. */
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { ExecutionTargetId } from './types.ts'

const targetId = z.uuid().transform(value => value as ExecutionTargetId)
const revision = z.number().int().positive()
const label = z.string().trim().min(1).max(120)
const sshAlias = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,252}$/)

const hash = z.string().regex(/^[0-9a-f]{64}$/)
const remotePath = z.string().startsWith('/')
const endpointOptions = {
  proxyCommand: z.string().min(1).max(4096).optional(),
  jumpHost: z.string().min(1).max(253).optional(),
  multiplex: z.boolean().optional(),
  keepAliveIntervalSeconds: z.number().int().min(1).max(86_400).optional(),
  connectTimeoutSeconds: z.number().int().min(1).max(604_800).optional(),
}
const publicEndpointSchema = z.strictObject({
  host: z.string().min(1), port: z.number().int().min(1).max(65535), username: z.string().min(1), hostKeySHA256: hash,
  ...endpointOptions,
})
const deploymentFields = { node: remotePath, helper: remotePath, helperHash: hash, workspace: remotePath }
/** Saved SSH deployment configuration, including its Host credential-file reference. */
export const executionSchema = z.strictObject({
  endpoint: publicEndpointSchema.extend({ privateKeyFile: z.string().refine(isAbsolute) }),
  ...deploymentFields, bootstrapPath: remotePath.optional(), bootstrapHash: hash.optional(),
}).refine(value => (value.bootstrapPath === undefined) === (value.bootstrapHash === undefined),
  'bootstrapPath and bootstrapHash must be paired')

/** Durable execution selection; credential locations and unknown fields are rejected. */
export const executionSnapshotSchema = z.strictObject({
  kind: z.literal('ssh'), targetId, revision, endpoint: publicEndpointSchema,
  ...deploymentFields, bootstrapPath: remotePath, bootstrapHash: hash,
})

// Editable connection refinements are all optional: an omitted field keeps the
// OpenSSH configuration's own value. Unlike the deployment endpoint, the key
// reference is not required to be absolute because OpenSSH expands a leading
// tilde in -i.
const connectionSchema = z.strictObject({
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).optional(),
  privateKeyFile: z.string().min(1).optional(),
  ...endpointOptions,
})

/** User-provided inspection alias, connection description and optional explicit execution deployment. */
export const createTargetSchema = z.strictObject({
  label, sshAlias, connection: connectionSchema.optional(), execution: executionSchema.optional(),
})
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
const savedTargetSchema = createTargetSchema.extend({
  id: targetId, revision, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  retainedExecutions: z.record(z.string().regex(/^[1-9][0-9]*$/), executionSchema).default({}),
}).refine(record => Object.keys(record.retainedExecutions).every((value) => {
  const retainedRevision = Number(value)
  return Number.isSafeInteger(retainedRevision) && retainedRevision < record.revision
}), 'retained execution revisions must precede the current target revision')

/** Private durable target row; predecessor credential references never enter management views. */
export type StoredTarget = z.infer<typeof savedTargetSchema>

/** Durable target registry; runtime observations are never written here. */
export const executionTargetsDomain = defineDomain({
  name: 'execution_host_targets', version: 2, compatibleVersions: [1],
  tables: { targets: domainTable<ExecutionTargetId, StoredTarget>(savedTargetSchema) },
})
