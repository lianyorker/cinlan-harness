/**
 * Archived-session Settings page: the registry-global archive set joined with
 * an independent Host summary read, newest archive first. Missing logs retain
 * a row so their durable archive entries can be cleared.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import {
  Button, Input, IconSearchOutline16, IconTrashOutlineRegular, relativeTime,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './ArchivedSessionsSection.module.css'

/** Registration-side face used by the page. */
export interface ArchivedSessionsSectionInjected {
  /**
   * Read archived summaries without retaining a live Session.
   * @param signal - cancelled when the page unmounts or archive membership changes.
   * @returns available archived summaries.
   */
  loadArchived: (signal: AbortSignal) => Promise<readonly SessionSummary[]>
  /**
   * Restore one archived Session.
   * @param sessionId - Session to unarchive.
   */
  unarchive: (sessionId: SessionId) => Promise<void>
  /**
   * Ask for the Session delete confirmation dialog (the frame-wide overlay
   * entry), seeded with the row's current title. The dialog owns the Host call.
   * @param sessionId - archived Session to delete.
   * @param currentTitle - title the dialog names.
   */
  requestSessionDelete: (sessionId: SessionId, currentTitle: string) => void
}

/** Full component props assembled by the Settings slot renderer. */
export type ArchivedSessionsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.archivedSessions'>
  & InjectFace<ArchivedSessionsSectionInjected>

type Translate = ArchivedSessionsSectionProps['t']

/** One archived Session as the page renders it. */
interface ArchivedRow {
  id: SessionId
  title: string
  /** Owning Workspace title, or the ungrouped label for a Session outside every Workspace. */
  workspace: string
  updatedAt: number
}

/** Localized compact relative time of one row's last activity. */
function timeLabel(updatedAt: number, now: number, t: Translate): string {
  const { unit, n } = relativeTime(updatedAt, now)
  return unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
}

/** Whether one row matches the normalized query in its title or Workspace label. */
function matches(row: ArchivedRow, normalizedQuery: string): boolean {
  return normalizedQuery.length === 0
    || row.title.toLowerCase().includes(normalizedQuery)
    || row.workspace.toLowerCase().includes(normalizedQuery)
}

/**
 * Render the archived-session page.
 * @param props - composed slot props (see {@link ArchivedSessionsSectionProps}).
 * @returns the settings page element tree.
 */
export function ArchivedSessionsSection(props: ArchivedSessionsSectionProps): ReactNode {
  const { t, unarchive, requestSessionDelete, loadArchived, useWorkspaces } = props
  const workspacePhase = useWorkspaces(state => state.phase)
  const workspaces = useWorkspaces(state => state.items)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const [query, setQuery] = useState('')
  const [summaries, setSummaries] = useState<readonly SessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const ungrouped = t('ungrouped')

  useEffect(() => {
    if (workspacePhase !== 'ready') return
    const controller = new AbortController()
    setLoading(true)
    setFailed(false)
    void loadArchived(controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setSummaries(items)
      setLoading(false)
    }, () => {
      if (controller.signal.aborted) return
      setFailed(true)
      setLoading(false)
    })
    return () => { controller.abort() }
  }, [loadArchived, archivedSessionIds, workspacePhase, retry])

  // Archive order is oldest first; the page lists the most recently archived
  // Session first. Summary membership does not own the archive set.
  const rows = useMemo<ArchivedRow[]>(() => {
    const owners = new Map<string, string>()
    for (const workspace of workspaces) {
      for (const id of workspace.sessionIds) owners.set(id, workspace.title)
    }
    const byId = new Map(summaries.map(summary => [summary.sessionId, summary]))
    return [...archivedSessionIds].reverse().map((id) => {
      const summary = byId.get(id)
      const title = summary?.projections?.values.title
      return {
        id,
        title: typeof title === 'string' ? title : summary?.cwd ? workspaceTitleOf(summary.cwd) : id,
        workspace: owners.get(id) ?? ungrouped,
        updatedAt: summary?.updatedAt ?? 0,
      }
    })
  }, [archivedSessionIds, workspaces, summaries, ungrouped])

  if (loading || workspacePhase !== 'ready') {
    return <p className={css.status}>{t('loading')}</p>
  }

  const now = Date.now()
  const visible = rows.filter(row => matches(row, query.trim().toLowerCase()))
  const archived = archivedSessionIds.length > 0

  return (
    <div className={css.section}>
      <Input
        {...css.search === undefined ? {} : { className: css.search }}
        icon={<IconSearchOutline16 aria-hidden="true" />}
        type="search"
        data-settings-anchor="archived-sessions-search"
        value={query}
        placeholder={t('search')}
        aria-label={t('search')}
        onChange={(event) => { setQuery(event.currentTarget.value) }}
      />
      {failed ? <p className={css.status} role="alert">{t('unavailable')} <Button variant="outline" size="sm" onClick={() => { setRetry(value => value + 1) }}>{t('retry')}</Button></p> : null}
      {!archived ? <p className={css.status}>{t('empty')}</p> : null}
      {rows.length > 0 && visible.length === 0 ? <p className={css.status}>{t('emptySearch')}</p> : null}
      {visible.length > 0 ? (
        <ul className={css.list}>
          {visible.map(row => (
            <li key={row.id} className={css.row}>
              <span className={css.identity}>
                <span className={css.title}>{row.title}</span>
                <span className={css.meta}>
                  {[row.workspace, row.updatedAt === 0 ? t('missingLog') : timeLabel(row.updatedAt, now, t)].join(' · ')}
                </span>
              </span>
              <span className={css.actions}>
                <Tooltip label={t('deleteNamed', { title: row.title })} side="bottom" align="end" delayMs={500}>
                  <button
                    type="button"
                    className={css.iconButton}
                    aria-label={t('deleteNamed', { title: row.title })}
                    onClick={() => { requestSessionDelete(row.id, row.title) }}
                  >
                    <IconTrashOutlineRegular size={14} />
                  </button>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('unarchiveNamed', { title: row.title })}
                  onClick={() => {
                    unarchive(row.id).catch((reason: unknown) => {
                      console.warn('session unarchive rejected:', reason)
                    })
                  }}
                >
                  {t('unarchive')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
