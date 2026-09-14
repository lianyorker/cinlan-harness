/** Work Items reads and explicit local associations through the Settings slot. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkItemSource, WorkItemStateFilter } from '@deepseek-ai/dsh-work-items/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IntegrationProvider, IntegrationPreflightSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  WorkItemsPrepareWriteRequest, WorkItemsWriteRequest, WorkItemsWriteValue, WorkItemsWriteHistoryRequest, WorkItemsWriteHistoryValue,
  WorkItemAssociation, WorkItemView, WorkItemsAssociationRequest, WorkItemsAssociationValue,
  WorkItemsGetRequest, WorkItemsListRequest, WorkItemsListValue,
} from '@deepseek-ai/dsh-api-work-items-controller/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { NS } from './locales.ts'
import css from './WorkItemsSection.module.css'
import { WorkItemWritePanel } from './WorkItemWritePanel.tsx'

/** Host callbacks; association receipts follow durable local writes. */
export interface WorkItemsSectionInjected {
  prepareWrite: (request: WorkItemsPrepareWriteRequest, signal: AbortSignal) => Promise<WorkItemsWriteValue>
  confirmWrite: (request: WorkItemsWriteRequest, signal: AbortSignal) => Promise<WorkItemsWriteValue>
  cancelWrite: (request: WorkItemsWriteRequest, signal: AbortSignal) => Promise<WorkItemsWriteValue>
  listWrites: (request: WorkItemsWriteHistoryRequest, signal: AbortSignal) => Promise<WorkItemsWriteHistoryValue>
  list: (request: WorkItemsListRequest, signal: AbortSignal) => Promise<WorkItemsListValue>
  get: (request: WorkItemsGetRequest, signal: AbortSignal) => Promise<WorkItemView>
  associate: (request: WorkItemsAssociationRequest, signal: AbortSignal) => Promise<WorkItemsAssociationValue>
  disassociate: (request: WorkItemsAssociationRequest, signal: AbortSignal) => Promise<WorkItemsAssociationValue>
  checkIntegration: (provider: IntegrationProvider) => Promise<IntegrationPreflightSnapshot>
}

/** Settings props derived from runtime, locale, and injected callbacks. */
export type WorkItemsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<typeof NS> & InjectFace<WorkItemsSectionInjected>

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Render provider filters, pages, details, and local Workspace/Session links.
 * @param props - Settings runtime hooks, localized copy, and Host callbacks.
 * @returns The Work Items Settings section.
 */
