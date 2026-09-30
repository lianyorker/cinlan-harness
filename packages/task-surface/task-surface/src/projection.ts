/**
 * Session projection unit for active Task Surface identity tracking.
 * @module @deepseek-ai/dsh-task-surface/projection
 */

import { z } from 'zod'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { TaskSurfaceId } from './types.ts'
import type { TaskSurfaceProjection } from './types.ts'

const taskSurfaceActiveSchema = z.object({
  callId: z.custom<ToolCallId>(val => typeof val === 'string'),
  surfaceId: z.custom<TaskSurfaceId>(val => typeof val === 'string'),
})

const taskSurfaceStateSchema = z.object({
  active: taskSurfaceActiveSchema.nullable(),
}) as unknown as z.ZodType<TaskSurfaceProjection>

/**
 * Pure projection unit maintaining the active Task Surface occurrence for one session.
 */
export const taskSurfaceProjectionDefinition: Omit<ProjectionDefinition<'taskSurface'>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<'taskSurface'>['wire']>
} = {
  key: 'taskSurface',
  stateVersion: 1,
  stateSchema: taskSurfaceStateSchema,

  init(_header?: unknown, _inheritedEventCount?: unknown): TaskSurfaceProjection {
    return { active: null }
  },

  apply(state: TaskSurfaceProjection, event: SessionEvent): TaskSurfaceProjection {
    if (event.type === 'tool/result') {
      const meta = event.data.meta as Record<string, unknown> | undefined
      if (
        meta !== undefined &&
        typeof meta === 'object' &&
        meta['kind'] === 'dsh/task-surface' &&
        typeof meta['surfaceId'] === 'string'
      ) {
        const callId = event.data.message.toolCallId ?? (event.data.message.content[0] as unknown as { toolCallId: ToolCallId })?.toolCallId
        const surfaceId = TaskSurfaceId(meta['surfaceId'])
        return { active: { callId, surfaceId } }
      }
    }

    if (event.type === 'task-surface/dismissed') {
      const dismissedSurfaceId = event.data.surfaceId
      if (state.active !== null && state.active.surfaceId === dismissedSurfaceId) {
        return { active: null }
      }
    }

    if (event.type === 'user/message') {
      if (state.active !== null) {
        // Any user message (either matching submission or prompt bypass) closes the open surface.
        return { active: null }
      }
    }

    return state
  },

  wire: {
    viewSchema: taskSurfaceStateSchema,
    view(state: TaskSurfaceProjection): TaskSurfaceProjection {
      return state
    },
  },
}
