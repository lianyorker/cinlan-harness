/** Browser-safe request and response data for the sidebarGit Remote namespace. */
export type * from '@deepseek-ai/dsh-sidebar-git/types'

/** Failure details shared by every operation in the sidebarGit namespace. */
export interface SidebarGitFailureDetails { operation: string }

/** Stable Remote codes for the concrete Git owner's refusals and execution failures. */
export type SidebarGitRemoteErrorCode =
  | 'sidebar-git/unavailable'
  | 'sidebar-git/not-repository'
  | 'sidebar-git/invalid-request'
  | 'sidebar-git/stale'
  | 'sidebar-git/conflict'
  | 'sidebar-git/git-error'
  | 'sidebar-git/output-limit'
  | 'sidebar-git/cancelled'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'sidebar-git/unavailable': SidebarGitFailureDetails
    'sidebar-git/not-repository': SidebarGitFailureDetails
    'sidebar-git/invalid-request': SidebarGitFailureDetails
    'sidebar-git/stale': SidebarGitFailureDetails
    'sidebar-git/conflict': SidebarGitFailureDetails
    'sidebar-git/git-error': SidebarGitFailureDetails
    'sidebar-git/output-limit': SidebarGitFailureDetails
    'sidebar-git/cancelled': SidebarGitFailureDetails
  }
}
