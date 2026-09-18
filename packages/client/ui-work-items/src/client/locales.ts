/** Work Items Settings dictionaries; external issue text remains verbatim. */
export const NS = 'workItems'

/** Simplified Chinese copy and key source. */
export const zh = {
  writes: '修改外部工单', writeHint: '外部写入由主机 Provider 显式启用。每次修改必须先预览，再单独确认。',
  writeKind: '操作', writeCreate: '创建工单', writeComment: '添加评论', writeState: '修改状态', writeAssign: '修改指派',
  writeTitle: '工单标题', writeBody: '正文或评论', writeStateValue: '目标状态', writeAssignees: '目标负责人',
  writeStateHelp: 'GitHub：open/closed；GitLab：opened/closed；Linear：工作流状态 ID。',
  writeAssigneesHelp: 'GitHub 登录名或 GitLab 用户名以逗号分隔；Linear 使用一个用户 UUID；留空取消指派。',
  writeSelectItem: '选择工单后可添加评论、修改状态或指派。',
  writePreview: '预览外部修改', writeConfirm: '确认执行外部修改', writeCancel: '取消待执行修改',
  writeHistory: '刷新写入记录', writeUnknown: '结果不确定，请在来源平台核实；不会自动重发。',
  writeStatusPrepared: '待确认', writeStatusRunning: '已发送，结果尚未确认', writeStatusSucceeded: '已成功',
  writeStatusFailed: '未执行或被拒绝', writeStatusUnknown: '结果不确定', writeStatusCanceled: '已取消', writeStatusExpired: '确认已过期',

  nav: '工作项', title: '工作项', description: '查看 GitHub、GitLab 和 Linear 工单，管理本地关联，并在预览后确认外部修改。',
  source: '来源', github: 'GitHub', linear: 'Linear', gitlab: 'GitLab', state: '状态', open: '未关闭', closed: '已关闭', all: '全部',
  sourceHelp: '读取主机配置的仓库、项目或团队。', stateHelp: '按来源平台的未关闭或已关闭状态筛选。',
  search: '搜索标题或描述', queryHelp: '搜索每一页的标题和正文；可继续翻页查看其他匹配项。',
  workspaceContext: '工作区范围', workspaceScopeHelp: '仅限制显示的本地关联，不改变来源平台的工单范围。', allWorkspaceContexts: '所有工作区关联',
  refresh: '刷新', paging: '工单分页', pagingHelp: '使用来源平台的分页；筛选变化后返回第一页。',
  previous: '上一页', next: '下一页', loading: '正在加载工作项…', empty: '没有符合条件的工作项。',
  unavailable: '工作项服务暂不可用，请检查 Provider 配置。', error: '工作项操作失败：{message}', unknownError: '未知错误',
  noSelection: '选择一个工作项查看详情。', external: '打开来源', workspace: '关联工作区', noWorkspace: '尚无关联',
  linksHelp: '关联与取消关联只修改本地记录，不修改外部工单。',
  branch: '分支', phase: '租约状态', active: '活跃', hibernated: '休眠', labels: '标签', assignees: '负责人',
  session: '关联会话', workspaceOnly: '仅关联工作区', associate: '关联', disassociate: '取消关联', saving: '正在保存…',
  chooseWorkspace: '选择工作区后可创建关联。', truncated: '结果已截断；请缩小搜索范围或继续翻页。',

  providerManagement: '工单来源', providerManagementDesc: '选择在此页面显示的来源。仓库、团队与凭据由主机配置。',
  providerVisibility: '显示 {provider}', visibilityHelp: '控制来源选择器中的可见性，不启停 Provider。',
  providerConnected: 'CLI 已认证', providerChecking: '正在检查 CLI…', providerOnQuery: '查询时检查可用性',
  providerNotInstalled: 'CLI 未安装', providerNotAuthenticated: 'CLI 未认证', providerUnavailable: 'CLI 检查不可用',
  providerVisible: '显示', providerHidden: '隐藏', providerAccount: 'CLI 账号',
  visibilityReadOnly: '当前连接无法保存来源可见性。', visibilityFailed: '主机未接受可见性更改，请重试。',
  noVisibleProviders: '请在上方显示至少一个来源。', reset: '恢复继承', resetProvider: '恢复 {provider} 的继承设置',
  closeSettings: '关闭设置', goToIntegrationsHint: '可在集成设置中检查 GitHub / GitLab CLI 认证；工单查询使用主机 Provider 自己的范围与凭据。',
} as const

