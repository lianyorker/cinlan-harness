import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import ToolTaskSurface, { inject, name } from '../src/index.ts'

describe('tool-task-surface loader composition', () => {
  it('exposes metadata on plugin entrypoint', () => {
    expect(name).toBe('tool-task-surface')
    expect(inject).toEqual(['tools', 'sessionProjections'])
    expect(typeof ToolTaskSurface.apply).toBe('function')
  })

  it('registers tool on ctx.tools and unregisters on fiber disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)

    const fiber = await ctx.plugin(ToolTaskSurface)
    expect(ctx.tools.get('show_task_surface')).toBeDefined()

    await fiber.dispose()
    expect(ctx.tools.get('show_task_surface')).toBeUndefined()
  })
})
