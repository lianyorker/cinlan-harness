/** Explicit human Browser operations. File contents stay transient and are never rendered. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  BrowserObservationValue,
  BrowserFileUploadRequest,
  BrowserFileUploadValue,
  BrowserDownloadsValue,
  BrowserDownloadRequest,
  BrowserDownloadValue,
  BrowserPagesValue,
  BrowserNavigationTarget,
  BrowserOpenValue,
  BrowserPageId,
  BrowserHistoryValue,
  BrowserNetworkValue,
  BrowserImportCookiesRequest,
  BrowserImportCookiesValue,
} from '@deepseek-ai/dsh-api-browser-controller/types'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'
import { BrowserTransfersPanel } from './BrowserTransfersPanel.tsx'

/** Generated Remote callbacks provided at the plugin registration site. */
export interface BrowserControlsCallbacks {
  snapshot: (pageId: BrowserPageId, signal: AbortSignal) => Promise<BrowserObservationValue>
  upload: (request: BrowserFileUploadRequest, signal: AbortSignal) => Promise<BrowserFileUploadValue>
  downloads: (pageId: BrowserPageId, signal: AbortSignal) => Promise<BrowserDownloadsValue>
  download: (request: BrowserDownloadRequest, signal: AbortSignal) => Promise<BrowserDownloadValue>
  pages: (signal: AbortSignal) => Promise<BrowserPagesValue>
  open: (target: BrowserNavigationTarget, signal: AbortSignal) => Promise<BrowserOpenValue>
  history: (pageId: BrowserPageId, signal: AbortSignal) => Promise<BrowserHistoryValue>
  network: (pageId: BrowserPageId, signal: AbortSignal) => Promise<BrowserNetworkValue>
  importCookies: (request: BrowserImportCookiesRequest, signal: AbortSignal) => Promise<BrowserImportCookiesValue>
}

/** Render explicit actions; mounting this component does not start a browser.
 * @param props - Localized labels and Host callbacks, without a Cordis context.
 * @returns Profile, navigation, cookie import, and page inspection controls.
 */
export function BrowserControls({ callbacks, t }: { callbacks: BrowserControlsCallbacks; t: CapabilitySectionProps['t'] }): ReactNode {
  const [state, setState] = useState<BrowserPagesValue>()
  const [selected, setSelected] = useState<BrowserPageId>()
  const [query, setQuery] = useState('')
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(false)
  const [imported, setImported] = useState<number>()
  const [visits, setVisits] = useState<BrowserHistoryValue>()
  const [network, setNetwork] = useState<BrowserNetworkValue>()
  const active = useRef<AbortController>()
  const fileControl = useRef<HTMLInputElement>(null)
  useEffect(() => () => { active.current?.abort() }, [])
  const run = async (action: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (active.current !== undefined && !active.current.signal.aborted) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true); setFailure(false)
    try { await action(controller.signal) } catch (_operationRejected) {
      if (!controller.signal.aborted) setFailure(true)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      controller.abort()
    }
  }
  const refresh = async (signal: AbortSignal): Promise<void> => {
    const next = await callbacks.pages(signal)
    signal.throwIfAborted()
    setState(next)
    setSelected(current => next.pages.some(page => page.pageId === current) ? current : next.pages[0]?.pageId)
    setVisits(undefined); setNetwork(undefined)
  }
  const open = async (target: BrowserNavigationTarget, signal: AbortSignal): Promise<void> => {
    const page = await callbacks.open(target, signal)
    signal.throwIfAborted()
    await refresh(signal)
    setSelected(page.pageId)
  }
  return <div className={css.browserControls}>
    <p>{t('browserProfileHelp')}</p>
    {state !== undefined && <p>{t('browserActiveProfile', { profile: state.profileName })}</p>}
    <div className={css.browserActions}>
      <button type="button" className={css.recheckButton} disabled={busy} onClick={() => { void run(refresh) }}>{t('browserConnect')}</button>
      <button type="button" className={css.recheckButton} disabled={busy} onClick={() => { void run(signal => open({ kind: 'home' }, signal)) }}>{t('browserOpenHome')}</button>
    </div>
    <form className={css.browserActions} onSubmit={(event) => { event.preventDefault(); void run(signal => open({ kind: 'search', query: query.trim() }, signal)) }}>
      <input aria-label={t('browserSearchQuery')} value={query} maxLength={500} required disabled={busy} onChange={(event) => { setQuery(event.currentTarget.value) }} />
      <button className={css.recheckButton} disabled={busy || query.trim().length === 0} type="submit">{t('browserSearch')}</button>
    </form>
    <label className={css.browserFile}><span>{t('browserCookieFile')}</span><input ref={fileControl} type="file" accept=".json,application/json" disabled={busy}
      onChange={(event) => { setFile(event.currentTarget.files?.[0]); setImported(undefined) }} /></label>
    <button className={css.recheckButton} type="button" disabled={busy || file === undefined || state === undefined} onClick={() => { void run(async (signal) => {
      if (file === undefined || state === undefined || file.size > 262144) throw new Error('Cookie file rejected')
      const json = await file.text()
      signal.throwIfAborted()
      const receipt = await callbacks.importCookies({ profileName: state.profileName, json }, signal)
      signal.throwIfAborted()
      setImported(receipt.imported); setFile(undefined)
      if (fileControl.current !== null) fileControl.current.value = ''
    }) }}>{t('browserImportCookies')}</button>
    {imported !== undefined && <p role="status">{t('browserImported', { count: imported })}</p>}
    {state !== undefined && <label><span>{t('browserPage')}</span><select aria-label={t('browserPage')} disabled={busy} value={selected ?? ''} onChange={(event) => {
      setSelected(state.pages.find(page => page.pageId === event.currentTarget.value)?.pageId); setVisits(undefined); setNetwork(undefined)
    }}>{state.pages.map(page => <option key={page.pageId} value={page.pageId}>{page.title || page.url}</option>)}</select></label>}
    <div className={css.browserActions}>
      <button className={css.recheckButton} type="button" disabled={busy || selected === undefined} onClick={() => { void run(async (signal) => {
        if (selected === undefined) return
        const result = await callbacks.history(selected, signal); signal.throwIfAborted(); setVisits(result)
      }) }}>{t('browserHistory')}</button>
      <button className={css.recheckButton} type="button" disabled={busy || selected === undefined} onClick={() => { void run(async (signal) => {
        if (selected === undefined) return
        const result = await callbacks.network(selected, signal); signal.throwIfAborted(); setNetwork(result)
      }) }}>{t('browserNetwork')}</button>
    </div>
    <p>{t('browserInspectionLimit')}</p>
    {visits !== undefined && <ul aria-label={t('browserHistory')}>{visits.entries.map((entry, index) => <li key={index}>{entry.title} — {entry.url}</li>)}</ul>}
    {network !== undefined && <ul aria-label={t('browserNetwork')}>{network.entries.map((entry, index) => <li key={index}>{entry.method} {entry.status ?? (entry.failed ? t('browserRequestFailed') : t('browserRequestPending'))}{entry.status !== undefined && entry.failed ? ' ' + t('browserRequestFailed') : ''} — {entry.url}</li>)}</ul>}
    {state !== undefined && selected !== undefined && <BrowserTransfersPanel
      key={selected} pageId={selected} maxFileBytes={state.maxFileBytes} callbacks={callbacks} t={t} />}
    {failure && <p role="alert" className={css.failure}>{t('browserOperationFailed')}</p>}
  </div>
}
