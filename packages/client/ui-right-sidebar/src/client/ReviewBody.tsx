/** Git review panel backed by Workspace Isolation comparison data. */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceIsolationComparisonView, WorkspaceIsolationLeaseId, WorkspaceIsolationLeaseView } from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import css from './SidebarContributors.module.css'

export interface ReviewBodyInjected {
  readonly list: () => Promise<{ readonly items: readonly WorkspaceIsolationLeaseView[] }>
  readonly compare: (leaseId: WorkspaceIsolationLeaseId) => Promise<{ readonly comparison: WorkspaceIsolationComparisonView }>
}

type ReviewBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'rightSidebarContributors'> & ReviewBodyInjected

export function ReviewBody({ t, list, compare }: ReviewBodyProps): JSX.Element {
  const [leases, setLeases] = useState<readonly WorkspaceIsolationLeaseView[]>([])
  const [comparison, setComparison] = useState<WorkspaceIsolationComparisonView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    setBusy(true)
    try { setError(undefined); setLeases((await list()).items); setComparison(undefined) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }, [list])
  useEffect(() => { void refresh() }, [refresh])
  const inspect = useCallback(async (leaseId: WorkspaceIsolationLeaseId) => {
    setBusy(true)
    try { setError(undefined); setComparison((await compare(leaseId)).comparison) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }, [compare])
  return (
    <section className={css.panel}>
      <div className={css.toolbar}><button type="button" className={css.button} onClick={() => { void refresh() }} disabled={busy}>{t('review.refresh')}</button></div>
      {leases.length === 0 && !busy ? <p className={css.muted}>{t('review.empty')}</p> : null}
      {leases.length > 0 ? <select className={css.select} defaultValue="" onChange={event => { if (event.target.value !== '') void inspect(event.target.value as WorkspaceIsolationLeaseId) }} aria-label={t('review.title')}>
        <option value="">{t('review.select')}</option>
        {leases.map(lease => <option key={lease.leaseId} value={lease.leaseId}>{lease.branch}</option>)}
      </select> : null}
      {comparison !== undefined ? <>
        <p className={css.muted}>{t('review.branch')}: {comparison.lease.branch}</p>
        <h3 className={css.heading}>{t('review.changedFiles')}</h3>
        <ul className={css.items}>{comparison.changedFiles.map(file => <li key={file.path} className={css.item}>{file.path}</li>)}</ul>
        <h3 className={css.heading}>{t('review.patch')}</h3>
        <pre className={css.output}>{comparison.patch}</pre>
      </> : null}
      {busy && leases.length === 0 ? <p className={css.muted}>{t('review.loading')}</p> : null}
      {error !== undefined ? <p className={css.error} role="alert">{error}</p> : null}
    </section>
  )
}
