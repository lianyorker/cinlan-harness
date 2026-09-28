import { describe, expect, it } from 'vitest'
import { balancedCompletedTurnPrefix, frameAdvisor, mergeSideSessionBack, SIDECHAT_PLUGIN_ID } from '../src/index.ts'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'

describe('Side Session', () => {
  describe('balancedCompletedTurnPrefix', () => {
    it('returns empty array if no valid boundary', () => {
      const events: SessionEvent[] = [
        { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      ]
      expect(balancedCompletedTurnPrefix(events)).toEqual([])
    })

    it('returns up to the last turn/end', () => {
      const events: SessionEvent[] = [
        { type: 'session/created', seq: 0, time: 0, data: {} },
        { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
        { type: 'turn/end', seq: 2, time: 0, data: { turn: 1, reason: { kind: 'stop' } } },
        { type: 'turn/start', seq: 3, time: 0, data: { turn: 2 } },
      ]
      expect(balancedCompletedTurnPrefix(events).length).toBe(3)
      expect(balancedCompletedTurnPrefix(events)[2]?.type).toBe('turn/end')
    })

    it('returns up to session/created if no turn/end', () => {
      const events: SessionEvent[] = [
        { type: 'session/created', seq: 0, time: 0, data: {} },
        { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
      ]
      expect(balancedCompletedTurnPrefix(events).length).toBe(1)
      expect(balancedCompletedTurnPrefix(events)[0]?.type).toBe('session/created')
    })
  })

  describe('frameAdvisor', () => {
    it('appends context/message to child session', () => {
      let appendedType: string | undefined
      let appendedData: unknown
      const mockAgent = {
        session: {
          append: (type: string, data: unknown) => {
            appendedType = type
            appendedData = data
          },
        },
      } as unknown as Agent

      frameAdvisor(mockAgent, 'custom explanation')

      expect(appendedType).toBe('context/message')
      expect(appendedData).toEqual({
        message: 'custom explanation',
        source: { plugin: SIDECHAT_PLUGIN_ID },
      })
    })
  })

  describe('mergeSideSessionBack', () => {
    it('appends length-capped context/message to parent session', () => {
      let appendedType: string | undefined
      let appendedData: unknown
      const mockAgent = {
        session: {
          append: (type: string, data: unknown) => {
            appendedType = type
            appendedData = data
          },
        },
      } as unknown as Agent

      mergeSideSessionBack(mockAgent, 'child-123' as SessionId, 'short note')

      expect(appendedType).toBe('context/message')
      expect(appendedData).toEqual({
        message: 'Side session child-123 conclusion:\n\nshort note',
        source: { plugin: SIDECHAT_PLUGIN_ID },
      })
    })

    it('truncates notes exceeding the length cap', () => {
      let appendedData: unknown
      const mockAgent = {
        session: {
          append: (_type: string, data: unknown) => {
            appendedData = data
          },
        },
      } as unknown as Agent

      const longNote = 'A'.repeat(5000)
      mergeSideSessionBack(mockAgent, 'child-123' as SessionId, longNote)

      const record = appendedData as { message: string }
      expect(record.message).toContain('Side session child-123 conclusion:\n\n')
      expect(record.message).toContain('A'.repeat(4000))
      expect(record.message).toContain('…\n\n(Note truncated)')
      expect(record.message.length).toBeLessThan(4100)
    })
  })
})
