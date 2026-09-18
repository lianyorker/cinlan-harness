/** Git and source control settings copy (en / zh). */

export type GitSettingsKey =
  | 'nav'
  | 'description'
  | 'runtimeNotice'
  | 'readOnly'
  | 'reset'
  | 'resetField'
  | 'save'
  | 'discard'
  | 'customInactive'
  | 'settingsSaving'
  | 'toggleOn'
  | 'toggleOff'
  | 'branchPrefixEmpty'
  | 'branchPrefixAbsent'
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
  description: 'Manage branch naming and source control preferences.',
  runtimeNotice: 'Branch prefixes apply to new Worktree Tasks. Group order, upstream comparison, and attribution apply to Source Control. Local base refresh is unavailable.',
  readOnly: 'Git preferences are read-only for this connection.',
  reset: 'Reset',
  resetField: 'Reset {field}',
  save: 'Save',
  discard: 'Discard',
  customInactive: 'Choose a custom branch prefix to edit this value.',
  settingsSaving: 'Saving…',
  toggleOn: 'On',
  toggleOff: 'Off',
  branchPrefixEmpty: 'Enter a non-empty custom prefix before creating a task.',
  branchPrefixAbsent: '(no prefix)',
  branchPrefixTitle: 'Branch Prefix',
  branchPrefixDescription: 'Prefix for branches created by Worktree Task Create. Existing task branches keep their names.',
  branchPrefixGitUsername: 'Git Username',
  branchPrefixGitUsernameDesc: 'Resolved at Create from repository-local github.user, then user.username. Missing or invalid values prevent creation; no username preview is available here.',
  branchPrefixCustom: 'Custom',
  branchPrefixCustomDesc: 'Prepended to dsh/task/<uuid>, separated by /. Git validates the branch before Create; an empty or invalid prefix prevents creation.',
  branchPrefixNone: 'None',
  branchPrefixNoneDesc: 'Task branch names use dsh/task/<uuid>.',
  branchPrefixCustomLabel: 'Custom prefix',
  branchPrefixCustomPlaceholder: 'e.g. feature/',
  branchPrefixPreview: 'Preview: {value}',
  keepLocalMainTitle: 'Keep Local Main Up To Date',
  keepLocalMainDescription: 'Unavailable: Worktree Task Create does not fetch or fast-forward local main/master. The saved value is preserved; Reset removes your override.',
  groupOrderTitle: 'Source Control Group Order',
  groupOrderDescription: 'Apply this order to Changes, Staged, and Untracked on the next Source Control refresh.',
  groupOrderChangesFirst: 'Changes First',
  groupOrderStagedFirst: 'Staged First',
  groupOrderUntrackedFirst: 'Untracked First',
  compareUpstreamTitle: 'Compare Against Upstream',
  compareUpstreamDescription: 'Prefer the upstream for Compare branch. If none is available, use the repository default and show the chosen base.',
  attributionTitle: 'Cinlan IDE Attribution',
  attributionDescription: 'Add Co-authored-by attribution to commits you create in Source Control. Worktree Task checkpoint commits, pull requests, and issues are unaffected.',
  attributionKeywordHint: 'Triggers on keywords: github, gh, pr, issue, co-author, coauthored, attribution.',
  settingsLoading: 'Loading settings…',
  settingsError: 'Failed to load settings.',
  settingsSaveFailed: 'Failed to save setting.',
  settingsSaved: 'Saved.',
}

export const zh: Record<GitSettingsKey, string> = {
  nav: 'Git 与源代码控制',
  description: '管理分支命名与源代码控制偏好。',
  runtimeNotice: '分支前缀应用于新建 Worktree Task。分组顺序、上游比较和署名应用于源代码控制。本地基线刷新不可用。',
  readOnly: '此连接中的 Git 偏好为只读。',
  reset: '重置',
  resetField: '重置{field}',
  save: '保存',
  discard: '放弃修改',
  customInactive: '选择自定义分支前缀后可编辑此值。',
  settingsSaving: '正在保存…',
  toggleOn: '开启',
  toggleOff: '关闭',
  branchPrefixEmpty: '创建任务前请输入非空的自定义前缀。',
  branchPrefixAbsent: '（无前缀）',
  branchPrefixTitle: '分支前缀',
  branchPrefixDescription: '通过 Worktree Task 创建操作新建分支时使用的前缀。已有任务分支保留原名。',
  branchPrefixGitUsername: 'Git 用户名',
  branchPrefixGitUsernameDesc: '创建时依次读取仓库本地的 github.user、user.username。缺失或无效值会阻止创建；此处无法预览用户名。',
  branchPrefixCustom: '自定义',
  branchPrefixCustomDesc: '添加到 dsh/task/<uuid> 前，以 / 分隔。Git 在创建前验证分支；前缀为空或无效时无法创建。',
  branchPrefixNone: '无',
  branchPrefixNoneDesc: '任务分支名使用 dsh/task/<uuid>。',
  branchPrefixCustomLabel: '自定义前缀',
  branchPrefixCustomPlaceholder: '例如 feature/',
  branchPrefixPreview: '预览：{value}',
  keepLocalMainTitle: '保持本地 main 最新',
  keepLocalMainDescription: '不可用：Worktree Task 创建操作不会抓取或快进本地 main/master。已保存值会被保留；重置可移除用户覆盖。',
  groupOrderTitle: '源代码控制组顺序',
  groupOrderDescription: '下次刷新源代码控制时，按此顺序显示变更、已暂存和未跟踪分组。',
  groupOrderChangesFirst: '变更优先',
  groupOrderStagedFirst: '已暂存优先',
  groupOrderUntrackedFirst: '未跟踪优先',
  compareUpstreamTitle: '与上游比较',
  compareUpstreamDescription: '在“比较分支”中优先使用上游；上游不可用时使用仓库默认分支，并显示所选基准。',
  attributionTitle: 'Cinlan IDE 署名',
  attributionDescription: '为你在源代码控制中创建的提交添加 Co-authored-by 署名。Worktree Task 检查点提交、Pull Request 和 Issue 不受影响。',
  attributionKeywordHint: '触发关键词：github, gh, pr, issue, co-author, coauthored, attribution。',
  settingsLoading: '正在加载设置…',
  settingsError: '加载设置失败。',
  settingsSaveFailed: '保存设置失败。',
  settingsSaved: '已保存。',
}
