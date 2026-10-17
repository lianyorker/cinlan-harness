/** Local memory sessions retain their own state, context, and event history. */
import { describe, expect, it } from 'vitest'
import { MemorySessionManager } from '../src/harness/session/manager.ts'
import type { SessionState } from '../src/harness/session/types.ts'

describe('local Harness sessions', () => {
  it('records every state and distinguishes resuming from starting', async () => {
    const manager = new MemorySessionManager()
    const session = await manager.createSession('project')
    expect(session.getState()).toBe('idle')
    expect(session.getHistory()).toEqual([])
    const states: readonly SessionState[] = ['active', 'paused', 'active', 'error', 'idle', 'completed']
    for (const state of states) {
      await session.setState(state)
      expect(session.getState()).toBe(state)
    }
    expect(session.getHistory().map(event => event.type)).toEqual(['started', 'paused', 'resumed', 'error', 'idle', 'completed'])
    for (const event of session.getHistory()) expect(event.timestamp).toBeInstanceOf(Date)
  })

  it('isolates sessions and preserves context fields across updates', async () => {
    const manager = new MemorySessionManager()
    const first = await manager.createSession('first')
    const second = await manager.createSession()
    await first.updateContext({ task: 'write', attempts: 0 })
    await first.updateContext({ attempts: 1 })
    const copy = first.getContext()
    copy.task = 'changed'
    expect(first.getContext()).toEqual({ task: 'write', attempts: 1 })
    expect(second.getContext()).toEqual({})
    await first.addEvent({ type: 'message_sent', data: { text: 'local test' } })
    expect(second.getHistory()).toEqual([])
    expect(await manager.getSession(first.id)).toBe(first)
    expect(await manager.listSessions()).toEqual([first.metadata, second.metadata])
    await manager.deleteSession(first.id)
    expect(await manager.getSession(first.id)).toBeUndefined()
    expect(await manager.listSessions()).toEqual([second.metadata])
    await manager.deleteSession(first.id)
  })
})
