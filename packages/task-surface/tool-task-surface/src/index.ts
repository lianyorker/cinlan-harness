/**
 * Model-facing Consumer of the Task Surface capability seam.
 * Exposes `show_task_surface`, concluding the current turn at the human interaction barrier.
 *
 * @module @deepseek-ai/dsh-tool-task-surface
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  parseTaskSurfaceModel,
  TaskSurfaceId,
  type TaskSurfaceModelV1,
  type TaskSurfacePresentationMeta,
} from '@deepseek-ai/dsh-task-surface'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-task-surface'
export const inject = ['tools', 'sessionProjections']

/** Canonical output of the `show_task_surface` tool. */
export interface ShowTaskSurfaceOutput {
  readonly surfaceId: string
  readonly model: TaskSurfaceModelV1
}

const description =
  'Present a structured, interactive Task Surface to the user for review, configuration, or decision-making. '
  + 'The surface ends the agent turn, presenting declarative sections and input fields. '
  + 'The user can submit field values or dismiss the surface to continue the conversation.'

/**
 * Register the `show_task_surface` tool on `ctx.tools`.
 * @param ctx - registrant Cordis context carrying tools and sessionProjections.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'show_task_surface',
      description,
      parameters: {
        model: {
          type: 'json',
          required: true,
          description:
            'Declarative Task Surface v1 model defining title, sections, blocks, optional input fields, and submit button.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            surfaceId: { type: 'string', required: true },
            model: { type: 'json', required: true },
          },
        },
        render: (_args, value): ContentBlock[] => {
          const val = value as unknown as ShowTaskSurfaceOutput
          return [{
            type: 'text',
            text: `Opened Task Surface "${val.model.title}" (${val.surfaceId}). The user can fill out the surface or bypass it with an ordinary message.`,
          }]
        },
        presentationMeta: (_args, value): TaskSurfacePresentationMeta => {
          const val = value as unknown as ShowTaskSurfaceOutput
          return {
            kind: 'dsh/task-surface',
            version: 1,
            surfaceId: TaskSurfaceId(val.surfaceId),
            model: val.model,
          }
        },
      },
      execute(args, exec) {
        if (!exec.agent) {
          throw new Error('show_task_surface requires an owning agent session')
        }

        const session = exec.agent.session
        const projection = ctx.sessionProjections.stateOf(session, 'taskSurface')
        if (projection && projection.active !== null) {
          throw new Error(
            `a task surface is already active for this session (${projection.active.surfaceId})`,
          )
        }

        const normalizedModel = parseTaskSurfaceModel(args.model)
        const surfaceId = TaskSurfaceId(randomUUID())

        exec.concludeTurn()

        return Promise.resolve({
          surfaceId,
          model: normalizedModel,
        })
      },
      presentCall: args => ({
        card: 'generic',
        title: 'Show task surface',
        kind: 'other',
        rawInput: args.model,
      }),
    }),
  )
}

export default {
  name,
  inject,
  apply,
}
