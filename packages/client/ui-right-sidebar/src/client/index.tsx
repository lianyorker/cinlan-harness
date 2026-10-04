/** Register Review, Tasks, and Browser page types in the production sidebar. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceIsolationLeaseId } from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import { BrowserBody } from './BrowserBody.tsx'
import { ReviewBody, type ReviewBodyInjected } from './ReviewBody.tsx'
import { TasksBody, type TasksBodyInjected } from './TasksBody.tsx'
import { browserTabDefinition, reviewTabDefinition, tasksTabDefinition, BROWSER_TAB_ID, REVIEW_TAB_ID, TASKS_TAB_ID } from './definitions.ts'
import { en, NS, zh } from './locales.ts'

export const name = 'ui-right-sidebar'
export const inject = ['sidebarRightTabs', 'slots', 'locale', 'remote', 'remote.worktreeTasks', 'remote.workspaceIsolation']

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-right-sidebar: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(reviewTabDefinition(t)), 'ui-right-sidebar: review type')
  ctx.effect(() => ctx.sidebarRightTabs.register(tasksTabDefinition(t)), 'ui-right-sidebar: tasks type')
  ctx.effect(() => ctx.sidebarRightTabs.register(browserTabDefinition(t)), 'ui-right-sidebar: browser type')

  const tasks = (_sessionId: string): TasksBodyInjected => ({
    list: async () => unwrap(await ctx.remote.worktreeTasks.list()),
    activate: async taskId => { unwrap(await ctx.remote.worktreeTasks.activate({ taskId })) },
    hibernate: async taskId => { unwrap(await ctx.remote.worktreeTasks.hibernate({ taskId })) },
  })
  const review = (_sessionId: string): ReviewBodyInjected => ({
    list: async () => unwrap(await ctx.remote.workspaceIsolation.list()),
    compare: async (leaseId: WorkspaceIsolationLeaseId) => unwrap(await ctx.remote.workspaceIsolation.compare({ leaseId })),
  })

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: REVIEW_TAB_ID, locale: NS, inject: review,
  }, ReviewBody)), 'ui-right-sidebar: review body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: TASKS_TAB_ID, locale: NS, inject: tasks,
  }, TasksBody)), 'ui-right-sidebar: tasks body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: BROWSER_TAB_ID, locale: NS,
  }, BrowserBody)), 'ui-right-sidebar: browser body')
}
