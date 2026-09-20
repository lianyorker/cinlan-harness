/** Restore tabs from retained Host processes without creating another terminal lifetime. */
import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalCallbacks, SidebarTerminalSessionId } from '@deepseek-ai/dsh-api-sidebar-terminal-controller/types'
import { allLeaves, openTabInActivePane, patchTab, type SidebarStore } from './state.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** Recover only this Session and window; retries repeat the authoritative list read.
 * @param props - Existing transport, layout owner, and currently displayed Session/window.
 * @returns An explicit retry control after an enumeration failure.
 */
export function TerminalRecovery({ terminal, store, sessionId, windowId }: {
  terminal: Pick<TerminalCallbacks, 'terminalListUi'>
  store: SidebarStore
  sessionId: string
  windowId?: string
}) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    setFailed(false)
    const before = store.getSnapshot().state
    const initial = new Map(before === undefined ? [] : [...allLeaves(before.splits), ...allLeaves(before.bottomSplits)]
      .flatMap(leaf => leaf.tabs).map(tab => [tab.id, tab] as const))
    void terminal.terminalListUi(sessionId as SidebarTerminalSessionId).then((list) => {
      if (!active || store.getSnapshot().sessionId !== sessionId) return
      store.reduce((state) => {
        let next = state
        for (const item of list) {
          if (item.floating?.windowId !== windowId) continue
          const present = [...allLeaves(next.splits), ...allLeaves(next.bottomSplits)]
            .flatMap(leaf => leaf.tabs).find(tab => tab.id === item.tabId)
          if (initial.has(item.tabId) && present !== initial.get(item.tabId)) continue
          if (!initial.has(item.tabId) && present !== undefined) continue
          const meta = present?.meta !== null && typeof present?.meta === 'object' ? present.meta : {}
          const tab = { id: item.tabId, type: 'terminal', title: item.title, meta: { ...meta,
            terminalProcessId: item.processId, terminalLaunch: { pending: false, shellPath: item.shellPath },
            ...item.floating === undefined ? {} : { terminalFloating: item.floating } } }
          next = present === undefined ? openTabInActivePane(next, tab) : patchTab(next, tab.id, { title: tab.title, meta: tab.meta })
          const counter = Number(item.tabId.split(':').at(-1))
          if (Number.isSafeInteger(counter) && counter >= next.nextTerminal) next = { ...next, nextTerminal: counter + 1 }
        }
        return next
      })
    }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [terminal, store, sessionId, windowId, attempt])
  return failed ? <div className={css.terminalRecovery} role="alert">
    <span>{t('terminalRecoverFailed')}</span>
    <Button onClick={() => { setAttempt(value => value + 1) }}>{t('terminalRetry')}</Button>
  </div> : null
}
