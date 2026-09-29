import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { apply, TaskSurfaceServiceImpl, name, inject } from '../src/index.ts'

describe('TaskSurface loader composition', () => {
  it('exposes metadata on plugin entrypoint', () => {
    expect(name).toBe('task-surface')
    expect(inject).toEqual(['sessionProjections', 'sessions'])
    expect(TaskSurfaceServiceImpl.inject).toEqual(['sessionProjections', 'sessions'])
  })

  it('installs service on ctx and cleans up on fiber disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)

    const fiber = await ctx.plugin(apply)
    expect(ctx.taskSurface).toBeDefined()

    await fiber.dispose()
    expect(ctx.taskSurface).toBeUndefined()
  })
})
