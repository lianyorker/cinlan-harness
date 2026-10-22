/** Frame-level floating panel using its own auxiliary Session. */
import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingSnapshot } from './contract.ts'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
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
  /** @returns the retained auxiliary Session, never the main selection. */
  session(): SessionReference | undefined
  /** Retry a failed auxiliary Session creation. */
  retry(): void
}

/** Frame seat, current Session area, embedded chat seat, and localized copy. */
export type FloatingPanelProps = PropsRuntime<'shell.overlay'>
  & PropsRenderSlots<'floatingWorkspace.chat'>
  & PropsLocale<'settings.floatingWorkspace'>
  & InjectFace<FloatingPanelInjected>

/**
 * Render the floating panel and the Chat inside it.
 * @param props - framework sources, the occurrence seat, and localized copy.
 * @returns the panel, or no content while it is closed.
 */
export function FloatingPanel({ useFloating, close, session, retry, renderSlot, SessionProvider, t }: FloatingPanelProps): ReactNode {
  const snapshot = useFloating(value => value)
  if (!snapshot.open) return null
  // The accepted size preferences now size this panel instead of an OS window.
  const width = snapshot.settings.value?.floatDefaultWidth
  const height = snapshot.settings.value?.floatDefaultHeight
  return <div className={css.panel} role="dialog" aria-label={t('title')} data-floating-panel
    style={{
      ...(width === undefined ? {} : { '--floating-panel-width': `${width}px` } as CSSProperties),
      ...(height === undefined ? {} : { '--floating-panel-height': `${height}px` } as CSSProperties),
    }}>
    <div className={css.bar}>
      <span className={css.title}>{t('title')}</span>
      <Button variant="ghost" size="sm" onClick={close} aria-label={t('close')} title={t('close')}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" aria-hidden="true">
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </Button>
    </div>
    <div className={css.body}>
      {snapshot.sessionLoading && <p className={css.empty} role="status">{t('sessionLoading')}</p>}
      {snapshot.sessionFailed && <div className={css.empty} role="alert">{t('sessionFailed')} <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button></div>}
      <SessionProvider session={session()} empty={() => null}>
        {renderSlot('floatingWorkspace.chat', {})}
      </SessionProvider>
    </div>
  </div>
}
