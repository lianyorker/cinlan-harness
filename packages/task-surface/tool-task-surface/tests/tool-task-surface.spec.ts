import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { TaskSurfaceId, TaskSurfaceServiceImpl, TaskSurfaceValidationError, type TaskSurfaceModelV1 } from '@deepseek-ai/dsh-task-surface'
import ToolRuntime, { type ToolRunContext } from '@deepseek-ai/dsh-tools'
import ToolTaskSurfacePlugin from '../src/index.ts'

describe('tool-task-surface show_task_surface', () => {
  async function createHarness() {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(TaskSurfaceServiceImpl)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(ToolTaskSurfacePlugin)

    const session = ctx.sessions.create()
    const agent: Agent = {
      id: session.id,
      session,
    } as unknown as Agent

    return { ctx, session, agent }
  }

  const sampleModel = {
    version: 1,
    title: 'Interactive Review',
    sections: [
      {
        id: 'sec-1',
        blocks: [{ kind: 'markdown', text: 'Please review the proposed plan' }],
      },
    ],
    fields: [
      { kind: 'text', id: 'feedback', label: 'Feedback', required: true },
    ],
    submit: { label: 'Submit Feedback' },
  }

  it('registers show_task_surface tool with complete metadata and presentation', async () => {
    const { ctx } = await createHarness()
    const tool = ctx.tools.get('show_task_surface')
    expect(tool).toBeDefined()
    expect(tool?.name).toBe('show_task_surface')
    expect(tool?.description).toContain('Task Surface')

    // presentCall
    const callView = tool?.presentCall?.({ model: sampleModel })
    expect(callView).toEqual({
      card: 'generic',
      title: 'Show task surface',
      kind: 'other',
      rawInput: sampleModel,
    })

    // output render
    const rendered = tool?.output.render?.(
      { model: sampleModel },
      { surfaceId: 'surf-xyz', model: sampleModel },
    )
    expect(rendered).toEqual([
      {
        type: 'text',
        text: 'Opened Task Surface "Interactive Review" (surf-xyz). The user can fill out the surface or bypass it with an ordinary message.',
      },
    ])

    // output presentationMeta
    const meta = tool?.output.presentationMeta?.(
      { model: sampleModel },
      { surfaceId: 'surf-xyz', model: sampleModel },
    )
    expect(meta).toEqual({
      kind: 'dsh/task-surface',
      version: 1,
      surfaceId: TaskSurfaceId('surf-xyz'),
      model: sampleModel,
    })
  })

  it('rejects execution when no agent session is present', async () => {
    const { ctx } = await createHarness()
    const tool = ctx.tools.get('show_task_surface')!

    const exec = {
      concludeTurn: vi.fn(),
    } as unknown as ToolRunContext

    await expect(tool.execute({ model: sampleModel }, exec)).rejects.toThrow(
      'show_task_surface requires an owning agent session',
    )
  })

  it('executes successfully, concludes turn, and returns normalized model', async () => {
    const { ctx, agent } = await createHarness()
    const tool = ctx.tools.get('show_task_surface')!

    const concludeTurn = vi.fn()
    const exec = {
      agent,
      concludeTurn,
    } as unknown as ToolRunContext

    const result = (await tool.execute({ model: sampleModel }, exec)) as {
      surfaceId: string
      model: TaskSurfaceModelV1
    }

    expect(concludeTurn).toHaveBeenCalledTimes(1)
    expect(result.surfaceId).toBeDefined()
    expect(result.model.title).toBe('Interactive Review')
    expect(result.model.sections).toHaveLength(1)
    expect(result.model.fields).toHaveLength(1)
  })

  it('rejects execution when an existing task surface is already active in session', async () => {
    const { ctx, session, agent } = await createHarness()
    const tool = ctx.tools.get('show_task_surface')!

    // Mock active projection in session
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: ToolCallId('call-prior'), content: [] }],
      },
      meta: {
        kind: 'dsh/task-surface',
        version: 1,
        surfaceId: TaskSurfaceId('existing-surf'),
        model: sampleModel,
      },
    }, { surfaceOp: 'append' })

    const exec = {
      agent,
      concludeTurn: vi.fn(),
    } as unknown as ToolRunContext

    await expect(tool.execute({ model: sampleModel }, exec)).rejects.toThrow(
      'a task surface is already active for this session (existing-surf)',
    )
  })

  it('rejects execution when model violates domain constraints', async () => {
    const { ctx, agent } = await createHarness()
    const tool = ctx.tools.get('show_task_surface')!

    const exec = {
      agent,
      concludeTurn: vi.fn(),
    } as unknown as ToolRunContext

    await expect(
      tool.execute({ model: { version: 2 } }, exec),
    ).rejects.toThrow(TaskSurfaceValidationError)
  })
})
