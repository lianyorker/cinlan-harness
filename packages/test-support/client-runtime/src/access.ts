/**
 * Allow-all access hooks for client test fixtures.
 * @module @deepseek-ai/dsh-client-test-runtime/src/access
 */

/** Access Hooks for hand-built component props in tests. */
export interface AccessStandardProps {
  useRemoteAccess: (action: string) => boolean
  useAccess: (action: string) => boolean
  useSessionAccess: (sessionId: string, action: string) => boolean
  useWorkspaceAccess: (workspaceId: string, action: string) => boolean
}

/** Access Hooks that allow every action on every resource, for hand-built component props. */
export const allowAllAccess: AccessStandardProps = {
  useRemoteAccess: () => true,
  useAccess: () => true,
  useSessionAccess: () => true,
  useWorkspaceAccess: () => true,
}
