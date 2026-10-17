import type { ApprovalRequest, TrajectoryStep } from '../types'

export interface DesktopDevice {
  readonly id: string
  readonly name: string
  readonly os: string
  readonly isConnected: boolean
  readonly connectionType: string
  readonly workspaceCount: number
}

export interface TaskItem {
  readonly id: string
  readonly title: string
  readonly source: string
  readonly count?: number
}

export interface SessionItem {
  readonly id: string
  readonly title: string
  readonly type: 'chat' | 'terminal'
  readonly isActive?: boolean
  readonly unreadCount?: number
  readonly timestamp?: string
  readonly subtitle?: string
  readonly isPinned?: boolean
  readonly isArchived?: boolean
  readonly updatedAt?: number
}

export interface WorkspaceGroup {
  readonly id: string
  readonly name: string
  readonly isExpandedDefault?: boolean
  readonly sessions: readonly SessionItem[]
}

// ==================== Settings Mock Types ====================
export type BrowserLinkTarget = 'desktop' | 'phone'

export interface BrowserSettingsMock {
  openTerminalLinks: BrowserLinkTarget
}

export interface NotificationSettingsMock {
  enableNotifications: boolean
  isSystemDisabled: boolean
  onlyWhenAway: boolean
  notificationSound: boolean
  suppressWhileFocused: boolean
}

export interface SettingsMockState {
  readonly browser: BrowserSettingsMock
  readonly notifications: NotificationSettingsMock
}

export interface MockAppState {
  readonly isPaired: boolean
  readonly stats: {
    readonly agentsCreated: number
    readonly runtimeFormatted: string
    readonly prsCreated: number
  }
  readonly desktops: readonly DesktopDevice[]
  readonly workspaces: readonly WorkspaceGroup[]
  readonly tasks: readonly TaskItem[]
  readonly defaultPairingCode: string
  readonly initialSteps: readonly TrajectoryStep[]
  readonly pendingApproval: ApprovalRequest | null
  readonly settings: SettingsMockState
}

export const INITIAL_SETTINGS_MOCK: SettingsMockState = {
  browser: {
    openTerminalLinks: 'desktop',
  },
  notifications: {
    enableNotifications: false,
    isSystemDisabled: true,
    onlyWhenAway: true,
    notificationSound: false,
    suppressWhileFocused: false,
  },
}

export const MOCK_DATA: MockAppState = {
  isPaired: true,
  stats: {
    agentsCreated: 15,
    runtimeFormatted: '1天 12小时',
    prsCreated: 0,
  },
  desktops: [
    {
      id: 'desktop-3qu41u1',
      name: 'DESKTOP-3QU41U1',
      os: 'Windows',
      isConnected: true,
      connectionType: '直接 · 局域网',
      workspaceCount: 4,
    },
  ],
  workspaces: [
    {
      id: 'ws-deepseek-1',
      name: 'DEEPSEEK 1',
      isExpandedDefault: true,
      sessions: [
        {
          id: 'session-deepseek',
          title: 'deepseek',
          type: 'chat',
          isActive: true,
          unreadCount: 1,
        },
      ],
    },
    {
      id: 'ws-cinlan-harness',
      name: 'cinlan-harness',
      isExpandedDefault: true,
      sessions: [
        {
          id: 'session-cinlan-refactor',
          title: '下面为你做两件事：1. **彻底',
          type: 'terminal',
          timestamp: '5小时前',
        },
      ],
    },
    {
      id: 'ws-ground',
      name: 'ground-v2.3.x.wy',
      isExpandedDefault: false,
      sessions: [
        {
          id: 'session-ground-1',
          title: 'v2.3.x 发布构建测试',
          type: 'terminal',
          timestamp: '昨天',
        },
      ],
    },
    {
      id: 'ws-grainlink',
      name: 'GrainLink',
      isExpandedDefault: false,
      sessions: [
        {
          id: 'session-grainlink-1',
          title: 'API 网关通信链路自检',
          type: 'chat',
          timestamp: '3天前',
        },
      ],
    },
  ],
  tasks: [
    {
      id: 'task-github',
      title: '任务',
      source: 'GitHub',
      count: 2,
    },
  ],
  defaultPairingCode: 'TE2NDI1ODES782K',
  initialSteps: [
    {
      id: 'step-1',
      role: 'user',
      content: '重构移动端 UI 界面，接入黑暗极简工业风与配对流',
      timestamp: Date.now() - 120_000,
    },
    {
      id: 'step-2',
      role: 'assistant',
      content: '正在分析移动端设计规范，构建符合 Dark Minimalist 风格的移动端组件及屏幕流。',
      thought: '读取设计规范与页面原型，组织 ConnectDesktop、Settings、ManualPair、Notifications 及 Dashboard 五大核心界面。',
      toolCalls: [
        {
          id: 'tc-status',
          tool: 'workspace.status',
          args: { target: 'apps/mobile' },
          state: 'completed',
          result: '工作区已就绪，已加载移动端视觉规范。',
        },
        {
          id: 'tc-git',
          tool: 'git.status',
          args: {},
          state: 'completed',
          result: '5 个移动端屏幕组件准备重构。',
        },
      ],
      timestamp: Date.now() - 90_000,
    },
    {
      id: 'step-3',
      role: 'assistant',
      content: '已创建全新深色工业风页面，当前正在准备运行自动化质量验证与构建。',
      thought: '执行本地构建以确保无 TypeScript 错误及样式正常引入。',
      toolCalls: [
        {
          id: 'tc-build',
          tool: 'terminal.execute',
          args: { command: 'pnpm --filter @cinlan/mobile-companion build' },
          state: 'running',
        },
      ],
      timestamp: Date.now() - 30_000,
    },
  ],
  pendingApproval: {
    approvalId: 'appr-build-01',
    toolName: 'terminal.execute',
    reason: '智能体请求在桌面端执行构建与依赖验证，需要您的授权确认。',
    createdAt: Date.now() - 15_000,
  },
  settings: INITIAL_SETTINGS_MOCK,
}
