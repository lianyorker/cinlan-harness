/** Read-only Workspace presentation derived from the authorized Session list. */
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'

/**
 * Supply the existing Workspace interface without a Host mutation or directory capability.
 * @param unavailable - Localized operation refusal.
 * @returns A service whose methods fail locally before any RPC.
 */
export function readonlyWorkspace(unavailable: () => string): UiWorkspace {
  const refuse = (): never => { throw new Error(unavailable()) }
  const reject = (): Promise<never> => Promise.reject(new Error(unavailable()))
  return {
    connectWorkspace: reject,
    startSession: refuse,
    archiveSession: reject,
    unarchiveSession: reject,
    pickDirectory: reject,
    listDirectory: reject,
    createDirectory: reject,
  }
}

/**
 * Adapt authorized Session summaries for the existing blank-session composer.
 * Synthetic Workspace identities are presentation-only and never cross RPC.
 * @param sessions - Host-filtered Session list and selection.
 * @returns Stable observable and snapshots until the Session source changes.
 */
export function authorizedWorkspaces(sessions: ISessions): HostObservable<WorkspaceSnapshot> {
  let previous: SessionListState | undefined
  let snapshot: WorkspaceSnapshot
  return {
    subscribe: listener => sessions.list.subscribe(listener),
    getSnapshot: () => {
      const list = sessions.list.getSnapshot()
      if (list !== previous) {
        previous = list
        snapshot = {
          phase: list.phase,
          state: list.phase === 'ready' ? 'idle' : 'loading',
          error: null,
          archivedSessionIds: [],
          items: list.ids.flatMap((id) => {
            const session = list.byId[id]
            if (session === undefined) return []
            const timestamp = new Date(session.updatedAt).toISOString()
            return [{
              workspaceId: ('paired:' + id) as WorkspaceId,
              path: session.cwd ?? '',
              title: session.displayTitle,
              sessionIds: [id],
              createdAt: timestamp,
              updatedAt: timestamp,
            }]
          }),
        }
      }
      return snapshot
    },
  }
}
