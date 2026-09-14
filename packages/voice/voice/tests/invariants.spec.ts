import { Context } from '@deepseek-ai/cordis'
import Invariants from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('voice invariant companion', () => {
  it('registers and disposes package ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(Invariants)
    const dispose = await invariant.apply(ctx)
    expect(invariant.name).toBe('voice-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    dispose()
    await ctx.fiber.dispose()
  })
})
