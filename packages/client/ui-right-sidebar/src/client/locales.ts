/** Locale dictionaries for right sidebar tab contributors. */
export const NS = 'rightSidebarContributors'

/** Translation keys owned by the right-sidebar contributors. */
export type RightSidebarContributorsKey =
  | 'review.title' | 'review.description' | 'review.loading' | 'review.empty' | 'review.refresh'
  | 'review.branch' | 'review.changedFiles' | 'review.patch' | 'review.select'
  | 'terminal.title' | 'terminal.description' | 'terminal.loading' | 'terminal.empty'
  | 'terminal.start' | 'terminal.input' | 'terminal.send' | 'terminal.stop' | 'terminal.refresh'
  | 'terminal.error' | 'terminal.output'
  | 'tasks.title' | 'tasks.description' | 'tasks.loading' | 'tasks.empty' | 'tasks.refresh'
  | 'tasks.activate' | 'tasks.hibernate' | 'tasks.path' | 'tasks.branch' | 'tasks.status' | 'tasks.error'
  | 'browser.title' | 'browser.description' | 'browser.placeholder' | 'browser.open'
  | 'browser.invalidUrl' | 'browser.empty'

/** Simplified Chinese right-sidebar contributor copy. */
export const zh: Record<RightSidebarContributorsKey, string> = {
  'review.title': '审查',
  'review.description': '查看隔离工作区的 Git 分支和改动。',
  'review.loading': '正在读取审查项…',
  'review.empty': '当前没有可审查的隔离工作区。',
  'review.refresh': '刷新',
  'review.branch': '分支',
  'review.changedFiles': '改动文件',
  'review.patch': 'Patch',
  'review.select': '选择一个租约查看比较结果。',
  'terminal.title': '终端',
  'terminal.description': '打开当前 Session 所属的持久终端。',
  'terminal.loading': '正在读取终端…',
  'terminal.empty': '当前 Session 没有终端。',
  'terminal.start': '启动终端',
  'terminal.input': '输入命令',
  'terminal.send': '发送',
  'terminal.stop': '关闭',
  'terminal.refresh': '刷新',
  'terminal.error': '终端操作失败：{message}',
  'terminal.output': '输出',
  'tasks.title': '任务',
  'tasks.description': '查看和管理 Git worktree 任务。',
  'tasks.loading': '正在读取任务…',
  'tasks.empty': '当前没有 Worktree Task。',
  'tasks.refresh': '刷新',
  'tasks.activate': '激活',
  'tasks.hibernate': '休眠',
  'tasks.path': 'Checkout',
  'tasks.branch': '分支',
  'tasks.status': '状态',
  'tasks.error': '任务操作失败：{message}',
  'browser.title': '浏览器',
  'browser.description': '在受限 iframe 中打开 HTTP(S) 地址。',
  'browser.placeholder': '输入 HTTP(S) 地址',
  'browser.open': '打开',
  'browser.invalidUrl': '请输入有效的 HTTP(S) 地址。',
  'browser.empty': '输入地址后打开预览。',
}

/** English right-sidebar contributor copy. */
export const en: Record<RightSidebarContributorsKey, string> = {
  'review.title': 'Review',
  'review.description': 'Inspect Git branches and changes from isolated workspaces.',
  'review.loading': 'Loading review items…',
  'review.empty': 'No isolated workspaces are available for review.',
  'review.refresh': 'Refresh',
  'review.branch': 'Branch',
  'review.changedFiles': 'Changed files',
  'review.patch': 'Patch',
  'review.select': 'Select a lease to inspect its comparison.',
  'terminal.title': 'Terminal',
  'terminal.description': 'Open a persistent terminal owned by the current Session.',
  'terminal.loading': 'Loading terminals…',
  'terminal.empty': 'This Session has no terminals.',
  'terminal.start': 'Start terminal',
  'terminal.input': 'Enter a command',
  'terminal.send': 'Send',
  'terminal.stop': 'Close',
  'terminal.refresh': 'Refresh',
  'terminal.error': 'Terminal operation failed: {message}',
  'terminal.output': 'Output',
  'tasks.title': 'Tasks',
  'tasks.description': 'Inspect and manage Git worktree tasks.',
  'tasks.loading': 'Loading tasks…',
  'tasks.empty': 'No Worktree Tasks are available.',
  'tasks.refresh': 'Refresh',
  'tasks.activate': 'Activate',
  'tasks.hibernate': 'Hibernate',
  'tasks.path': 'Checkout',
  'tasks.branch': 'Branch',
  'tasks.status': 'Status',
  'tasks.error': 'Task operation failed: {message}',
  'browser.title': 'Browser',
  'browser.description': 'Open an HTTP(S) address in a restricted iframe.',
  'browser.placeholder': 'Enter an HTTP(S) address',
  'browser.open': 'Open',
  'browser.invalidUrl': 'Enter a valid HTTP(S) address.',
  'browser.empty': 'Enter an address to open a preview.',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    rightSidebarContributors: RightSidebarContributorsKey
  }
}
