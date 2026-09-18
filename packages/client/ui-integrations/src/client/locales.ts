/** Integration settings section locale dictionaries. */

export interface IntegrationDictionary {
  nav: string
  title: string
  description: string
  githubTitle: string
  githubDescription: string
  gitlabTitle: string
  gitlabDescription: string
  giteeTitle: string
  giteeDescription: string
  statusConnected: string
  statusNotInstalled: string
  statusNotAuthenticated: string
  statusNotConfigured: string
  statusUnavailable: string
  authUnavailableHint: string
  statusChecking: string
  accountLabel: string
  installLink: string
  installPrompt: string
  githubInstallCommand: string
  gitlabInstallCommand: string
  authCommand: string
  gitlabAuthCommand: string
  authPrompt: string
  tokenPrompt: string
  tokenConfigured: string
  learnMore: string
  recheck: string
  refreshAll: string
  errorText: string
}

export const en: IntegrationDictionary = {
  nav: 'Integrations',
  title: 'Integrations',
  description: 'Check the tools and authentication used by your development workflows.',
  githubTitle: 'GitHub',
  githubDescription: 'Connect via the GitHub CLI (gh) to manage pull requests and issues.',
  gitlabTitle: 'GitLab',
  gitlabDescription: 'Connect via the GitLab CLI (glab) to manage merge requests and issues.',
  giteeTitle: 'Gitee',
  giteeDescription: 'Connect via a Gitee personal access token to manage pull requests and issues.',
  statusConnected: 'Connected',
  statusNotInstalled: 'Not installed',
  statusNotAuthenticated: 'Not authenticated',
  statusNotConfigured: 'Not configured',
  statusUnavailable: 'Unavailable',
  authUnavailableHint: 'Authentication could not be verified. Check the network and credentials, then retry.',
  statusChecking: 'Checking…',
  accountLabel: 'Account',
  installLink: 'Install',
  installPrompt: 'Install the CLI to get started:',
  authCommand: 'gh auth login',
  gitlabAuthCommand: 'glab auth login',
  githubInstallCommand: 'winget install GitHub.cli',
  gitlabInstallCommand: 'winget install GLab.GLab',
  authPrompt: 'Authenticate to connect:',
  tokenPrompt: 'Set the GITEE_TOKEN environment variable to connect.',
  tokenConfigured: 'Token is set. Verify by re-checking.',
  learnMore: 'Learn more',
  recheck: 'Re-check',
  refreshAll: 'Refresh all',
  errorText: 'Failed to check integration status.',
}

export const zh: IntegrationDictionary = {
  nav: '集成',
  title: '集成',
  description: '检查开发流程使用的工具与身份验证状态。',
  githubTitle: 'GitHub',
  githubDescription: '通过 GitHub CLI (gh) 连接，管理 Pull Request 和 Issue。',
  gitlabTitle: 'GitLab',
  gitlabDescription: '通过 GitLab CLI (glab) 连接，管理 Merge Request 和 Issue。',
  giteeTitle: 'Gitee',
  giteeDescription: '通过 Gitee 个人访问令牌连接，管理 Pull Request 和 Issue。',
  statusConnected: '已连接',
  statusNotInstalled: '未安装',
  statusNotAuthenticated: '未认证',
  statusNotConfigured: '未配置',
  statusUnavailable: '不可用',
  authUnavailableHint: '暂时无法验证身份，请检查网络和凭据后重试。',
  statusChecking: '检查中…',
  accountLabel: '账号',
  installLink: '安装',
  installPrompt: '安装 CLI 以开始：',
  authCommand: 'gh auth login',
  gitlabAuthCommand: 'glab auth login',
  githubInstallCommand: 'winget install GitHub.cli',
  gitlabInstallCommand: 'winget install GLab.GLab',
  authPrompt: '认证以连接：',
  tokenPrompt: '设置 GITEE_TOKEN 环境变量以连接。',
  tokenConfigured: '令牌已设置。重新检查以验证。',
  learnMore: '了解更多',
  recheck: '重新检查',
  refreshAll: '刷新全部',
  errorText: '检查集成状态失败。',
}

export type IntegrationSettingsKey = keyof IntegrationDictionary
