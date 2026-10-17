/** Session manager implementation */

import { randomUUID } from 'node:crypto'
import type { Session, SessionEvent, SessionManager, SessionMetadata, SessionState } from './types.ts'

/** In-memory session implementation */
class MemorySession implements Session {
  readonly id: string
  readonly metadata: SessionMetadata
  private state: SessionState = 'idle'
  private context: Record<string, unknown> = {}
  private history: SessionEvent[] = []

  constructor(id: string, metadata: SessionMetadata) {
    this.id = id
    this.metadata = metadata
  }

  getState(): SessionState {
    return this.state
  }

  async setState(state: SessionState): Promise<void> {
    const events = {
      idle: 'idle',
      active: this.state === 'paused' ? 'resumed' : 'started',
      paused: 'paused',
      error: 'error',
      completed: 'completed',
    } as const satisfies Record<SessionState, SessionEvent['type']>
    this.state = state
    await this.addEvent({ type: events[state] })
  }

  getContext(): Record<string, unknown> {
    return { ...this.context }
  }

  updateContext(updates: Record<string, unknown>): Promise<void> {
    this.context = { ...this.context, ...updates }
    return Promise.resolve()
  }

  addEvent(event: Omit<SessionEvent, 'timestamp'>): Promise<void> {
    this.history.push({ ...event, timestamp: new Date() })
    return Promise.resolve()
  }

  getHistory(): ReadonlyArray<SessionEvent> {
    return [...this.history]
  }
}

/** Session manager implementation */
export class MemorySessionManager implements SessionManager {
  private sessions = new Map<string, MemorySession>()

  createSession(projectPath?: string): Promise<Session> {
    const id = randomUUID()
    const now = new Date()
    const metadata: SessionMetadata = {
      id,
      projectPath,
      createdAt: now,
      updatedAt: now,
    }
    const session = new MemorySession(id, metadata)
    this.sessions.set(id, session)
    return Promise.resolve(session)
  }

  getSession(id: string): Promise<Session | undefined> {
    return Promise.resolve(this.sessions.get(id))
  }

  listSessions(): Promise<ReadonlyArray<SessionMetadata>> {
    return Promise.resolve(Array.from(this.sessions.values()).map(s => s.metadata))
  }

  deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    return Promise.resolve()
  }
}
