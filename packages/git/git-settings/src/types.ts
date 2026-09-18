/** Shared types for durable Git and source control preferences. */

/** Branch prefix source for newly created Worktree Tasks. */
export type BranchPrefixMode = 'git-username' | 'custom' | 'none'

/** Source control group display order in the changes panel. */
export type SourceControlGroupOrder = 'changes-first' | 'staged-first' | 'untracked-first'

/** User-controlled Git preferences stored in the git-source-control namespace. */
export interface GitSourceControlSettings {
  /** Prefix source applied only when creating a Worktree Task. */
  branchPrefix: BranchPrefixMode
  /** Literal custom prefix; Git validates the resulting branch before Create. */
  branchPrefixCustom: string
  /** Saved preference without a runtime consumer; the UI permits reset only. */
  refreshLocalBaseRefOnWorktreeCreate: boolean
  /** Display order of source control file groups. */
  sourceControlGroupOrder: SourceControlGroupOrder
  /** Compare with the configured upstream when available. */
  compareAgainstUpstream: boolean
  /** Add attribution to commits explicitly created through source control. */
  enableGitHubAttribution: boolean
}
