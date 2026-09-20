/** Plan-mode controls, persistent Chat cards, and Session-backed sidebar previews. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-plan-mode/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-user-questions/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { extractMarkdownPlainText, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { PlanCards, PlanReviewOpen, type PlanOpenInjected, type PlanReviewOpenInjected } from './PlanCard.tsx'
import { PlanPreview, PlanTitle } from './PlanPreview.tsx'
import { BetterPlanPreview, type ReadPlan } from './BetterPlanPreview.tsx'
import { planDefinition } from './plan-definition.ts'
import { planResourceProvider } from './plan-resource.ts'
import { planAddress, parsePlanAddress, type PlanDocument } from './plan.ts'
import { isReviewPreviewAddress, reviewPreviewAddress } from './review-preview.ts'
import { createPlanReviewStore } from './review-store.ts'
import { PlanChip } from './PlanModeControl.tsx'
import { en, zh, type PlanKey } from './locales.ts'

export type { PlanKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plan controls, cards, and preview copy. */
    plan: PlanKey
  }
}

const NS = 'plan'
const PREVIEW_ID = '@deepseek-ai/dsh-client-ui-plan'

/** Injected command action for the composer plan chip. */
export interface PlanChipInjected {
  /** Leave plan mode; return null on admission or a user-visible failure line. */
  exitPlanMode: () => Promise<string | null>
}

/** The chip stays usable without a sidebar or a history provider. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Register plan controls and attach previews to available public sidebar services.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-plan: dictionaries')
  ctx.slots.inject('conversation.input.plan', () => ctx.slots.register({
    name: 'conversation.input.plan', locale: NS,
    inject: (sessionId: SessionId): PlanChipInjected => ({
      exitPlanMode: async () => {
        const result = await ctx.remote.commands.execute(sessionId, '/plan off', [])
        if (!result.ok) return result.error.message + ' (' + result.error.code + ')'
        if (result.value === undefined) return 'unknown command: /plan off'
        return null
      },
    }),
  }, PlanChip))
  ctx.inject(['remote.session', 'sessions', 'uiConversation', 'resources'], previews)
}

/** Attach durable projection once and let each sidebar own its registrations. */
function previews(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const provider = planResourceProvider(ctx.remote.session)
  ctx.effect(() => ctx.uiConversation.events.register(planDefinition), 'ui-plan: conversation definition')
  ctx.effect(() => ctx.resources.register(provider), 'ui-plan: resources')
  const reviewStore = createPlanReviewStore()
  const reviewWindow = randomUUID()
  type Navigate = (sessionId: SessionId, address: string, document?: PlanDocument) => void
  const entries = (owner: ClientContext, navigate: Navigate, priority: number): void => {
    const open = (sessionId: SessionId): PlanOpenInjected => ({
      openPlan: (callId) => {
        const child = ctx.sessions.subagentAddress(sessionId)
        const session = child === undefined ? { kind: 'session' as const, sessionId } : { kind: 'subagent' as const, ...child }
        navigate(sessionId, planAddress({ session, callId }))
      },
    })
    owner.slots.inject('conversation.chat.turnCards', () => owner.slots.register({
      name: 'conversation.chat.turnCards', id: PREVIEW_ID, priority, locale: NS, inject: open,
    }, PlanCards))
    owner.slots.inject('conversation.plan-review.actions', () => owner.slots.register({
      name: 'conversation.plan-review.actions', id: PREVIEW_ID, priority, locale: NS, store: reviewStore,
      inject: (sessionId: SessionId): PlanReviewOpenInjected => ({
        openReview: (review, requestKey) => {
          if (review.callId !== undefined) { open(sessionId).openPlan(review.callId); return }
          navigate(sessionId, reviewPreviewAddress(sessionId, reviewWindow + ':' + requestKey), {
            markdown: review.plan, title: extractMarkdownPlainText(review.plan, { mode: 'first-line' }),
          })
        },
      }),
    }, PlanReviewOpen))
  }
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (sidebar) => {
    sidebar.effect(() => sidebar.sidebarRightTabs.register({
      id: PREVIEW_ID, kind: 'plan', patterns: ['dsh-resource://plan/**', 'dsh-resource://plan-review/**'], priority: 'builtin',
      canOpen: address => parsePlanAddress(address) !== undefined || isReviewPreviewAddress(address),
      title: () => t('preview.title'),
    }), 'ui-plan: sidebar type')
    entries(sidebar, (sessionId, address, document) => {
      if (document === undefined) sidebar.sidebarRight.openResourceIn(sessionId, address)
      else sidebar.sidebarRight.openResourceIn(sessionId, address, { params: { planReview: document } })
    }, 0)
    sidebar.slots.inject('sidebar.right.pane.tab', () => sidebar.slots.register({
      name: 'sidebar.right.pane.tab', key: PREVIEW_ID, locale: NS,
    }, PlanPreview))
    sidebar.slots.inject('sidebar.right.pane.tab.title', () => sidebar.slots.register({
      name: 'sidebar.right.pane.tab.title', key: PREVIEW_ID,
    }, PlanTitle))
  })
  ctx.inject(['betterSidebar'], (sidebar) => {
    const temporary = new Map<string, PlanDocument>()
    const lifetime = new AbortController()
    sidebar.effect(() => () => { lifetime.abort(); temporary.clear() }, 'ui-plan: local preview lifetime')
    const readPlan: ReadPlan = async (address, signal) => {
      if (isReviewPreviewAddress(address)) {
        const document = temporary.get(address)
        return document === undefined ? undefined : { ok: true, value: document }
      }
      for await (const result of provider.open(address, { signal: AbortSignal.any([signal, lifetime.signal]) })) return result
      return undefined
    }
    sidebar.effect(() => sidebar.betterSidebar.registerTab({
      id: PREVIEW_ID, title: () => t('preview.title'), hidden: true,
      icon: size => createElement(IconEditOutline16, { size }),
      dedupeKey: tab => tab.path,
      component: ({ tab }) => createElement(BetterPlanPreview, { address: tab.path ?? '', readPlan, t }),
    }), 'ui-plan: local sidebar type')
    entries(sidebar, (sessionId, address, document) => {
      if (document !== undefined) temporary.set(address, document)
      sidebar.betterSidebar.openTab({ type: PREVIEW_ID, id: address, path: address, title: document?.title ?? t('preview.title') }, { sessionId })
    }, -100)
  })
}
