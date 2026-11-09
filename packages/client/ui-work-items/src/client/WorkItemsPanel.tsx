/** Read-only global Work Items panel for browsing provider issues. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkItemSource, WorkItemStateFilter } from '@cinlan/work-items/types'
import type { WorkItemView, WorkItemsGetRequest, WorkItemsListRequest, WorkItemsListValue } from '@cinlan/api-work-items-controller/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkItemsSettings } from '../types.ts'
import { NS } from './locales.ts'
import css from './WorkItemsPanel.module.css'

/** Remote reads supplied by the Host registration. */
export interface WorkItemsPanelInjected {
  /** List one page from a configured Provider. */
  list: (request: WorkItemsListRequest, signal: AbortSignal) => Promise<WorkItemsListValue>
  /** Read one issue and its local association projection. */
  get: (request: WorkItemsGetRequest, signal: AbortSignal) => Promise<WorkItemView>
  /** Host-owned Provider visibility preferences. */
  hooks: { settings: Pick<SettingsScope<WorkItemsSettings>, 'getSnapshot' | 'subscribe'> }
}

/** Runtime, locale, and Host reads for the global panel. */
export type WorkItemsPanelProps = PropsRuntime<'main'> & PropsLocale<typeof NS> & InjectFace<WorkItemsPanelInjected>

const PROVIDERS = ['github', 'gitlab', 'gitee', 'jira', 'linear'] as const satisfies readonly WorkItemSource[]

/**
 * Render a paged read-only issue catalog without activating a Session.
 * @param props - Host reads, visibility preferences, and localized labels.
 * @returns The global Work Items panel.
 */
export function WorkItemsPanel({ t, list, get, useSettings }: WorkItemsPanelProps): ReactNode {
  const settings = useSettings(snapshot => snapshot)
  const sources = PROVIDERS.filter(provider => settings.value?.[`${provider}Visible`] !== false)
  const [source, setSource] = useState<WorkItemSource>('github')
  const [state, setState] = useState<WorkItemStateFilter>('open')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<WorkItemsListValue>({ items: [], truncated: false })
  const [selected, setSelected] = useState<WorkItemView>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [cursor, setCursor] = useState<string>()
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const request = useRef<AbortController>()
  const detailRequest = useRef<AbortController>()

  const selectedSource = sources.includes(source) ? source : sources[0]

  useEffect(() => {
    request.current?.abort()
    detailRequest.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(undefined)
    setSelected(undefined)
    if (selectedSource === undefined) { setPage({ items: [], truncated: false }); setLoading(false); return () => controller.abort() }
    const request = { source: selectedSource, state, ...(query ? { query } : {}), ...(cursor === undefined ? {} : { cursor }) }
    void list(request, controller.signal).then((value) => {
      if (!controller.signal.aborted) setPage(value)
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('unknownError'))
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [cursor, list, query, refreshVersion, selectedSource, state, t])

  useEffect(() => () => {
    request.current?.abort()
    detailRequest.current?.abort()
  }, [])

  const open = async (item: WorkItemView): Promise<void> => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setDetailLoading(true)
    setError(undefined)
    try {
      const value = await get({ id: item.id }, controller.signal)
      if (!controller.signal.aborted) setSelected(value)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('unknownError'))
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false)
    }
  }

  const reset = (update: () => void): void => {
    setCursor(undefined)
    setHistory([])
    setPage({ items: [], truncated: false })
    update()
  }

  return <main className={css.panel}>
    <header className={css.header}><div><h1>{t('panelTitle')}</h1><p>{t('panelDescription')}</p></div>
      <Button variant="outline" disabled={loading} onClick={() => { setCursor(undefined); setHistory([]); setRefreshVersion(version => version + 1) }}>{t('refresh')}</Button>
    </header>
    <div className={css.filters}>
      <label><span>{t('source')}</span><select aria-label={t('source')} value={selectedSource ?? ''} disabled={selectedSource === undefined} onChange={event => reset(() => setSource(event.currentTarget.value as WorkItemSource))}>
        {sources.length === 0 ? <option value="">{t('noVisibleProviders')}</option> : null}
        {sources.map(provider => <option key={provider} value={provider}>{t(provider)}</option>)}
      </select></label>
      <label><span>{t('state')}</span><select aria-label={t('state')} value={state} onChange={event => reset(() => setState(event.currentTarget.value as WorkItemStateFilter))}>
        <option value="open">{t('open')}</option><option value="closed">{t('closed')}</option><option value="all">{t('all')}</option>
      </select></label>
      <label><span>{t('search')}</span><Input aria-label={t('search')} value={query} maxLength={500} onChange={event => reset(() => setQuery(event.currentTarget.value))} /></label>
    </div>
    {error === undefined ? null : <p role="alert" className={css.error}>{t('error', { message: error })}</p>}
    {page.truncated ? <p className={css.help}>{t('truncated')}</p> : null}
    <div className={css.content}>
      <section aria-label={t('panelList')}>
        {loading ? <p className={css.help}>{t('loading')}</p> : <ul className={css.list}>
          {page.items.length === 0 ? <li className={css.help}>{selectedSource === undefined ? t('noVisibleProviders') : t('empty')}</li> : page.items.map(item => <li key={item.id}>
            <button type="button" className={selected?.id === item.id ? css.selected : css.item} onClick={() => { void open(item) }}>
              <span>{item.key === undefined ? item.title : `${item.key} · ${item.title}`}</span><span className={css.meta}>{item.source} · {item.state}</span>
            </button>
          </li>)}
        </ul>}
        <nav className={css.pager} aria-label={t('paging')}>
          <Button variant="outline" disabled={loading || history.length === 0} onClick={() => {
            setCursor(history.at(-1)); setHistory(values => values.slice(0, -1))
          }}>{t('previous')}</Button>
          <Button variant="outline" disabled={loading || selectedSource === undefined || page.nextCursor === undefined} onClick={() => {
            setHistory(values => [...values, cursor]); setCursor(page.nextCursor)
          }}>{t('next')}</Button>
        </nav>
      </section>
      <article className={css.detail} aria-live="polite">
        {detailLoading ? <p className={css.help}>{t('loading')}</p> : selected === undefined ? <p className={css.help}>{t('noSelection')}</p> : <>
          <h2>{selected.title}</h2>{selected.body === undefined ? null : <p className={css.body}>{selected.body}</p>}
          <dl><dt>{t('source')}</dt><dd>{selected.source}</dd><dt>{t('state')}</dt><dd>{selected.state}</dd>
            <dt>{t('external')}</dt><dd><a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a></dd>
            {selected.assignees.length === 0 ? null : <><dt>{t('assignees')}</dt><dd>{selected.assignees.join(', ')}</dd></>}
          </dl>
        </>}
      </article>
    </div>
  </main>
}
