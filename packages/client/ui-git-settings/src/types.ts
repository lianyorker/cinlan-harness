/** Durable git and source control preferences shared by the Host settings provider and browser UI. */

import s from '@deepseek-ai/schemastery'

/** Settings namespace owned by the git-settings plugin. */
export const GIT_SETTINGS_NAMESPACE = 'git-source-control'

/** Branch prefix mode: use git username, custom string, or none. */
export type BranchPrefixMode = 'git-username' | 'custom' | 'none'

/** Source control group display order in the changes panel. */
export type SourceControlGroupOrder = 'changes-first' | 'staged-first' | 'untracked-first'

/** User-controlled git and source control preferences. */
export interface GitSourceControlSettings {
  branchPrefix: BranchPrefixMode
  branchPrefixCustom: string
  refreshLocalBaseRefOnWorktreeCreate: boolean
  sourceControlGroupOrder: SourceControlGroupOrder
  compareAgainstUpstream: boolean
  enableGitHubAttribution: boolean
}

/** Schema used by Host registration and Client settings decoding. */
export const GitSourceControlSettingsSchema: s<GitSourceControlSettings> = s.object({
  branchPrefix: s.union(['git-username', 'custom', 'none']).default('none'),
  branchPrefixCustom: s.string().default(''),
  refreshLocalBaseRefOnWorktreeCreate: s.boolean().default(false),
  sourceControlGroupOrder: s.union(['changes-first', 'staged-first', 'untracked-first']).default('changes-first'),
  compareAgainstUpstream: s.boolean().default(false),
  enableGitHubAttribution: s.boolean().default(false),
})
