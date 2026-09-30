import { describe, expect, it } from 'vitest'
import { balancedCompletedTurnPrefix, frameAdvisor, mergeSideSessionBack, SIDECHAT_PLUGIN_ID } from '../src/index.ts'
import { SessionSeq, type SessionEvent, type SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

describe('Side Session', () => {
  describe('balancedCompletedTurnPrefix', () => {
    it('returns empty array if no valid boundary', () => {
      const events: SessionEvent[] = [
        { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
      ]
      expect(balancedCompletedTurnPrefix(events)).toEqual([])
    })

    it('returns up to the last turn/end', () => {
      const events: SessionEvent[] = [
        { type: 'turn/start', seq: SessionSeq(0), time: 0, data: { turn: 1 } },
        { type: 'turn/end', seq: SessionSeq(1), time: 0, data: { turn: 1, reason: { kind: 'completed' } } },
        { type: 'turn/start', seq: SessionSeq(2), time: 0, data: { turn: 2 } },
      ]
      expect(balancedCompletedTurnPrefix(events).length).toBe(2)
      expect(balancedCompletedTurnPrefix(events)[1]?.type).toBe('turn/end')
    })
  })

  describe('frameAdvisor', () => {
    it('injects advisor message to child agent', () => {
      let injectedMessage: UserMessage | undefined
      const mockAgent = {
        inject: (message: UserMessage) => {
          injectedMessage = message
        },
      } as unknown as Agent

      frameAdvisor(mockAgent, 'custom explanation')

      expect(injectedMessage).toBeDefined()
      expect(injectedMessage?.source).toEqual({ kind: 'side-session', plugin: SIDECHAT_PLUGIN_ID })
      expect(injectedMessage?.content).toEqual([{ type: 'text', text: 'custom explanation' }])
    })
  })

  describe('mergeSideSessionBack', () => {
    it('injects length-capped message to parent agent', () => {
      let injectedMessage: UserMessage | undefined
      const mockAgent = {
        inject: (message: UserMessage) => {
          injectedMessage = message
        },
      } as unknown as Agent

      mergeSideSessionBack(mockAgent, 'child-123' as SessionId, 'short note')

      expect(injectedMessage).toBeDefined()
      expect(injectedMessage?.source).toEqual({ kind: 'side-session', plugin: SIDECHAT_PLUGIN_ID })
      expect(injectedMessage?.content).toEqual([{
        type: 'text',
        text: 'Side session child-123 conclusion:\n\nshort note',
      }])
    })

    it('truncates notes exceeding the length cap', () => {
      let injectedMessage: UserMessage | undefined
      const mockAgent = {
        inject: (message: UserMessage) => {
          injectedMessage = message
        },
      } as unknown as Agent

      const longNote = 'A'.repeat(5000)
      mergeSideSessionBack(mockAgent, 'child-123' as SessionId, longNote)

      expect(injectedMessage).toBeDefined()
      const block = injectedMessage?.content[0]
      if (block?.type !== 'text') throw new Error('expected text block')
      expect(block.text).toContain('Side session child-123 conclusion:\n\n')
      expect(block.text).toContain('A'.repeat(4000))
      expect(block.text).toContain('…\n\n(Note truncated)')
      expect(block.text.length).toBeLessThan(4100)
    })
  })
})
