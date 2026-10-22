/** One right-Sidebar side-chat tab, bound to its own retained Session. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconPlusOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './FloatingPanel.module.css'

/** Session allocator supplied by the owning client registration. */
export interface FloatingTabInjected {
  createSession(): Promise<SessionReference>
}

/** Props of one docked side-chat tab and its embedded chat occurrence. */
export type FloatingTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'floatingWorkspace.tab.chat'>
  & PropsLocale<'settings.floatingWorkspace'> & FloatingTabInjected

/**
 * Render the docked Chat for the Session the tab belongs to.
 * @param props - the declared occurrence seat.
 * @returns the transcript and composer inside the right-Sidebar tab.
 */
export function FloatingTab({ renderSlot, useTabInfo, createSession, SessionProvider, t }: FloatingTabProps): ReactNode {
  const { tab } = useTabInfo()
  const [reference, setReference] = useState<SessionReference>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current: SessionReference | undefined
    let abandoned = false
    setReference(undefined)
    setFailed(false)
    void createSession().then((value) => {
      if (abandoned || tab.signal.aborted) { value.release(); return }
      current = value
      setReference(value)
    }, () => {
      if (!abandoned && !tab.signal.aborted) setFailed(true)
    })
    const release = () => {
      abandoned = true
      const owned = current
      current = undefined
      owned?.release()
    }
    tab.signal.addEventListener('abort', release, { once: true })
    return () => {
      abandoned = true
      tab.signal.removeEventListener('abort', release)
      const owned = current
      current = undefined
      owned?.release()
    }
  }, [attempt, createSession, tab.signal])
  return <div className={css.body}>
    <div className={css.sideChatActions}>
      <Tooltip portal label={t('newSideChat')} side="bottom" delayMs={500}>
        <Button variant="ghost" size="sm" aria-label={t('newSideChat')} onClick={() => {
          tab.actions.openTab('floatingWorkspace', { revealIfOpened: false })
        }}><IconPlusOutlineRegular aria-hidden="true" /></Button>
      </Tooltip>
    </div>
    {failed && <div className={css.empty} role="alert">{t('sessionFailed')} <Button variant="ghost" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button></div>}
    {!failed && reference === undefined && <p className={css.empty} role="status">{t('sessionLoading')}</p>}
    <SessionProvider session={reference} empty={() => null}>
      {reference === undefined ? null : renderSlot('floatingWorkspace.tab.chat', {})}
    </SessionProvider>
  </div>
}
