export type ConnectionStatus = 'disconnected' | 'connecting' | 'reconnecting' | 'paired' | 'error'

export interface Sub2ApiProfile {
  token: string
  valid: boolean
  baseUrl: string
  billingUrl: string
  balance?: number
  quotaTotal?: number
  quotaUsed?: number
  expiresAt?: string
}

export interface ToolCall {
  id: string
  tool: string
  args: Record<string, unknown>
  state: 'pending' | 'running' | 'completed' | 'failed' | 'denied'
  result?: unknown
}

export interface TrajectoryStep {
  id: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  thought?: string
  toolCalls?: ToolCall[]
  timestamp: number
}

export interface ApprovalOption {
  id: string
  label: string
  description?: string
  defaultSelected?: boolean
}

export interface ApprovalRequest {
  approvalId: string
  toolName: string
  reason?: string
  callId?: string
  args?: Record<string, unknown>
  createdAt: number
  type?: 'permission' | 'question' | 'multi_select'
  options?: ApprovalOption[]
  isMultiSelect?: boolean
}

export interface SessionInfo {
  id: string
  title: string
  active: boolean
  updatedAt: number
}

/** One paired desktop as the mobile settings screens report it. */
export interface HostConnectionSummary {
  readonly hostId: string
  readonly name: string
  readonly os: string
  readonly status: ConnectionStatus
  /** Which transport carries this host's traffic. */
  readonly transport: 'lan' | 'relay'
  /** Direct or relay endpoint the phone dials. */
  readonly endpoint: string
}

/** A paired desktop as the dashboard and sessions list render it. */
export interface DesktopDevice {
  readonly id: string
  readonly name: string
  readonly os: string
  readonly isConnected: boolean
  readonly connectionType: string
  readonly workspaceCount: number
}

/** A session row inside a workspace group on the sessions screen. */
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

/** A named workspace with its sessions, grouped for the sessions screen. */
export interface WorkspaceGroup {
  readonly id: string
  readonly name: string
  readonly isExpandedDefault?: boolean
  readonly sessions: readonly SessionItem[]
}

/** Where HTTP(S) links tapped in terminal output open. */
export type BrowserLinkTarget = 'desktop' | 'phone'
