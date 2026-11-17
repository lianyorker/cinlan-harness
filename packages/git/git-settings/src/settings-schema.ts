/** Browser-safe Git settings schema with no Host registration side effects. */

import s from '@deepseek-ai/schemastery'
import { DEFAULT_SOURCE_CONTROL_AI_SETTINGS } from './ai-author.ts'
import type { GitSourceControlSettings, SourceControlAiActionRecipe, SourceControlAiSettings } from './types.ts'

/** Durable namespace shared by Git preference consumers. */
export const GIT_SETTINGS_NAMESPACE = 'git-source-control'

const ACTION_RECIPE: s<SourceControlAiActionRecipe> = s.object({
  enabled: s.boolean().default(true),
  template: s.string().default(''),
  modelOverride: s.string().default(''),
  agentArgs: s.string().default(''),
})

const SOURCE_CONTROL_AI: s<SourceControlAiSettings> = s.object({
  enabled: s.boolean().default(DEFAULT_SOURCE_CONTROL_AI_SETTINGS.enabled),
  maxDiffBytes: s.number().default(DEFAULT_SOURCE_CONTROL_AI_SETTINGS.maxDiffBytes),
  filterSensitiveFiles: s.boolean().default(DEFAULT_SOURCE_CONTROL_AI_SETTINGS.filterSensitiveFiles),
  recipes: s.object({
    'commit-message': ACTION_RECIPE,
    'diff-review': ACTION_RECIPE,
    'pr-description': ACTION_RECIPE,
  }),
}).default(DEFAULT_SOURCE_CONTROL_AI_SETTINGS)

/** Schema resolving the durable Git and source control preferences. */
export const GitSourceControlSettingsSchema: s<GitSourceControlSettings> = s.object({
  branchPrefix: s.union(['git-username', 'custom', 'none']).default('none'),
  branchPrefixCustom: s.string().default(''),
  refreshLocalBaseRefOnWorktreeCreate: s.boolean().default(false),
  sourceControlGroupOrder: s.union(['changes-first', 'staged-first', 'untracked-first']).default('changes-first'),
  compareAgainstUpstream: s.boolean().default(false),
  enableGitHubAttribution: s.boolean().default(false),
  autoRenameTaskBranch: s.boolean().default(false),
  sourceControlAi: SOURCE_CONTROL_AI,
})
