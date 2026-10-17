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
  /** Name a generated task branch after the task instead of its internal id. */
  autoRenameTaskBranch: boolean
  /** Source Control AI author configuration and action recipe defaults. */
  sourceControlAi?: SourceControlAiSettings
}

/** Action identifier for Source Control AI Author operations. */
export type SourceControlAiActionId = 'commit-message' | 'diff-review' | 'pr-description'

/** Action recipe configuration defining prompt templates and model options. */
export type SourceControlAiActionRecipe = {
  /** Whether this action recipe is enabled. */
  readonly enabled: boolean
  /** Prompt template with placeholder support ({{diff}}, {{branch}}, {{stagedFiles}}). */
  readonly template: string
  /** Optional model or agent override. */
  readonly modelOverride?: string
  /** Optional CLI arguments or specialized flags. */
  readonly agentArgs?: string
}

/** Complete settings for Git Source Control AI Author. */
export type SourceControlAiSettings = {
  /** Global toggle for AI Author capabilities in source control. */
  readonly enabled: boolean
  /** Maximum bytes of diff allowed before truncation. */
  readonly maxDiffBytes: number
  /** Whether to filter out sensitive files (.env, keys, certificates) from AI prompt context. */
  readonly filterSensitiveFiles: boolean
  /** Configured action recipes keyed by action identifier. */
  readonly recipes: Record<SourceControlAiActionId, SourceControlAiActionRecipe>
}

