/** Work Items reads and explicit local associations through the Settings slot. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
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
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { WorkItemsSettings } from '../types.ts'
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
  checkIntegration: (provider: IntegrationProvider, signal: AbortSignal) => Promise<IntegrationPreflightSnapshot>
  hooks: { settings: Pick<SettingsScope<WorkItemsSettings>, 'getSnapshot' | 'subscribe'> }
  setVisibility: (field: keyof WorkItemsSettings, visible: boolean) => Promise<void>
  resetVisibility: (field: keyof WorkItemsSettings) => Promise<void>
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
  const settings = props.useSettings(snapshot => snapshot)
  const providers = ['github', 'gitlab', 'linear'] as const
  const sources = providers.filter(provider => settings.value?.[`${provider}Visible`] !== false)
  const [preferredSource, setSource] = useState<WorkItemSource>('github')
  const source = sources.find(provider => provider === preferredSource) ?? sources[0]
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
  const [error, setError] = useState<unknown>()
  const listController = useRef<AbortController>()
  const detailController = useRef<AbortController>()
  const writeController = useRef<AbortController>()
  const [providerStates, setProviderStates] = useState<Partial<Record<IntegrationProvider, IntegrationPreflightSnapshot>>>({})
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  const [visibilityError, setVisibilityError] = useState<unknown>()

  useEffect(() => {
    const controller = new AbortController()
    for (const provider of ['github', 'gitlab'] as const) {
      checkIntegration(provider, controller.signal).then((snapshot) => {
        if (!controller.signal.aborted) setProviderStates(prev => ({ ...prev, [provider]: snapshot }))
      }).catch(() => {
        if (!controller.signal.aborted) setProviderStates(prev => ({ ...prev, [provider]: { provider, status: 'unavailable', reason: 'probe-failed', account: null } }))
      })
    }
    return () => { controller.abort() }
  }, [checkIntegration])

  const changeVisibility = async (field: keyof WorkItemsSettings, visible?: boolean): Promise<void> => {
    setVisibilitySaving(true)
    setVisibilityError(undefined)
    try {
      if (visible === undefined) await props.resetVisibility(field)
      else await props.setVisibility(field, visible)
    } catch (cause) {
      setVisibilityError(cause ?? null)
    } finally {
      setVisibilitySaving(false)
    }
  }

  const clearDetail = useCallback(() => {
    detailController.current?.abort()
    writeController.current?.abort()
    setSelected(undefined)
    setDetailLoading(false)
    setSaving(false)
  }, [])

  const load = useCallback(async (nextCursor?: string, direction: 'reset' | 'next' | 'previous' = 'reset') => {
    listController.current?.abort()
    if (source === undefined) { setLoading(false); return }
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
      clearDetail()
      setPage(next)
      const previous = cursor.current
      setHistory(values => direction === 'reset' ? [] : direction === 'next' ? [...values, previous] : values.slice(0, -1))
      cursor.current = nextCursor
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause ?? null)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [clearDetail, list, query, scope, source, state])

  useEffect(() => {
    clearDetail()
    setPage({ items: [], truncated: false })
    setHistory([])
    cursor.current = undefined
    void load()
  }, [clearDetail, load])
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
      if (!controller.signal.aborted) setError(cause ?? null)
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
      if (!controller.signal.aborted) setError(cause ?? null)
    } finally {
      if (!controller.signal.aborted) setSaving(false)
      controller.abort()
    }
  }

  return <section className={css.section} aria-labelledby="work-items-title">
    <header className={css.header}><h1 id="work-items-title">{t('title')}</h1><p>{t('description')}</p></header>
    <section className={css.providerArea} aria-labelledby="work-items-providers">
      <h2 id="work-items-providers">{t('providerManagement')}</h2><p className={css.help}>{t('providerManagementDesc')}</p>
      {providers.map((provider) => {
        const field = `${provider}Visible` as const
        const snapshot = provider === 'linear' ? undefined : providerStates[provider]
        const connected = snapshot?.status === 'connected'
        const visible = settings.value?.[field] !== false
        const overridden = settings.user !== null && typeof settings.user === 'object' && Object.hasOwn(settings.user, field)
        return <div key={provider} className={css.providerRow} data-settings-anchor={'work-items-' + provider + '-visible'}>
          <div className={css.providerCopy}>
            <div className={css.providerHeader}><span>{t('providerVisibility', { provider: t(provider) })}</span>
              <span className={connected ? css.providerBadgeConnected : css.providerBadgeDisconnected}>
                {provider === 'linear' ? t('providerOnQuery') : snapshot === undefined || snapshot.status === 'checking' ? t('providerChecking')
                  : connected ? t('providerConnected') : snapshot.status === 'not-installed' ? t('providerNotInstalled')
                    : snapshot.status === 'not-authenticated' ? t('providerNotAuthenticated') : t('providerUnavailable')}
              </span>
            </div>
            <p className={css.help}>{t('visibilityHelp')}</p>
            {connected && snapshot.account !== null ? <p className={css.help}>{t('providerAccount')}: {snapshot.account}</p> : null}
          </div>
          <div className={css.actions}>
            <Button variant="outline" className={css.button} aria-pressed={visible} aria-label={t('providerVisibility', { provider: t(provider) })}
              disabled={visibilitySaving || settings.status !== 'ready' || !settings.writable || settings.mode !== 'host'}
              onClick={() => { void changeVisibility(field, !visible) }}>{visible ? t('providerVisible') : t('providerHidden')}</Button>
            {overridden ? <Button className={css.button} disabled={visibilitySaving || !settings.writable || settings.mode !== 'host'}
              aria-label={t('resetProvider', { provider: t(provider) })} onClick={() => { void changeVisibility(field) }}>{t('reset')}</Button> : null}
          </div>
        </div>
      })}
      {settings.status !== 'ready' || !settings.writable || settings.mode !== 'host' ? <p className={css.help}>{t('visibilityReadOnly')}</p> : null}
      {visibilityError === undefined ? null : <p role="alert" className={css.error}>{t('error', { message: errorText(visibilityError, t('unknownError')) })}</p>}
      <div className={css.providerFooter}><p className={css.help}>{t('goToIntegrationsHint')}</p>
        <Button className={css.button} onClick={close}>{t('closeSettings')}</Button></div>
    </section>
    <div className={css.filters}>
      <label className={css.filter} data-settings-anchor="work-items-source"><span>{t('source')}</span>
        <select aria-label={t('source')} value={source ?? ''} disabled={source === undefined} onChange={(event) => {
          const value = event.currentTarget.value
          setSource(value === 'linear' ? 'linear' : value === 'gitlab' ? 'gitlab' : 'github')
        }}>{source === undefined ? <option value="">{t('noVisibleProviders')}</option> : null}
          {sources.map(provider => <option key={provider} value={provider}>{t(provider)}</option>)}
        </select><span className={css.help}>{t('sourceHelp')}</span>
      </label>
      <label className={css.filter} data-settings-anchor="work-items-state"><span>{t('state')}</span>
        <select aria-label={t('state')} value={state} onChange={(event) => {
          const value = event.currentTarget.value
          setState(value === 'all' || value === 'closed' ? value : 'open')
        }}><option value="open">{t('open')}</option><option value="closed">{t('closed')}</option><option value="all">{t('all')}</option></select>
        <span className={css.help}>{t('stateHelp')}</span>
      </label>
      <label className={css.filter} data-settings-anchor="work-items-workspace-scope"><span>{t('workspaceContext')}</span>
        <select aria-label={t('workspaceContext')} value={scope ?? ''} onChange={(event) => {
          setWorkspaceId(workspaces.find(item => item.workspaceId === event.currentTarget.value)?.workspaceId)
          setSessionId(undefined)
        }}><option value="">{t('allWorkspaceContexts')}</option>
          {workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title}</option>)}
        </select><span className={css.help}>{t('workspaceScopeHelp')}</span>
      </label>
      <label className={css.filter} data-settings-anchor="work-items-query"><span>{t('search')}</span>
        <Input className={css.input ?? ''} aria-label={t('search')} value={query} maxLength={500} onChange={(event) => { setQuery(event.currentTarget.value) }} /><span className={css.help}>{t('queryHelp')}</span>
      </label>
    </div>
    <div className={css.actions}><Button variant="outline" className={css.button} disabled={loading || source === undefined} onClick={() => { void load() }}>{t('refresh')}</Button></div>
    <WorkItemWritePanel key={String(source) + ':' + (selected?.id ?? '')} source={source} item={selected} {...(props.target === undefined ? {} : { target: props.target })}
      t={t} prepareWrite={props.prepareWrite} confirmWrite={props.confirmWrite}
      cancelWrite={props.cancelWrite} listWrites={props.listWrites} />
    {error === undefined ? null : <p role="alert" className={css.error}>{t('error', { message: errorText(error, t('unknownError')) })}</p>}
    {page.truncated ? <p className={css.help}>{t('truncated')}</p> : null}
    <div className={css.layout}>
      <div>{loading ? <p className={css.help}>{t('loading')}</p> : <ul className={css.list} aria-label={t('title')}>
        {page.items.length === 0 ? <li className={css.help}>{source === undefined ? t('noVisibleProviders') : t('empty')}</li> : page.items.map(item => <li key={item.id}>
          <button className={selected?.id === item.id ? css.selected : css.item} type="button" onClick={() => { void select(item) }}>
            <span>{item.key === undefined ? item.title : item.key + ' · ' + item.title}</span><span className={css.itemMeta}>{item.source} · {item.state}</span>
          </button></li>)}
      </ul>}
      <div data-settings-anchor="work-items-paging"><p className={css.help}>{t('pagingHelp')}</p><div className={css.pager} aria-label={t('paging')}>
        <Button className={css.button} disabled={loading || history.length === 0} onClick={() => { void load(history.at(-1), 'previous') }}>{t('previous')}</Button>
        <Button className={css.button} disabled={loading || page.nextCursor === undefined} onClick={() => { void load(page.nextCursor, 'next') }}>{t('next')}</Button>
      </div></div>
      </div>
      <article className={css.detail} aria-live="polite">
        {detailLoading ? <p>{t('loading')}</p> : selected === undefined ? <p>{t('noSelection')}</p> : <>
          <h3>{selected.title}</h3>{selected.body === undefined ? null : <p>{selected.body}</p>}
          <dl><dt>{t('source')}</dt><dd>{selected.source}</dd><dt>{t('state')}</dt><dd>{selected.state}</dd>
            <dt>{t('external')}</dt><dd><a href={selected.url} target="_blank" rel="noreferrer">{selected.url}</a></dd>
            {selected.assignees.length === 0 ? null : <><dt>{t('assignees')}</dt><dd>{selected.assignees.join(', ')}</dd></>}
          </dl>
          <div className={css.badges} aria-label={t('labels')}>{selected.labels.map(label => <span key={label} className={css.badge}>{label}</span>)}</div>
        </>}
        <div data-settings-anchor="work-items-links"><h4>{t('workspace')}</h4><p className={css.help}>{t('linksHelp')}</p>
          {selected === undefined ? null : selected.associations.length === 0 ? <p>{t('noWorkspace')}</p> : <ul className={css.links}>
            {selected.associations.map(link => <li key={JSON.stringify([link.workspaceId, link.sessionId])}>
              <span>{link.workspaceTitle}</span>{link.sessionId === undefined ? null : <p>{t('session')}: {link.sessionId}</p>}
              {link.branch === undefined ? null : <p>{t('branch')}: {link.branch}</p>}
              {link.phase === undefined ? null : <p>{t('phase')}: {link.phase === 'active' ? t('active') : t('hibernated')}</p>}
              <Button className={css.button} disabled={saving} onClick={() => { void write(link) }}>{t('disassociate')}</Button>
            </li>)}
          </ul>}
        </div>
        <label className={css.filter} data-settings-anchor="work-items-session"><span>{t('session')}</span>
          <select value={sessionId !== undefined && sessionIds.includes(sessionId) ? sessionId : ''} disabled={saving || workspace === undefined || selected === undefined}
            onChange={(event) => { setSessionId(sessionIds.find(id => id === event.currentTarget.value)) }}>
            <option value="">{t('workspaceOnly')}</option>{sessionIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        {workspace === undefined ? <p className={css.help}>{t('chooseWorkspace')}</p> : selected === undefined ? null
          : <Button className={css.button} disabled={saving} onClick={() => { void write() }}>{saving ? t('saving') : t('associate')}</Button>}
      </article>
    </div>
  </section>
}
