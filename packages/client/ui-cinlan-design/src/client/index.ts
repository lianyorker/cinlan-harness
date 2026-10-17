import type { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { CinlanDesignBody } from './view/CinlanDesignBody.tsx'
import { CinlanDesignTitle } from './view/CinlanDesignTitle.tsx'
import { CINLAN_DESIGN_ID, cinlanDesignDefinition } from './definition.tsx'
import { en, zh } from './locales.ts'
import { createCinlanDesignStore } from './store.ts'

export type { CinlanDesignKey } from './locales.ts'
export type { CinlanDesignStore, CinlanDesignTabState, ViewportMode } from './store.ts'
export type { CinlanDesignBodyProps } from './view/CinlanDesignBody.tsx'
export type { CinlanDesignTitleProps } from './view/CinlanDesignTitle.tsx'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Optional initial Cinlan Design URL. */
    'cinlan-design': { readonly url?: string }
  }
}

/** Required services. */
export const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

function injectDraftToSession(ctx: Context, sessionId: string, text: string): boolean {
  try {
    const sessions = ctx.get('sessions') as { scope?: (id: SessionId) => unknown } | undefined
    const actx = sessions?.scope ? sessions.scope(sessionId as SessionId) : undefined
    if (!actx) return false
    const conversation = ctx.get('conversation') as {
      input?: { for: (a: unknown) => { state: { getSnapshot: () => { draft: string } }; setDraft: (d: string) => void } }
    } | undefined
    if (!conversation?.input) return false
    const input = conversation.input.for(actx)
    const draft = input.state.getSnapshot().draft
    input.setDraft(draft === '' || /\s$/.test(draft) ? `${draft}${text}` : `${draft}\n\n${text}`)
    return true
  } catch (error) {
    console.warn('[dsh-client-ui-cinlan-design] draft insert failed:', error)
    return false
  }
}

/** Register the Cinlan Design Studio tab, localization, body and title slots. */
export function apply(ctx: Context): void {
  const namespace = 'cinlanDesign'
  const t = ctx.locale.bind(namespace)

  ctx.inject(['shortcuts'], (scope) => {
    scope.effect(() => scope.shortcuts.register({
      id: 'design.new' as ShortcutCommandId,
      label: () => t('guide.title'),
      aliases: ['design', 'cinlan design', 'design studio'],
      defaults: {
        'desktop:macos': { code: 'KeyD', modifiers: ['primary', 'alt'] },
        'desktop:windows': { code: 'KeyD', modifiers: ['primary', 'alt'] },
        'desktop:linux': { code: 'KeyD', modifiers: ['primary', 'alt'] },
        'web:macos': { code: 'KeyD', modifiers: ['primary', 'alt'] },
        'web:windows': { code: 'KeyD', modifiers: ['primary', 'alt'] },
      },
      regions: ['page', 'editable', 'terminal'],
      modals: [],
      resolve: ({ target: element }) => {
        const target = scope.sidebarRight.commandTarget(element)
        if (target === undefined) return { status: 'blocked', reason: t('shortcut.noSession') }
        return {
          status: 'handled',
          run: () => {
            scope.sidebarRight.openTabFromTarget('cinlan-design', target)
          },
        }
      },
    }), 'ui-cinlan-design: shortcut')
  })

  const store = createCinlanDesignStore()

  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'ui-cinlan-design.copy')
  ctx.effect(() => ctx.sidebarRightTabs.register(cinlanDesignDefinition(t)), 'ui-cinlan-design.type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: CINLAN_DESIGN_ID,
    locale: namespace,
    store,
    inject: (sessionId) => ({
      onInjectDraft: (text: string) => {
        injectDraftToSession(ctx, sessionId, text)
      },
    }),
  }, CinlanDesignBody)), 'ui-cinlan-design.body')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: CINLAN_DESIGN_ID,
  }, CinlanDesignTitle)), 'ui-cinlan-design.title')
}
