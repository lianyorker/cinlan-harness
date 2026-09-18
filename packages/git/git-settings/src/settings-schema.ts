/** Browser-safe Git settings schema with no Host registration side effects. */

import s from '@deepseek-ai/schemastery'
import type { GitSourceControlSettings } from './types.ts'

/** Durable namespace shared by Git preference consumers. */
export const GIT_SETTINGS_NAMESPACE = 'git-source-control'

/** Schema resolving the six durable Git and source control preferences. */
export const GitSourceControlSettingsSchema: s<GitSourceControlSettings> = s.object({
  branchPrefix: s.union(['git-username', 'custom', 'none']).default('none'),
  branchPrefixCustom: s.string().default(''),
  refreshLocalBaseRefOnWorktreeCreate: s.boolean().default(false),
  sourceControlGroupOrder: s.union(['changes-first', 'staged-first', 'untracked-first']).default('changes-first'),
  compareAgainstUpstream: s.boolean().default(false),
  enableGitHubAttribution: s.boolean().default(false),
})
