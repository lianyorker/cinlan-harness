/** UI Host loading leaves the shared Git namespace to its owner plugin. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import * as plugin from '../src/index.ts'

it('loads as an empty named Host entry without requiring or registering Settings', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  expect(Object.keys(plugin)).toEqual(['apply'])
  await ctx.plugin(plugin)
  expect(ctx.get('settings')).toBeUndefined()
})
