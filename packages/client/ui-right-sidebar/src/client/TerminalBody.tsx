/** Session-scoped terminal panel backed by the terminal Remote. */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TerminalKillValue, TerminalSendValue, TerminalSessionId, TerminalSpawnValue, TerminalView } from '@deepseek-ai/dsh-api-terminal-controller/types'
import css from './SidebarContributors.module.css'

export interface TerminalBodyInjected {
  readonly list: () => Promise<{ readonly terminals: readonly TerminalView[] }>
  readonly spawn: () => Promise<TerminalSpawnValue>
  readonly send: (terminalSessionId: TerminalSessionId, text: string) => Promise<TerminalSendValue>
  readonly kill: (terminalSessionId: TerminalSessionId) => Promise<TerminalKillValue>
}

type TerminalBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'rightSidebarContributors'> & TerminalBodyInjected

export function TerminalBody({ t, list, spawn, send, kill }: TerminalBodyProps): JSX.Element {
  const [terminals, setTerminals] = useState<readonly TerminalView[]>([])
  const [selected, setSelected] = useState<TerminalSessionId>()
  const [viewport, setViewport] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      setError(undefined)
      const value = await list()
      setTerminals(value.terminals)
      setSelected(current => current ?? value.terminals[0]?.terminalSessionId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [list])
  useEffect(() => { void refresh() }, [refresh])
  const start = useCallback(async () => {
    setBusy(true)
    try {
      setError(undefined)
      const value = await spawn()
      setTerminals(items => [...items, value])
      setSelected(value.terminalSessionId)
      setViewport(value.motd)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [spawn])
  const submit = useCallback(async () => {
    if (selected === undefined || input.length === 0) return
    setBusy(true)
    try {
      setError(undefined)
      const value = await send(selected, input)
      setViewport(value.viewport)
      setInput('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [input, selected, send])
  const close = useCallback(async () => {
    if (selected === undefined) return
    setBusy(true)
    try {
      await kill(selected)
      setTerminals(items => items.filter(item => item.terminalSessionId !== selected))
      setSelected(undefined)
      setViewport('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }, [kill, selected])
  return (
    <section className={css.panel}>
      <div className={css.toolbar}>
        <button type="button" className={css.button} onClick={() => { void start() }} disabled={busy}>{t('terminal.start')}</button>
        <button type="button" className={css.button} onClick={() => { void refresh() }} disabled={busy}>{t('terminal.refresh')}</button>
        <button type="button" className={css.button} onClick={() => { void close() }} disabled={busy || selected === undefined}>{t('terminal.stop')}</button>
      </div>
      {terminals.length > 0 ? <select className={css.select} value={selected ?? ''} onChange={event => { setSelected(event.target.value as TerminalSessionId) }} aria-label={t('terminal.title')}>
        {terminals.map(item => <option key={item.terminalSessionId} value={item.terminalSessionId}>{item.name ?? item.type}</option>)}
      </select> : <p className={css.muted}>{busy ? t('terminal.loading') : t('terminal.empty')}</p>}
      <label className={css.label}>
        <span>{t('terminal.input')}</span>
        <input className={css.input} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void submit() }} disabled={selected === undefined || busy} />
      </label>
      <button type="button" className={css.primaryButton} onClick={() => { void submit() }} disabled={selected === undefined || busy || input.length === 0}>{t('terminal.send')}</button>
      <label className={css.label}>
        <span>{t('terminal.output')}</span>
        <pre className={css.output}>{viewport}</pre>
      </label>
      {error !== undefined ? <p className={css.error} role="alert">{t('terminal.error', { message: error })}</p> : null}
    </section>
  )
}
