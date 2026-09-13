/** Workspace Isolation Settings registration through generated Remote commands. */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  WorkspaceIsolationSection,
  type WorkspaceIsolationSectionInjected,
} from './WorkspaceIsolationSection.tsx'
import { en, NS, zh } from './locales.ts'

export type {
  WorkspaceIsolationSectionInjected,
  WorkspaceIsolationSectionProps,
} from './WorkspaceIsolationSection.tsx'
export type { WorkspaceIsolationKey } from './locales.ts'

/** Services used by the local Settings registration and generated namespace. */
export const inject = ['slots', 'locale', 'remote', 'remote.workspaceIsolation']

/**
 * Register the local-only Workspace Isolation Settings section.
 * @param ctx - Browser services for Remote access, slots, and localization.
 */
export function apply(ctx: Context): void {
  if (!ctx.remote.$host.isLoopback) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-isolation: dictionaries')
  const t = ctx.locale.bind(NS)
  const value = <T>(result: RemoteResult<T>): T => {
    if (result.ok) return result.value
    const error = result.error
    if (error.code === 'workspace-isolation/unavailable') throw new Error(t('errorUnavailable'))
    if (error.code === 'workspace-isolation/busy') throw new Error(t('errorBusy'))
    if (error.code === 'workspace-isolation/conflict') throw new Error(t('errorConflict'))
    if (error.code === 'gateway/cancelled') throw new Error(t('errorCancelled'))
    throw new Error(t('errorGeneric', { message: error.message }))
  }
  const injected: WorkspaceIsolationSectionInjected = {
    list: async signal => value(await ctx.remote.workspaceIsolation.list(signal)).items,
    activate: async (leaseId, signal) => {
      value(await ctx.remote.workspaceIsolation.activate({ leaseId }, signal))
    },
    hibernate: async (leaseId, signal) => {
      value(await ctx.remote.workspaceIsolation.hibernate({ leaseId }, signal))
    },
    inspect: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.inspect({ leaseId }, signal)).inspection,
    compare: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.compare({ leaseId }, signal)).comparison,
    merge: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.merge({ leaseId }, signal)),
    cherryPick: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.cherryPick({ leaseId }, signal)),
    exportPatch: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.exportPatch({ leaseId }, signal)),
    teardown: async (leaseId, signal) =>
      value(await ctx.remote.workspaceIsolation.teardown({ leaseId }, signal)),
    prune: async signal => value(await ctx.remote.workspaceIsolation.prune(signal)).pruned,
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'workspace-isolation',
    order: 15,
    label: () => t('nav'),
    locale: NS,
    inject: () => injected,
  }, WorkspaceIsolationSection))
}