export function WorkItemsSection(props: WorkItemsSectionProps): ReactNode {
  const { t, useWorkspaces, list, get, associate, disassociate, checkIntegration, close } = props
  const workspaces = useWorkspaces(snapshot => snapshot.items)
  const archivedSessionIds = useWorkspaces(snapshot => snapshot.archivedSessionIds)
  const [source, setSource] = useState<WorkItemSource>('github')
  const [state, setState] = useState<WorkItemStateFilter>('open')
  const [query, setQuery] = useState('')
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId>()
  const workspace = workspaces.find(item => item.workspaceId === workspaceId)
  const scope = workspace?.workspaceId
  const sessionIds = workspace?.sessionIds.filter(id => !archivedSessionIds.includes(id)) ?? []
  const [sessionId, setSessionId] = useState<SessionId>()
  const [page, setPage] = useState<WorkItemsListValue>({ items: [], truncated: false })
  const [history, setHistory] = useState<(string | undefined)[]>([])
  const cursor = useRef<string>()
  const [selected, setSelected] = useState<WorkItemView>()
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const listController = useRef<AbortController>()
  const detailController = useRef<AbortController>()
  const writeController = useRef<AbortController>()

  const [providerVisibility, setProviderVisibility] = useState<Record<string, boolean>>({ github: true, gitlab: true, linear: true })
  const [providerStates, setProviderStates] = useState<Record<string, IntegrationPreflightSnapshot | undefined>>({})
  const integrationController = useRef<AbortController>()

  useEffect(() => {
    integrationController.current?.abort()
    const controller = new AbortController()
    integrationController.current = controller
    const providers: IntegrationProvider[] = ['github', 'gitlab']
    for (const provider of providers) {
      checkIntegration(provider).then((snapshot) => {
        if (!controller.signal.aborted) setProviderStates(prev => ({ ...prev, [provider]: snapshot }))
      }).catch(() => {
        if (!controller.signal.aborted) setProviderStates(prev => ({ ...prev, [provider]: { provider, status: 'unavailable', reason: 'probe-failed', account: null } }))
      })
    }
    return () => { controller.abort() }
  }, [checkIntegration])

  const clearDetail = useCallback(() => {
    detailController.current?.abort()
    writeController.current?.abort()
    setSelected(undefined)
    setDetailLoading(false)
    setSaving(false)
  }, [])

  const load = useCallback(async (nextCursor?: string, direction: 'reset' | 'next' | 'previous' = 'reset') => {
    listController.current?.abort()
    clearDetail()
    const controller = new AbortController()
    listController.current = controller
    setLoading(true)
    setError(undefined)
    try {
      const next = await list({ source, state, ...(query ? { query } : {}),
        ...(nextCursor === undefined ? {} : { cursor: nextCursor }),
        ...(scope === undefined ? {} : { workspaceId: scope }),
      }, controller.signal)
      if (controller.signal.aborted) return
      setPage(next)
      const previous = cursor.current
      setHistory(values => direction === 'reset' ? [] : direction === 'next' ? [...values, previous] : values.slice(0, -1))
      cursor.current = nextCursor
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(errorText(cause, t('unknownError')))
      setPage({ items: [], truncated: false })
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [clearDetail, list, query, scope, source, state, t])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => {
    listController.current?.abort()
    detailController.current?.abort()
    writeController.current?.abort()
  }, [])

  const select = async (item: WorkItemView): Promise<void> => {
    clearDetail()
    const controller = new AbortController()
    detailController.current = controller
    setDetailLoading(true)
    setError(undefined)
    try {
      const detail = await get({ id: item.id, ...(scope === undefined ? {} : { workspaceId: scope }) }, controller.signal)
      if (!controller.signal.aborted) setSelected(detail)
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause, t('unknownError')))
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false)
    }
  }

  const write = async (remove?: WorkItemAssociation): Promise<void> => {
    if (selected === undefined || writeController.current && !writeController.current.signal.aborted) return
    const target = remove?.workspaceId ?? scope
    if (target === undefined) return
    const ownedSession = remove === undefined
      ? sessionIds.find(id => id === sessionId) : remove.sessionId
    const request = { id: selected.id, workspaceId: target, ...(ownedSession === undefined ? {} : { sessionId: ownedSession }) }
    const controller = new AbortController()
    writeController.current = controller
    setSaving(true)
    setError(undefined)
    try {
      const receipt = await (remove === undefined ? associate : disassociate)(request, controller.signal)
      if (controller.signal.aborted) return
      const associations = receipt.associations.filter(link => scope === undefined || link.workspaceId === scope)
      setSelected({ ...selected, associations })
      setPage(current => ({ ...current, items: current.items.map(item => item.id === selected.id ? { ...item, associations } : item) }))
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorText(cause, t('unknownError')))
    } finally {
      if (!controller.signal.aborted) setSaving(false)
      controller.abort()
    }
  }

  return <section className={css.section} aria-labelledby="work-items-title">
    <header className={css.header}><h2 id="work-items-title">{t('title')}</h2><p>{t('description')}</p></header>
    <div className={css.providerArea}>
      <h3>{t('providerManagement')}</h3><p>{t('providerManagementDesc')}</p>
      <div className={css.providerGrid}>
        {(['github', 'gitlab', 'linear'] as const).map((provider) => {
          const snapshot = providerStates[provider]
          const connected = snapshot?.status === 'connected'
          const visible = providerVisibility[provider] !== false
          const labelKey = provider === 'github' ? 'github' : provider === 'gitlab' ? 'gitlab' : 'linear'
          return <div key={provider} className={css.providerCard}>
            <div className={css.providerHeader}>
              <span className={css.providerName}>{t(labelKey)}</span>
              <span className={connected ? css.providerBadgeConnected : css.providerBadgeDisconnected}>
                {snapshot === undefined ? t('providerChecking') : connected ? t('providerConnected') : t('providerNotConnected')}
              </span>
            </div>
            {connected && snapshot?.account !== null
              ? <p className={css.providerAccount}>{t('providerAccount')}: {snapshot.account}</p>
              : null}
            {!connected && provider !== 'linear'
              ? <div className={css.providerActions}>
                <button type="button" className={css.button} onClick={() => { close() }}>{t('goToIntegrations')}</button>
              </div>
              : null}
            {connected
              ? <div className={css.providerActions}>
                <button type="button" className={css.button} onClick={() => { setProviderVisibility(prev => ({ ...prev, [provider]: !visible })) }}>
                  {visible ? t('providerHidden') : t('providerVisible')}
                </button>
              </div>
              : null}
          </div>
        })}
      </div>
      {providerStates.github?.status !== 'connected' || providerStates.gitlab?.status !== 'connected'
        ? <p className={css.providerHint}>{t('goToIntegrationsHint')}</p>
        : null}
    </div>
    <div className={css.filters}>
      <label className={css.filter}><span>{t('source')}</span>
        <select value={source} onChange={(event) => { setSource(event.currentTarget.value === 'linear' ? 'linear' : 'github') }}>
          {providerVisibility.github !== false ? <option value="github">{t('github')}</option> : null}
          {providerVisibility.linear !== false ? <option value="linear">{t('linear')}</option> : null}
        </select>
      </label>
      <label className={css.filter}><span>{t('state')}</span>
        <select value={state} onChange={(event) => {
          const value = event.currentTarget.value
          setState(value === 'all' || value === 'closed' ? value : 'open')
        }}><option value="open">{t('open')}</option><option value="closed">{t('closed')}</option><option value="all">{t('all')}</option></select>
      </label>
      <label className={css.filter}><span>{t('workspaceContext')}</span>
        <select value={scope ?? ''} onChange={(event) => {
          setWorkspaceId(workspaces.find(item => item.workspaceId === event.currentTarget.value)?.workspaceId)
          setSessionId(undefined)
        }}><option value="">{t('allWorkspaceContexts')}</option>
          {workspaces.map(item =>
            <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
        </select>
      </label>
      <label className={css.filter}><span>{t('search')}</span><input value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} /></label>
      <button className={css.button} type="button" disabled={loading} onClick={() => { void load() }}>{t('refresh')}</button>
    </div>
    <WorkItemWritePanel key={source + ':' + (selected?.id ?? '')} source={source} item={selected}
      t={t} prepareWrite={props.prepareWrite} confirmWrite={props.confirmWrite}
      cancelWrite={props.cancelWrite} listWrites={props.listWrites} />
    {error === undefined ? null : <p role="alert" className={css.error}>{t('error', { message: error })}</p>}
    {page.truncated ? <p>{t('truncated')}</p> : null}
    <div className={css.layout}>
      <div>{loading ? <p>{t('loading')}</p> : <ul className={css.list} aria-label={t('title')}>
        {page.items.length === 0 ? <li>{t('empty')}</li> : page.items.map(item => <li key={item.id}>
          <button className={selected?.id === item.id ? css.selected : css.item} type="button" onClick={() => { void select(item) }}>
            <span>{item.key === undefined ? item.title : item.key + ' · ' + item.title}</span><span className={css.itemMeta}>{item.source} · {item.state}</span>
          </button></li>)}
      </ul>}
      <div className={css.pager}>
        <button className={css.button} type="button" disabled={loading || history.length === 0} onClick={() => { void load(history.at(-1), 'previous') }}>{t('previous')}</button>
        <button className={css.button} type="button" disabled={loading || page.nextCursor === undefined} onClick={() => { void load(page.nextCursor, 'next') }}>{t('next')}</button>
      </div>
      </div>
      <article className={css.detail} aria-live="polite">
        {detailLoading ? <p>{t('loading')}</p> : selected === undefined ? <p>{t('noSelection')}</p> : <>
          <h3>{selected.title}</h3>{selected.body === undefined ? null : <p>{selected.body}</p>}
          <dl><dt>{t('source')}</dt><dd>{selected.source}</dd><dt>{t('state')}</dt><dd>{selected.state}</dd>
            <dt>{t('external')}</dt><dd><a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a></dd>
            {selected.assignees.length === 0 ? null : <><dt>{t('assignees')}</dt><dd>{selected.assignees.join(', ')}</dd></>}
          </dl>
          <div className={css.badges} aria-label={t('labels')}>{selected.labels.map(label => <span key={label} className={css.badge}>{label}</span>)}</div>
          <h4>{t('workspace')}</h4>
          {selected.associations.length === 0 ? <p>{t('noWorkspace')}</p> : <ul>
            {selected.associations.map(link => <li key={JSON.stringify([link.workspaceId, link.sessionId])}>
              <span>{link.workspaceTitle}</span>{link.sessionId === undefined ? null : <p>{t('session')}: {link.sessionId}</p>}
              {link.branch === undefined ? null : <p>{t('branch')}: {link.branch}</p>}
              {link.phase === undefined ? null : <p>{t('phase')}: {link.phase === 'active' ? t('active') : t('hibernated')}</p>}
              <button className={css.button} type="button" disabled={saving} onClick={() => { void write(link) }}>{t('disassociate')}</button>
            </li>)}
          </ul>}
          {workspace === undefined ? <p>{t('chooseWorkspace')}</p> : <div className={css.filters}>
            <label className={css.filter}><span>{t('session')}</span>
              <select value={sessionId !== undefined && sessionIds.includes(sessionId) ? sessionId : ''} disabled={saving} onChange={(event) => { setSessionId(sessionIds.find(id => id === event.currentTarget.value)) }}>
                <option value="">{t('workspaceOnly')}</option>{sessionIds.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <button className={css.button} type="button" disabled={saving} onClick={() => { void write() }}>{saving ? t('saving') : t('associate')}</button>
          </div>}
        </>}
      </article>
    </div>
  </section>
}
