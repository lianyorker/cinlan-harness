/**
 * Browser-safe domain model, branded IDs, projection unit, and Host coordination service for Task Surface.
 * @module @deepseek-ai/dsh-task-surface
 */

import type { Context } from '@deepseek-ai/cordis'
import { TaskSurfaceServiceImpl } from './service.ts'

export * from './types.ts'
export * from './model.ts'
export * from './projection.ts'
export * from './service.ts'

export const name = 'task-surface'
export const inject = ['sessionProjections', 'sessions']

/**
 * Apply the Task Surface plugin, installing the host service and projection definition.
 * @param ctx - registrant Cordis context carrying sessionProjections.
 */
export function apply(ctx: Context): void {
  ctx.plugin(TaskSurfaceServiceImpl)
}

export default TaskSurfaceServiceImpl
