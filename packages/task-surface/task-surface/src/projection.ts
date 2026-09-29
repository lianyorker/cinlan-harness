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
  callId: z.string().transform(val => ToolCallId(val)),
  surfaceId: z.string().transform(val => TaskSurfaceId(val)),
})

const taskSurfaceStateSchema: z.ZodType<TaskSurfaceProjection> = z.object({
  active: taskSurfaceActiveSchema.nullable(),
})

/**
 * Pure projection unit maintaining the active Task Surface occurrence for one session.
 */
export const taskSurfaceProjectionDefinition: Omit<ProjectionDefinition<'taskSurface'>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<'taskSurface'>['wire']>
} = {
  key: 'taskSurface',
  stateVersion: 1,
  stateSchema: taskSurfaceStateSchema,

  init(): TaskSurfaceProjection {
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
        const callId = event.data.message.content[0].toolCallId
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
