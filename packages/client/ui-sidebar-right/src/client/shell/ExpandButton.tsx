/** Conversation-header controls for opening the sidebar and its page menu. */
import { useState } from 'react'
import { IconEllipsisOutline16, IconPanelLeftOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { createSidebarRightStore } from '../stores.ts'
import css from './ExpandButton.module.css'

/** Header actions supplied by the owning sidebar service. */
export interface ExpandButtonInjected {
  readonly openTab: (kind: string) => void
}

/** The button's props: the header corner seat, the shared store, copy, and navigation. */
export type ExpandButtonProps =
  & PropsRuntime<'conversation.session.header.corner'>
  & PropsStore<ReturnType<typeof createSidebarRightStore>>
  & PropsLocale<'sidebarRight'>
  & InjectFace<ExpandButtonInjected>

const PAGE_KINDS = [
  ['files', 'tools.files'],
  ['review', 'tools.review'],
  ['terminal', 'tools.terminal'],
  ['tasks', 'tools.tasks'],
  ['browser', 'tools.browser'],
] as const

/** Header menu and expand control; both remain owned by one corner registration. */
export function ExpandButton({ sessionId, useStore, actions, t, openTab }: ExpandButtonProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const expanded = useStore(state => state.bySession[sessionId]?.layout.expanded ?? false)
  return (
    <div className={css.controls}>
      <div className={css.menuWrap}>
        <button
          type="button"
          className={css.button}
          aria-label={t('chrome.tools')}
          title={t('chrome.tools')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          data-sidebar-right-tools
          onClick={() => { setMenuOpen(value => !value) }}
        >
          <IconEllipsisOutline16 className={css.menuIcon} />
        </button>
        {menuOpen ? <div className={css.menu} role="menu" aria-label={t('chrome.tools')}>
          {PAGE_KINDS.map(([kind, label]) => <button
            key={kind}
            type="button"
            className={css.menuItem}
            role="menuitem"
            onClick={() => { setMenuOpen(false); openTab(kind) }}
          >{t(label)}</button>)}
        </div> : null}
      </div>
      {expanded ? <span className={css.placeholder} aria-hidden data-sidebar-right-expand-placeholder /> : <button
        type="button"
        className={css.button}
        aria-label={t('chrome.expand')}
        title={t('chrome.expand')}
        data-sidebar-right-expand
        onClick={() => { actions.setExpanded(sessionId, true) }}
      >
        <IconPanelLeftOutline16 className={css.icon} />
      </button>}
    </div>
  )
}
