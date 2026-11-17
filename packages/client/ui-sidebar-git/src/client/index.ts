/** Git review tab registration plugin, browser half. */

// Type-only: the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@cinlan/api-sidebar-git-controller/remote'
import type {} from '@cinlan/api-git-ai-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { GitAiGenerateResult, GitAiSelectionId } from '@cinlan/api-git-ai-controller/types'
import { GIT_ID, gitDefinition } from './definition.tsx'
import { GitReviewBody, type GitReviewBodyInjected } from './GitReviewBody.tsx'
import { GitTitle } from './GitTitle.tsx'
import { en, zh } from './locales.ts'

export type { GitReviewBodyInjected, GitReviewBodyProps } from './GitReviewBody.tsx'
export type { GitReviewBodyInjected as SidebarGitInjected } from './GitReviewBody.tsx'

const NS = 'sidebarGitReview'

/** Required services: the tab registry, the seats, and both Remote namespaces. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.sidebarGit', 'remote.gitAi']

/**
 * Register the Git review page as a right-Sidebar tab type.
 * @param ctx - browser root context carrying the registry and the Remote faces.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-git: dictionaries')
  const t = ctx.locale.bind(NS)

  const value = <T>(result: RemoteResult<T>): T => {
    if (result.ok) return result.value
    throw new Error(`${result.error.code}: ${result.error.message}`)
  }

  const face = (sessionId: SessionId): GitReviewBodyInjected => ({
    status: async signal => value(await ctx.remote.sidebarGit.status({ sessionId }, signal)),
    diff: async (staged, signal) => value(await ctx.remote.sidebarGit.diff({ sessionId, staged }, signal)),
    compare: async signal => value(await ctx.remote.sidebarGit.compare({ sessionId }, signal)),
    generate: async (action, selection: GitAiSelectionId, signal) => {
      const remote = ctx.remote as unknown as {
        gitAi: { generate: (request: unknown, signal: AbortSignal) => Promise<RemoteResult<GitAiGenerateResult>> }
      }
      return value(await remote.gitAi.generate({ sessionId, action, selection }, signal))
    },
  })

  ctx.effect(() => ctx.sidebarRightTabs.register(gitDefinition(t)), 'ui-sidebar-git: git type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: GIT_ID, locale: NS, inject: (sessionId: SessionId) => face(sessionId) },
    GitReviewBody,
  )), 'ui-sidebar-git: git tab body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab.title', key: GIT_ID, locale: NS,
      inject: () => ({ t }) as { t: (key: never) => string } },
    GitTitle as never,
  )), 'ui-sidebar-git: git tab title')
}
