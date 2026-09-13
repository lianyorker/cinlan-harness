/** Durable item-to-Workspace association records; Session content remains unchanged. */
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkItemId } from '@deepseek-ai/dsh-work-items/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/** Key identifies an exact item, Workspace and optional Session tuple. */
export type AssociationKey = Branded<'WorkItemAssociationKey'>
const record = z.object({
  id: z.string().min(1).transform(value => brandString<WorkItemId>(value)),
  workspaceId: z.string().min(1).transform(value => brandString<WorkspaceId>(value)),
  sessionId: z.string().min(1).transform(value => brandString<SessionId>(value)).optional(),
})
/** Local association fields persisted through storageDomain. */
export type AssociationRecord = z.infer<typeof record>
/** Separate authoritative domain; never stores tokens or external issue bodies. */
export const workItemAssociations = defineDomain({
  name: 'work_item_associations', version: 1,
  tables: { links: domainTable<AssociationKey, AssociationRecord>(record) },
})
/**
 * Encode one complete association identity as a stable storage key.
 * @param value - Complete association identity.
 * @returns An unambiguous persisted key.
 */
export function associationKey(value: AssociationRecord): AssociationKey {
  return brandString<AssociationKey>(JSON.stringify([value.id, value.workspaceId, value.sessionId ?? null]))
}
