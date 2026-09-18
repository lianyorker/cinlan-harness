import { describe, expect, it } from 'vitest'
import { accountTurn, addCounts, emptyCounts, ownTurns, turnCounts } from '../src/aggregate.ts'
import { completeTurn, event, message, usage } from './fixtures.ts'

function counts(events = completeTurn()) {
  const turn = [...ownTurns(events, 0)][0]!
  return turnCounts(turn, accountTurn(turn))
}

describe('own-Turn accounting partitions', () => {
  it('keeps a missing closure separate from the next own Turn', () => {
    const turns = [...ownTurns([
      event(0, 'session/end-seed', {}),
      event(1, 'turn/start', { turn: 1 }),
      event(2, 'step/start', { turn: 1, step: 1 }),
      ...completeTurn(3, 2),
    ], 0)]
    expect(turns).toHaveLength(2)
    expect(accountTurn(turns[0]!)).toBeUndefined()
    expect(accountTurn(turns[1]!)?.totalTokens).toBe(170)
  })

  it('recognizes every available inherited-tail lifecycle beginning as unknown', () => {
    for (const tail of [
      [event(1, 'step/start', { turn: 1, step: 1 })],
      [message(1)],
      [event(1, 'assistant/attempt', { turn: 1, step: 1, stream: [] })],
      [event(1, 'turn/end', { turn: 1, reason: { kind: 'completed' } })],
    ]) {
      const turn = [...ownTurns([event(0, 'turn/start', { turn: 1 }), ...tail], 1)][0]!
      expect(turn.inherited).toBe(true)
      expect(accountTurn(turn)).toBeUndefined()
    }
  })

  it('sums complete optional buckets without adding reasoning twice', () => {
    const full = counts(completeTurn(0, 1, {
      inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 2, reasoningTokens: 3, totalTokens: 127,
    }))
    expect(addCounts(full, full).tokens).toEqual({
      uncachedInputTokens: 200, outputTokens: 40, cacheReadTokens: 10, cacheWriteTokens: 4, reasoningTokens: 6, totalTokens: 254,
    })
    const incompleteBuckets = counts(completeTurn(0, 1, { inputTokens: 100, outputTokens: 20, totalTokens: 170 }))
    const expected = { uncachedInputTokens: 200, outputTokens: 40, totalTokens: 297 }
    expect(addCounts(full, incompleteBuckets).tokens).toEqual(expected)
    expect(addCounts(incompleteBuckets, full).tokens).toEqual(expected)
    expect(addCounts(full, emptyCounts()).tokens).toEqual(full.tokens)
  })

  it('rejects an unsafe combined subtotal even when each Turn is independently exact', () => {
    const enormous = counts(completeTurn(0, 1, {
      inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER,
    }))
    expect(() => addCounts(enormous, counts())).toThrow('exact integer range')
  })

  it('preserves complete read-cache data only when every known Turn has it', () => {
    const reported = counts(completeTurn(0, 1, usage()))
    const omitted = counts(completeTurn(0, 1, { inputTokens: 100, outputTokens: 20, totalTokens: 170 }))
    expect(addCounts(reported, reported).tokens?.cacheReadTokens).toBe(100)
    expect(addCounts(reported, omitted).tokens?.cacheReadTokens).toBeUndefined()
  })
})
