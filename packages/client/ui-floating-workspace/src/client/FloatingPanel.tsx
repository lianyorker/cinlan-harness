/** Floating panel shell: one embedded Conversation occurrence for the Session that owns it. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingSnapshot } from './contract.ts'
import type { FloatingWorkspaceSettingsKey } from './locales.ts'
import css from './FloatingPanel.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'settings.floatingWorkspace': FloatingWorkspaceSettingsKey }
}

/** Framework sources plus the panel's own close operation. */
export interface FloatingPanelInjected {
  hooks: { floating: ObservableSnapshot<FloatingSnapshot> }
  /** Close this panel and leave the Session and its layout alone. */
  close(): void
}

/**
 * Panel props: the Session-scoped seat it is registered in, the embedded
 * occurrence seat, plus localized copy. The seat is inside the Conversation's
 * own Session area, so the occurrence renders with the Conversation provide in
 * scope and no explicit session binding.
 */
export type FloatingPanelProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsRenderSlots<'floatingWorkspace.chat'>
  & PropsLocale<'settings.floatingWorkspace'>
  & InjectFace<FloatingPanelInjected>

/**
 * Render the floating panel and the Chat inside it.
 * @param props - framework sources, the occurrence seat, and localized copy.
 * @returns the panel, or no content while it is closed.
 */
export function FloatingPanel({ useFloating, close, renderSlot, t }: FloatingPanelProps): ReactNode {
  const snapshot = useFloating(value => value)
  if (!snapshot.open) return null
  // The accepted size preferences now size this panel instead of an OS window.
  const width = snapshot.settings.value?.floatDefaultWidth
  const height = snapshot.settings.value?.floatDefaultHeight
  return <div className={css.panel} role="dialog" aria-label={t('title')} data-floating-panel
    style={{ width: width === undefined ? undefined : Math.min(width, 800), maxHeight: height }}>
    <div className={css.bar}>
      <span className={css.title}>{t('title')}</span>
      <Button variant="ghost" size="sm" onClick={close} aria-label={t('close')} title={t('close')}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </Button>
    </div>
    <div className={css.body}>{renderSlot('floatingWorkspace.chat', {})}</div>
  </div>
}
