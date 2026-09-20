/** Turn file summaries and comparison tabs registered through the existing client extensions. */
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BetterSidebarService, TabDescriptor } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { changesReviewAddress, parseChangesReviewAddress, type ChangesReviewCoordinates } from '../changes.ts'
import { ChangesSummaryStore } from './changes-summary.ts'
import { ChangesReader } from './review-read.ts'
import { DeliverablesTail, type DeliverablesInjected } from './Deliverables.tsx'
import { ProducedFiles } from './ProducedFiles.tsx'
import { PresentRow } from './PresentRow.tsx'
import { PresentedOpenController } from './present-open.ts'
import { ReviewPanel } from './ReviewPanel.tsx'
import { ReviewTab } from './ReviewTab.tsx'
import { CHANGES_REVIEW_ID, CHANGES_REVIEW_KIND, changesReviewDefinition } from './review-definition.ts'
import { en, NS, zh, type DeliverablesKey } from './locales.ts'
import { deliverablesDefinition, presentedForClosing, producedFileMentions, selectProducedFiles } from './turn-deliverables.ts'

// better-sidebar exposes its optional service through its public client API.
declare module '@deepseek-ai/cordis' {
  interface Context { betterSidebar: BetterSidebarService }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Changed-file cards, comparisons, and produced-file references. */
    deliverables: DeliverablesKey
  }
}

/** Required conversation services; either sidebar can supply review navigation. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session']

/**
 * Register turn summaries and review tabs; an installed better-sidebar receives review opens first.
 * @param ctx - the client plugin context.
 */
export function apply(ctx: ClientContext): void {
  const opener = new PresentedOpenController()
  const summaries = new ChangesSummaryStore()
  const reader = new ChangesReader()
  const reads = {
    summary: reader.summary.bind(reader),
    diff: reader.diff.bind(reader),
  }
  ctx.effect(() => () => Promise.all([opener.dispose(), summaries.dispose(), reader.dispose()]))
  ctx.on('connection/reset', () => { opener.resetHost(); summaries.reset(); reader.reset() })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-deliverables: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['betterSidebar'], (scoped) => {
    const sidebar = scoped.get('betterSidebar')
    if (sidebar === undefined) return
    const descriptor: TabDescriptor = {
      id: CHANGES_REVIEW_KIND,
      title: () => t('changes.openReview'),
      hidden: true,
      dedupeKey: tab => tab.id,
      component: ({ tab, scope }) => {
        const coordinates = parseChangesReviewAddress(tab.path ?? '')
        if (coordinates === undefined) return null
        const index = (tab.meta as { index?: number } | undefined)?.index ?? 0
        return createElement(ReviewPanel, {
          key: tab.id, ...coordinates, initialIndex: index, ...reads, t,
          openFile: path => sidebar.openFile(scope, path),
        })
      },
    }
    scoped.effect(() => sidebar.registerTab(descriptor), 'ui-deliverables: better-sidebar review')
  })
  const openChangesReview = (coordinates: ChangesReviewCoordinates, index: number): (void) => {
    const address = changesReviewAddress(coordinates)
    const sidebar = ctx.get('betterSidebar')
    if (sidebar !== undefined && sidebar.isTabEnabled(CHANGES_REVIEW_KIND)) {
      sidebar.openTab({ type: CHANGES_REVIEW_KIND, id: address, path: address, meta: { index },
        title: t('review.title', { turn: String(coordinates.turn) }) }, { sessionId: coordinates.sessionId })
      sidebar.updateTab(address, { meta: { index } })
      return
    }
    ctx.get('sidebarRight')?.openResource(address, { params: { index } })
  }
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail', select: selectProducedFiles, locale: NS,
  }, ProducedFiles))
  ctx.slots.inject('conversation.chat.turnCards', () => ctx.slots.register({
    name: 'conversation.chat.turnCards', id: '@deepseek-ai/dsh-client-ui-deliverables', locale: NS,
    inject: (): DeliverablesInjected => ({
      hooks: { changesSummary: summaries.state, presentedOpen: opener.state, presentedHost: opener.host },
      reloadPresentedHost: () => opener.loadHost(),
      openPresented: (sessionId, seq, index, action) => opener.open(sessionId, seq, index, action),
      previewPresented: (sessionId, cwd, path, fallback) => {
        const sidebar = ctx.get('betterSidebar')
        return sidebar === undefined ? fallback(path)
          : sidebar.openFile({ sessionId, ...cwd === undefined ? {} : { cwd } }, path)
      },
      loadChangesSummary: (sessionId, seq) => summaries.load(sessionId, seq),
      openChangesReview,
    }),
  }, DeliverablesTail))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'present', locale: NS }, PresentRow,
  ))
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (sidebar) => {
    sidebar.effect(() => sidebar.sidebarRightTabs.register(changesReviewDefinition(t)), 'ui-deliverables: review type')
    sidebar.slots.inject('sidebar.right.pane.tab', () => sidebar.slots.register({
      name: 'sidebar.right.pane.tab', key: CHANGES_REVIEW_ID, locale: NS, inject: () => reads,
    }, ReviewTab))
  })
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const paths = selectProducedFiles(owner)
      const presented = presentedForClosing(owner)
      if (paths === null && presented.length === 0) return undefined
      return producedFileMentions([...new Set([...paths ?? [], ...presented.map(file => file.path)])],
        owner.openFile, path => t('produced.open', { name: path }))
    },
  }
  ctx.provide('chatFileMentions', mentions)
}
