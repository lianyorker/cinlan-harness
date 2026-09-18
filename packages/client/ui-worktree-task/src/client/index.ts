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
import { en, NS, zh } from './locales.ts'

export type {
  WorktreeTaskSectionInjected,
  WorktreeTaskSectionProps,
} from './WorktreeTaskSection.tsx'
export type { WorktreeTaskKey } from './locales.ts'

/** Services used by the local Settings registration and generated namespace. */
export const inject = ['settingsMetadata', 'slots', 'locale', 'remote', 'remote.worktreeTasks']

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
    settings: async signal => value(await ctx.remote.worktreeTasks.settings(signal)),
    updateSettings: async (request, signal) => value(await ctx.remote.worktreeTasks.updateSettings(request, signal)),
    review: async (taskId, signal) => value(await ctx.remote.worktreeTasks.review({ taskId }, signal)),
    activate: async (taskId, signal) => value(await ctx.remote.worktreeTasks.activate({ taskId }, signal)).task,
    hibernate: async (taskId, signal) => value(await ctx.remote.worktreeTasks.hibernate({ taskId }, signal)).task,
    archive: async (taskId, signal) => value(await ctx.remote.worktreeTasks.archive({ taskId }, signal)).task,
    delete: async (taskId, signal) => value(await ctx.remote.worktreeTasks.delete({ taskId }, signal)),
  }

  ctx.slots.inject('settings.section', function* () {
    yield ctx.settingsMetadata.registerSection({ sectionId: 'worktree-task', groupId: 'development' })
    yield ctx.settingsMetadata.registerItems('worktree-task', [
      { id: 'policy', anchorId: 'worktree-task-policy', title: () => t('policyTitle'), description: () => t('policyHelp') },
      { id: 'records', anchorId: 'worktree-task-records', title: () => t('recordsTitle'), description: () => t('recordsHelp'),
        keywords: () => [t('activate'), t('hibernate'), t('archive'), t('delete'), t('review'), t('checkoutPath'), t('sessions')] },
      { id: 'default-directory', anchorId: 'worktree-task-default-directory',
        title: () => t('defaultDirectory'), description: () => t('directoryHelp') },
      { id: 'default-base', anchorId: 'worktree-task-default-base',
        title: () => t('defaultBase'), description: () => t('defaultBaseHelp') },
      { id: 'default-setup', anchorId: 'worktree-task-default-setup',
        title: () => t('setupTitle'), description: () => t('setupHelp') },
      { id: 'default-cleanup', anchorId: 'worktree-task-default-cleanup',
        title: () => t('cleanupTitle'), description: () => t('cleanupHelp') },
      { id: 'create-workspace', anchorId: 'worktree-task-create-workspace',
        title: () => t('createWorkspaceId'), description: () => t('workspaceHelp') },
      { id: 'create-name', anchorId: 'worktree-task-create-name',
        title: () => t('createTaskName'), description: () => t('createNameHelp') },
      { id: 'create-source', anchorId: 'worktree-task-create-source',
        title: () => t('createSourcePath'), description: () => t('createSourceHelp') },
      { id: 'create-base', anchorId: 'worktree-task-create-base',
        title: () => t('createBaseRef'), description: () => t('createBaseHelp') },
      { id: 'create-issue', anchorId: 'worktree-task-create-issue',
        title: () => t('createLinkedIssue'), description: () => t('createIssueHelp') },
    ])
    yield ctx.slots.register({
      name: 'settings.section',
      id: 'worktree-task',
      order: 60,
      label: () => t('nav'),
      locale: NS,
      inject: () => injected,
    }, WorktreeTaskSection)
  })
}
