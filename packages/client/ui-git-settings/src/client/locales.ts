/** Git and source control settings copy (en / zh). */

export type GitSettingsKey =
  | 'nav'
  | 'branchPrefixTitle'
  | 'branchPrefixDescription'
  | 'branchPrefixGitUsername'
  | 'branchPrefixGitUsernameDesc'
  | 'branchPrefixCustom'
  | 'branchPrefixCustomDesc'
  | 'branchPrefixNone'
  | 'branchPrefixNoneDesc'
  | 'branchPrefixCustomLabel'
  | 'branchPrefixCustomPlaceholder'
  | 'branchPrefixPreview'
  | 'keepLocalMainTitle'
  | 'keepLocalMainDescription'
  | 'groupOrderTitle'
  | 'groupOrderDescription'
  | 'groupOrderChangesFirst'
  | 'groupOrderStagedFirst'
  | 'groupOrderUntrackedFirst'
  | 'compareUpstreamTitle'
  | 'compareUpstreamDescription'
  | 'attributionTitle'
  | 'attributionDescription'
  | 'attributionKeywordHint'
  | 'settingsLoading'
  | 'settingsError'
  | 'settingsSaveFailed'
  | 'settingsSaved'

export const en: Record<GitSettingsKey, string> = {
  nav: 'Git & Source Control',
  branchPrefixTitle: 'Branch Prefix',
  branchPrefixDescription: 'Prefix used when creating branches for new worktrees.',
  branchPrefixGitUsername: 'Git Username',
  branchPrefixGitUsernameDesc: 'Use your git config user.name as the branch prefix.',
  branchPrefixCustom: 'Custom',
  branchPrefixCustomDesc: 'Use a custom string as the branch prefix.',
  branchPrefixNone: 'None',
  branchPrefixNoneDesc: 'No prefix — branch names start without a prefix.',
  branchPrefixCustomLabel: 'Custom prefix',
  branchPrefixCustomPlaceholder: 'e.g. feature/',
  branchPrefixPreview: 'Preview: {value}',
  keepLocalMainTitle: 'Keep Local Main Up To Date',
  keepLocalMainDescription: 'Automatically fast-forward the local main/master branch when creating a new worktree.',
  groupOrderTitle: 'Source Control Group Order',
  groupOrderDescription: 'Display order of change groups in the source control panel.',
  groupOrderChangesFirst: 'Changes First',
  groupOrderStagedFirst: 'Staged First',
  groupOrderUntrackedFirst: 'Untracked First',
  compareUpstreamTitle: 'Compare Against Upstream',
  compareUpstreamDescription: 'Compare the current branch against its upstream remote instead of local main.',
  attributionTitle: 'Cinlan IDE Attribution',
  attributionDescription: 'Add Co-authored-by attribution to commits, pull requests, and issues created through Cinlan IDE.',
  attributionKeywordHint: 'Triggers on keywords: github, gh, pr, issue, co-author, coauthored, attribution.',
  settingsLoading: 'Loading settings…',
  settingsError: 'Failed to load settings.',
  settingsSaveFailed: 'Failed to save setting.',
  settingsSaved: 'Saved.',
}

export const zh: Record<GitSettingsKey, string> = {
  nav: 'Git 与源代码控制',
  branchPrefixTitle: '分支前缀',
  branchPrefixDescription: '创建工作区时分支名使用的前缀。',
  branchPrefixGitUsername: 'Git 用户名',
  branchPrefixGitUsernameDesc: '使用 git config user.name 作为分支前缀。',
  branchPrefixCustom: '自定义',
  branchPrefixCustomDesc: '使用自定义字符串作为分支前缀。',
  branchPrefixNone: '无',
  branchPrefixNoneDesc: '不使用前缀——分支名直接开始。',
  branchPrefixCustomLabel: '自定义前缀',
  branchPrefixCustomPlaceholder: '例如 feature/',
  branchPrefixPreview: '预览：{value}',
  keepLocalMainTitle: '保持本地 main 最新',
  keepLocalMainDescription: '创建新工作区时自动 fast-forward 本地 main/master 分支。',
  groupOrderTitle: '源代码控制组顺序',
  groupOrderDescription: '源代码控制面板中变更组的显示顺序。',
  groupOrderChangesFirst: '变更优先',
  groupOrderStagedFirst: '已暂存优先',
  groupOrderUntrackedFirst: '未跟踪优先',
  compareUpstreamTitle: '与上游比较',
  compareUpstreamDescription: '将当前分支与其上游远程比较，而非本地 main。',
  attributionTitle: 'Cinlan IDE 署名',
  attributionDescription: '在通过 Cinlan IDE 创建的提交、PR 和 Issue 中添加 Co-authored-by 署名。',
  attributionKeywordHint: '触发关键词：github, gh, pr, issue, co-author, coauthored, attribution。',
  settingsLoading: '正在加载设置…',
  settingsError: '加载设置失败。',
  settingsSaveFailed: '保存设置失败。',
  settingsSaved: '已保存。',
}
