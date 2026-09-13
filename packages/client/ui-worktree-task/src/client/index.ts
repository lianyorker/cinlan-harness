/** Worktree Task Settings registration through generated Remote commands. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  WorktreeTaskSection,
  type WorktreeTaskSectionInjected,
} from './WorktreeTaskSection.tsx'
import type { WorktreeTaskId } from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import { en, NS, zh } from './locales.ts'

export type {
  WorktreeTaskSectionInjected,
  WorktreeTaskSectionProps,
} from './WorktreeTaskSection.tsx'
export type { WorktreeTaskKey } from './locales.ts'

/** Services used by the local Settings registration and generated namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.worktreeTasks']

function worktreeTaskId(value: string): WorktreeTaskId {
  return value as WorktreeTaskId
}

/**
 * Register the local-only Worktree Task Settings section.
 * @param ctx - Browser services for Remote access, slots, and localization.
 */
export function apply(ctx: Context): void {
  if (!ctx.remote.$host.isLoopback) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-worktree-task: dictionaries')
  const t = ctx.locale.bind(NS)
  const value = <T>(result: RemoteResult<T>): T => {
    if (result.ok) return result.value
    const error = result.error
    if (error.code === 'worktree-task/unavailable') throw new Error(t('errorUnavailable'))
    if (error.code === 'worktree-task/not-found') throw new Error(t('errorTaskNotFound'))
    if (error.code === 'worktree-task/busy') throw new Error(t('errorTaskBusy'))
    if (error.code === 'gateway/cancelled') throw new Error(t('errorCancelled'))
    throw new Error(t('errorGeneric', { message: error.message }))
  }
  const injected: WorktreeTaskSectionInjected = {
    create: async (request, signal) => value(await ctx.remote.worktreeTasks.create(request, signal)).task,
    list: async signal => value(await ctx.remote.worktreeTasks.list(signal)).items,
    activate: async (taskId, signal) => value(await ctx.remote.worktreeTasks.activate({ taskId: worktreeTaskId(taskId) }, signal)).task,
    hibernate: async (taskId, signal) => value(await ctx.remote.worktreeTasks.hibernate({ taskId: worktreeTaskId(taskId) }, signal)).task,
    archive: async (taskId, signal) => value(await ctx.remote.worktreeTasks.archive({ taskId: worktreeTaskId(taskId) }, signal)).task,
    delete: async (taskId, signal) => value(await ctx.remote.worktreeTasks.delete({ taskId: worktreeTaskId(taskId) }, signal)),
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'worktree-task',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: () => injected,
  }, WorktreeTaskSection))
}