/** Work Items locale keys. */
export type WorkItemsKey = keyof typeof zh

/** English copy with the same key set. */
export const en: Record<WorkItemsKey, string> = {
  writes: 'Change external issues', writeHint: 'The Host provider must explicitly enable external writes. Every mutation requires preview and separate confirmation.',
  writeKind: 'Operation', writeCreate: 'Create issue', writeComment: 'Add comment', writeState: 'Change state', writeAssign: 'Change assignees',
  writeTitle: 'Issue title', writeBody: 'Body or comment', writeStateValue: 'Target state', writeAssignees: 'Target assignees',
  writeStateHelp: 'GitHub: open/closed; GitLab: opened/closed; Linear: workflow state ID.',
  writeAssigneesHelp: 'Separate GitHub logins or GitLab usernames with commas; Linear accepts one user UUID. Leave empty to clear assignees.',
  writeSelectItem: 'Select an issue to add a comment, change its state, or assign it.',
  writePreview: 'Preview external change', writeConfirm: 'Confirm external change', writeCancel: 'Cancel pending change',
  writeHistory: 'Refresh write history', writeUnknown: 'Outcome is uncertain. Verify it at the provider; this operation will not be sent again.',
  writeStatusPrepared: 'Awaiting confirmation', writeStatusRunning: 'Sent, result unconfirmed', writeStatusSucceeded: 'Succeeded',
  writeStatusFailed: 'Not executed or rejected', writeStatusUnknown: 'Unknown outcome', writeStatusCanceled: 'Canceled', writeStatusExpired: 'Approval expired',

  nav: 'Work Items', title: 'Work Items', description: 'Read GitHub, GitLab, and Linear issues, manage local links, and preview external changes before confirmation.',
  source: 'Source', github: 'GitHub', linear: 'Linear', gitlab: 'GitLab', state: 'State', open: 'Open', closed: 'Closed', all: 'All',
  sourceHelp: 'Read the repository, project, or team configured on the Host.', stateHelp: 'Filter by the provider’s open or closed states.',
  search: 'Search title or description', queryHelp: 'Search titles and bodies within each page; continue paging for more matches.',
  workspaceContext: 'Workspace scope', workspaceScopeHelp: 'Limit the local links shown; this does not change the provider issue scope.', allWorkspaceContexts: 'All Workspace links',
  refresh: 'Refresh', paging: 'Issue pages', pagingHelp: 'Follow provider pages; changing filters returns to the first page.',
  previous: 'Previous', next: 'Next', loading: 'Loading work items…', empty: 'No work items match the current filters.',
  unavailable: 'Work Items is unavailable; check Provider configuration.', error: 'Work Items operation failed: {message}', unknownError: 'Unknown error',
  noSelection: 'Select a work item to view details.', external: 'Open source', workspace: 'Linked Workspace', noWorkspace: 'No links yet',
  linksHelp: 'Linking and unlinking change local records only; they do not change external issues.',
  branch: 'Branch', phase: 'Lease state', active: 'Active', hibernated: 'Hibernated', labels: 'Labels', assignees: 'Assignees',
  session: 'Linked Session', workspaceOnly: 'Workspace only', associate: 'Link', disassociate: 'Unlink', saving: 'Saving…',
  chooseWorkspace: 'Select a Workspace to create a link.', truncated: 'Results are truncated; narrow the search or continue to the next page.',

  providerManagement: 'Issue sources', providerManagementDesc: 'Choose which sources appear on this page. The Host configures repositories, teams, and credentials.',
  providerVisibility: 'Show {provider}', visibilityHelp: 'Control visibility in the source selector without enabling or disabling the provider.',
  providerConnected: 'CLI authenticated', providerChecking: 'Checking CLI…', providerOnQuery: 'Availability checked on query',
  providerNotInstalled: 'CLI not installed', providerNotAuthenticated: 'CLI not authenticated', providerUnavailable: 'CLI check unavailable',
  providerVisible: 'Shown', providerHidden: 'Hidden', providerAccount: 'CLI account',
  visibilityReadOnly: 'This connection cannot save source visibility.', visibilityFailed: 'The Host did not accept the visibility change. Try again.',
  noVisibleProviders: 'Show at least one source above.', reset: 'Reset to inherited', resetProvider: 'Reset {provider} to inherited settings',
  closeSettings: 'Close settings', goToIntegrationsHint: 'Check GitHub / GitLab CLI authentication in Integrations settings. Issue queries use the Host provider’s own scope and credentials.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Work Items Settings copy. */
    workItems: WorkItemsKey
  }
}
