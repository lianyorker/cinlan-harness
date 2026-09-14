/** Work Items Settings dictionaries; external issue text remains verbatim. */
export const NS = 'workItems'

/** Simplified Chinese copy and key source. */
export const zh = {
  writes: '修改外部工单', writeHint: '默认禁用写入。Provider 必须显式配置 allowWrites；每次写入均先预览再确认。',
  writeKind: '操作', writeCreate: '创建工单', writeComment: '添加评论', writeState: '修改状态', writeAssign: '修改指派',
  writeTitle: '工单标题', writeBody: '正文或评论', writeStateValue: '状态（GitHub: open/closed；Linear: workflow state ID）',
  writeAssignees: '负责人（GitHub login 逗号分隔；Linear 单个 UUID；留空取消指派）',
  writePreview: '预览外部修改', writeConfirm: '确认执行外部修改', writeCancel: '取消待执行修改',
  writeHistory: '刷新写入记录', writeUnknown: '结果不确定，请在来源平台核实；不会自动重发。',
  writeStatusPrepared: '待确认', writeStatusRunning: '已发送，结果尚未确认', writeStatusSucceeded: '已成功',
  writeStatusFailed: '未执行或被拒绝', writeStatusUnknown: '结果不确定', writeStatusCanceled: '已取消', writeStatusExpired: '确认已过期',

  nav: '工作项', title: '工作项', description: '查看 GitHub 和 Linear 工单、管理本地关联，并通过预览确认外部修改。',
  source: '来源', github: 'GitHub', linear: 'Linear', gitlab: 'GitLab', state: '状态', open: '未关闭', closed: '已关闭', all: '全部',
  search: '搜索标题或描述', workspaceContext: '工作区范围', allWorkspaceContexts: '所有工作区关联',
  refresh: '刷新', previous: '上一页', next: '下一页', loading: '正在加载工作项…', empty: '没有符合条件的工作项。',
  unavailable: '工作项服务暂不可用，请检查 Provider 配置。', error: '工作项操作失败：{message}', unknownError: '未知错误',
  noSelection: '选择一个工作项查看详情。', external: '打开来源', workspace: '关联工作区', noWorkspace: '尚无关联',
  branch: '分支', phase: '租约状态', active: '活跃', hibernated: '休眠', labels: '标签', assignees: '负责人',
  session: '关联会话', workspaceOnly: '仅关联工作区', associate: '关联', disassociate: '取消关联', saving: '正在保存…',
  chooseWorkspace: '选择工作区后可创建关联。', truncated: '结果已截断；请缩小搜索范围或继续翻页。',

  providerManagement: '任务来源管理', providerManagementDesc: '管理任务来源 Provider 的连接状态和可见性。',
  providerConnected: '已连接', providerNotConnected: '未连接', providerChecking: '检查中…',
  providerVisible: '可见', providerHidden: '已隐藏',
  providerToggleVisible: '切换可见性',
  goToIntegrations: '前往集成设置', goToIntegrationsHint: '在集成设置页面配置 GitHub / GitLab 连接。',
  providerAccount: '账号',
} as const

/** Work Items locale keys. */
export type WorkItemsKey = keyof typeof zh

/** English copy with the same key set. */
export const en: Record<WorkItemsKey, string> = {
  writes: 'Change external issues', writeHint: 'Writes are disabled unless the Provider enables allowWrites. Every mutation requires preview and separate confirmation.',
  writeKind: 'Operation', writeCreate: 'Create issue', writeComment: 'Add comment', writeState: 'Change state', writeAssign: 'Change assignees',
  writeTitle: 'Issue title', writeBody: 'Body or comment', writeStateValue: 'State (GitHub: open/closed; Linear: workflow state ID)',
  writeAssignees: 'Assignees (GitHub logins separated by commas; Linear: one UUID; empty removes assignment)',
  writePreview: 'Preview external change', writeConfirm: 'Confirm external change', writeCancel: 'Cancel pending change',
  writeHistory: 'Refresh write history', writeUnknown: 'Outcome is uncertain. Verify it at the provider; this operation will not be sent again.',
  writeStatusPrepared: 'Awaiting confirmation', writeStatusRunning: 'Sent, result unconfirmed', writeStatusSucceeded: 'Succeeded',
  writeStatusFailed: 'Not executed or rejected', writeStatusUnknown: 'Unknown outcome', writeStatusCanceled: 'Canceled', writeStatusExpired: 'Approval expired',

  nav: 'Work Items', title: 'Work Items', description: 'Read GitHub and Linear issues, manage local links, and preview external changes before confirmation.',
  source: 'Source', github: 'GitHub', linear: 'Linear', gitlab: 'GitLab', state: 'State', open: 'Open', closed: 'Closed', all: 'All',
  search: 'Search title or description', workspaceContext: 'Workspace scope', allWorkspaceContexts: 'All Workspace links',
  refresh: 'Refresh', previous: 'Previous', next: 'Next', loading: 'Loading work items…', empty: 'No work items match the current filters.',
  unavailable: 'Work Items is unavailable; check Provider configuration.', error: 'Work Items operation failed: {message}', unknownError: 'Unknown error',
  noSelection: 'Select a work item to view details.', external: 'Open source', workspace: 'Linked Workspace', noWorkspace: 'No links yet',
  branch: 'Branch', phase: 'Lease state', active: 'Active', hibernated: 'Hibernated', labels: 'Labels', assignees: 'Assignees',
  session: 'Linked Session', workspaceOnly: 'Workspace only', associate: 'Link', disassociate: 'Unlink', saving: 'Saving…',
  chooseWorkspace: 'Select a Workspace to create a link.', truncated: 'Results are truncated; narrow the search or continue to the next page.',

  providerManagement: 'Task Source Providers', providerManagementDesc: 'Manage connection status and visibility of Work Item providers.',
  providerConnected: 'Connected', providerNotConnected: 'Not connected', providerChecking: 'Checking…',
  providerVisible: 'Visible', providerHidden: 'Hidden',
  providerToggleVisible: 'Toggle visibility',
  goToIntegrations: 'Go to Integrations', goToIntegrationsHint: 'Configure GitHub / GitLab connections in the Integrations settings page.',
  providerAccount: 'Account',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Work Items Settings copy. */
    workItems: WorkItemsKey
  }
}
