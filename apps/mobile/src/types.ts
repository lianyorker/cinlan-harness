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
  args: Record<string, any>
  state: 'pending' | 'running' | 'completed' | 'failed' | 'denied'
  result?: any
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
  args?: Record<string, any>
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
