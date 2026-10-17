/** Session management types */

/** Session state enumeration */
export type SessionState = 'idle' | 'active' | 'paused' | 'error' | 'completed'

/** Session metadata */
export interface SessionMetadata {
  readonly id: string
  readonly projectPath: string | undefined
  readonly createdAt: Date
  readonly updatedAt: Date
}

/** Session state data */
export interface SessionData {
  readonly metadata: SessionMetadata
  readonly state: SessionState
  readonly context: Record<string, unknown>
  readonly history: ReadonlyArray<SessionEvent>
}

/** Session event types */
export type SessionEventType =
  | 'idle'
  | 'started'
  | 'resumed'
  | 'paused'
  | 'error'
  | 'completed'
  | 'tool_executed'
  | 'message_sent'

/** Session event */
export interface SessionEvent {
  readonly type: SessionEventType
  readonly timestamp: Date
  readonly data?: Record<string, unknown>
}

/** Session manager interface */
export interface SessionManager {
  createSession(projectPath?: string): Promise<Session>
  getSession(id: string): Promise<Session | undefined>
  listSessions(): Promise<ReadonlyArray<SessionMetadata>>
  deleteSession(id: string): Promise<void>
}

/** Session interface */
export interface Session {
  readonly id: string
  readonly metadata: SessionMetadata
  getState(): SessionState
  /** Record the selected state; paused-to-active records resumed, other active entries record started. */
  setState(state: SessionState): Promise<void>
  getContext(): Record<string, unknown>
  updateContext(updates: Record<string, unknown>): Promise<void>
  addEvent(event: Omit<SessionEvent, 'timestamp'>): Promise<void>
  getHistory(): ReadonlyArray<SessionEvent>
}
