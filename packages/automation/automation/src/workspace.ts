/** Local Workspace admission shared by Automation draft validation and Agent publication. */
import type { Context } from '@deepseek-ai/cordis'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'

/**
 * Reject unavailable, remote or moved Workspaces before using their paths on this Host.
 * @param ctx - Automation owner with the current Workspace registry.
 * @param id - saved Workspace identity.
 * @param path - captured canonical Host path, when rechecking a saved definition.
 * @returns the current local Workspace.
 */
export function localWorkspace(ctx: Context, id: WorkspaceId, path?: string): Workspace {
  const workspace = ctx.workspaceRegistry.get(id)
  if (workspace === undefined) throw new Error('saved workspace is unavailable')
  if (workspace.execution.kind !== 'local') throw new Error('Automation requires a local Workspace')
  if (path !== undefined && workspace.path !== path) throw new Error('saved workspace moved')
  return workspace
}
