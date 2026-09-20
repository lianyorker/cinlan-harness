/** Phone root: authorized selection and the existing embedded Conversation slot. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './PairedShell.module.css'

/** Plain navigation callback injected by the shell plugin. */
export interface PairedShellInjected {
  /** Select one currently authorized Session. */
  selectSession: (id: SessionId) => void
}

/** Framework-derived root props with no business-owned hooks. */
export type PairedShellProps = PropsRuntime<'root'>
  & PropsRenderSlots<'conversation'>
  & PropsLocale<'pairedShell'>
  & PairedShellInjected

/**
 * Render authorized choices and the conversation for the current selection.
 * @param props - Framework hooks, child slots, locale, and selection callback.
 * @returns Phone conversation root.
 */
export function PairedShell({ useSessions, renderSlot, selectSession, t }: PairedShellProps) {
  const list = useSessions(value => value)
  const selectedSession = list.current !== undefined && list.ids.includes(list.current)
    ? list.current : undefined
  return (
    <main className={css.root}>
      <header className={css.header}>
        <span className={css.title}>{t('title')}</span>
        <select
          className={css.select}
          aria-label={t('sessions')}
          value={selectedSession ?? ''}
          onChange={(event) => {
            const id = list.ids.find(candidate => candidate === event.currentTarget.value)
            if (id !== undefined) selectSession(id)
          }}
        >
          <option value="" disabled>{t('choose')}</option>
          {list.ids.map(id => <option key={id} value={id}>{list.byId[id]?.displayTitle ?? id}</option>)}
        </select>
      </header>
      <section className={css.conversation}>
        {selectedSession !== undefined
          ? renderSlot('conversation', { embedded: true })
          : <p className={css.empty} role="status">{t(list.phase !== 'ready' ? 'loading' : list.ids.length === 0 ? 'empty' : 'choose')}</p>}
      </section>
    </main>
  )
}
