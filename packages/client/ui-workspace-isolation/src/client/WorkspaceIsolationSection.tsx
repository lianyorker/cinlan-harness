/** Workspace Isolation lease management page for Web Settings. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button, IconPauseOutline16, IconPlayOutline16, IconRefreshOutline16,
  IconTrashOutline16, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorkspaceIsolationComparisonView,
  WorkspaceIsolationFileChangeView,
  WorkspaceIsolationInspectionView,
  WorkspaceIsolationIntegrationValue,
  WorkspaceIsolationLeaseId,
  WorkspaceIsolationLeaseView,
  WorkspaceIsolationPatchValue,
  WorkspaceIsolationTeardownValue,
} from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './WorkspaceIsolationSection.module.css'

/** Host lifecycle callbacks injected by the registration. */
export interface WorkspaceIsolationSectionInjected {
  /** List current active and hibernated leases. */
  list: (signal: AbortSignal) => Promise<readonly WorkspaceIsolationLeaseView[]>
  /** Materialize one hibernated lease. */
  activate: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<void>
  /** Checkpoint and reclaim one active lease. */
  hibernate: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<void>
  /** Inspect checkout ownership and working-tree state. */
  inspect: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationInspectionView>
  /** Load bounded branch comparison data. */
  compare: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationComparisonView>
  /** Merge the managed branch into its recorded base branch. */
  merge: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationIntegrationValue>
  /** Cherry-pick linear managed-branch commits into the recorded base branch. */
  cherryPick: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationIntegrationValue>
  /** Export a complete bounded patch. */
  exportPatch: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationPatchValue>
  /** Safely delete one provider-owned checkout and integrated branch. */
  teardown: (leaseId: WorkspaceIsolationLeaseId, signal: AbortSignal) => Promise<WorkspaceIsolationTeardownValue>
  /** Remove provider-detected orphaned worktrees. */
  prune: (signal: AbortSignal) => Promise<number>
}

/** Props assembled for the Workspace Isolation settings section. */
export type WorkspaceIsolationSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.workspaceIsolation'>
  & InjectFace<WorkspaceIsolationSectionInjected>

type LeaseOperation = 'activate' | 'hibernate' | 'teardown'
type IntegrationOperation = 'merge' | 'cherryPick'
type BusyOperation = LeaseOperation | IntegrationOperation | 'inspect' | 'compare' | 'exportPatch' | 'prune'

type Confirmation =
  | { readonly kind: 'teardown'; readonly lease: WorkspaceIsolationLeaseView }
  | { readonly kind: 'merge'; readonly lease: WorkspaceIsolationLeaseView }
  | { readonly kind: 'cherryPick'; readonly lease: WorkspaceIsolationLeaseView }
  | { readonly kind: 'prune' }

interface ConfirmationCopy {
  readonly title: string
  readonly description: string
  readonly acknowledge: string
  readonly action: string
}

function sortedLeases(items: readonly WorkspaceIsolationLeaseView[]): readonly WorkspaceIsolationLeaseView[] {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.leaseId.localeCompare(right.leaseId))
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Workspace Isolation value: ${String(value)}`)
}

function confirmationCopy(
  confirmation: Confirmation | null,
  t: WorkspaceIsolationSectionProps['t'],
): ConfirmationCopy {
  if (confirmation === null) return { title: '', description: '', acknowledge: '', action: '' }
  switch (confirmation.kind) {
    case 'teardown':
      return {
        title: t('confirmTeardownTitle'),
        description: t('confirmTeardownDescription', {
          sessionId: confirmation.lease.sessionId,
          branch: confirmation.lease.branch,
        }),
        acknowledge: t('confirmTeardownAcknowledge'),
        action: t('confirmTeardownAction'),
      }
    case 'merge':
      return {
        title: t('confirmMergeTitle'),
        description: t('confirmMergeDescription', {
          branch: confirmation.lease.branch,
          baseBranch: confirmation.lease.baseBranch,
        }),
        acknowledge: t('confirmMergeAcknowledge'),
        action: t('confirmMergeAction'),
      }
    case 'cherryPick':
      return {
        title: t('confirmCherryPickTitle'),
        description: t('confirmCherryPickDescription', {
          branch: confirmation.lease.branch,
          baseBranch: confirmation.lease.baseBranch,
        }),
        acknowledge: t('confirmCherryPickAcknowledge'),
        action: t('confirmCherryPickAction'),
      }
    case 'prune':
      return {
        title: t('confirmPruneTitle'),
        description: t('confirmPruneDescription'),
        acknowledge: t('confirmPruneAcknowledge'),
        action: t('confirmPruneAction'),
      }
    default:
      return assertNever(confirmation)
  }
}

function changeLabel(
  change: WorkspaceIsolationFileChangeView,
  t: WorkspaceIsolationSectionProps['t'],
): string {
  switch (change.kind) {
    case 'added': return t('changeAdded')
    case 'modified': return t('changeModified')
    case 'deleted': return t('changeDeleted')
    case 'renamed': return t('changeRenamed')
    case 'copied': return t('changeCopied')
    case 'type-changed': return t('changeTypeChanged')
    case 'unmerged': return t('changeUnmerged')
    case 'untracked': return t('changeUntracked')
    case 'other': return t('changeOther')
    default: return assertNever(change.kind)
  }
}

function downloadPatch(patch: WorkspaceIsolationPatchValue): void {
  const url = URL.createObjectURL(new Blob([patch.content], { type: 'text/x-diff;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = patch.fileName
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Render the local-only Workspace Isolation lease administration page.
 * @param props - Settings runtime, localized copy, and lifecycle callbacks.
 * @returns The Workspace Isolation Settings section.
 */
export function WorkspaceIsolationSection(props: WorkspaceIsolationSectionProps) {
  const {
    list, activate, hibernate, inspect, compare, merge, cherryPick, exportPatch, teardown, prune, t,
  } = props
  const [leases, setLeases] = useState<readonly WorkspaceIsolationLeaseView[] | null>(null)
  const [inspections, setInspections] = useState<Record<string, WorkspaceIsolationInspectionView>>({})
  const [comparisons, setComparisons] = useState<Record<string, WorkspaceIsolationComparisonView>>({})
  const [expandedLeaseId, setExpandedLeaseId] = useState<WorkspaceIsolationLeaseId | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<{
    readonly operation: BusyOperation
    readonly leaseId?: WorkspaceIsolationLeaseId
  } | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const mounted = useRef(false)
  const loadSerial = useRef(0)
  const loadAbort = useRef<AbortController | undefined>(undefined)
  const operationAbort = useRef<AbortController | undefined>(undefined)

  const refresh = useCallback(async (): Promise<void> => {
    const serial = ++loadSerial.current
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setError(null)
    try {
      const next = await list(controller.signal)
      if (!mounted.current || controller.signal.aborted || serial !== loadSerial.current) return
      setLeases(sortedLeases(next))
      setInspections({})
      setComparisons({})
      setExpandedLeaseId(null)
    } catch (reason: unknown) {
      if (!mounted.current || controller.signal.aborted || serial !== loadSerial.current) return
      setError(failureMessage(reason))
    } finally {
      if (mounted.current && serial === loadSerial.current) {
        setLoading(false)
        if (loadAbort.current === controller) loadAbort.current = undefined
      }
    }
  }, [list])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      loadSerial.current++
      loadAbort.current?.abort()
      operationAbort.current?.abort()
    }
  }, [refresh])

  const runLeaseOperation = useCallback(async (
    operation: LeaseOperation,
    lease: WorkspaceIsolationLeaseView,
  ): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setBusy({ operation, leaseId: lease.leaseId })
    setError(null)
    setNotice(null)
    try {
      if (operation === 'activate') {
        await activate(lease.leaseId, controller.signal)
        if (mounted.current && !controller.signal.aborted) setNotice(t('noticeUpdated'))
      } else if (operation === 'hibernate') {
        await hibernate(lease.leaseId, controller.signal)
        if (mounted.current && !controller.signal.aborted) setNotice(t('noticeUpdated'))
      } else {
        const result = await teardown(lease.leaseId, controller.signal)
        if (mounted.current && !controller.signal.aborted) {
          setNotice(t(result.status === 'removed' ? 'noticeRemoved' : 'noticeBranchRetained', {
            branch: result.status === 'review' ? result.lease.branch : lease.branch,
          }))
        }
      }
      if (!mounted.current || controller.signal.aborted) return
      await refresh()
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [activate, hibernate, refresh, t, teardown])

  const loadInspection = useCallback(async (lease: WorkspaceIsolationLeaseView): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setExpandedLeaseId(lease.leaseId)
    setBusy({ operation: 'inspect', leaseId: lease.leaseId })
    setError(null)
    try {
      const inspection = await inspect(lease.leaseId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setInspections(current => ({ ...current, [lease.leaseId]: inspection }))
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [inspect])

  const loadComparison = useCallback(async (lease: WorkspaceIsolationLeaseView): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setExpandedLeaseId(lease.leaseId)
    setBusy({ operation: 'compare', leaseId: lease.leaseId })
    setError(null)
    try {
      const comparison = await compare(lease.leaseId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setComparisons(current => ({ ...current, [lease.leaseId]: comparison }))
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [compare])

  const runIntegration = useCallback(async (
    operation: IntegrationOperation,
    lease: WorkspaceIsolationLeaseView,
  ): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setBusy({ operation, leaseId: lease.leaseId })
    setError(null)
    setNotice(null)
    try {
      const result: WorkspaceIsolationIntegrationValue = operation === 'merge'
        ? await merge(lease.leaseId, controller.signal)
        : await cherryPick(lease.leaseId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setNotice(t(operation === 'merge' ? 'noticeMerged' : 'noticeCherryPicked', {
        branch: result.targetBranch,
      }))
      await refresh()
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [cherryPick, merge, refresh, t])

  const runExportPatch = useCallback(async (lease: WorkspaceIsolationLeaseView): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setBusy({ operation: 'exportPatch', leaseId: lease.leaseId })
    setError(null)
    setNotice(null)
    try {
      const patch = await exportPatch(lease.leaseId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      downloadPatch(patch)
      setNotice(t(patch.hasUntrackedFiles ? 'noticePatchExportedWithUntracked' : 'noticePatchExported', {
        fileName: patch.fileName,
      }))
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [exportPatch, t])

  const runPrune = useCallback(async (): Promise<void> => {
    operationAbort.current?.abort()
    const controller = new AbortController()
    operationAbort.current = controller
    setBusy({ operation: 'prune' })
    setError(null)
    setNotice(null)
    try {
      const count = await prune(controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setNotice(t(count === 0 ? 'noticePrunedNone' : 'noticePrunedSome', { n: count }))
      await refresh()
    } catch (reason: unknown) {
      if (mounted.current && !controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (mounted.current && operationAbort.current === controller) {
        operationAbort.current = undefined
        setBusy(null)
      }
    }
  }, [prune, refresh, t])

  const items = leases ?? []
  const activeCount = useMemo(
    () => items.filter(lease => lease.phase === 'active').length,
    [items],
  )
  const hibernatedCount = items.length - activeCount
  const initialLoading = loading && leases === null
  const anyBusy = busy !== null
  const dialogCopy = confirmationCopy(confirmation, t)

  return (
    <section
      className={css.section}
      data-workspace-isolation=""
      aria-busy={loading || anyBusy}
    >
      <header className={css.header}>
        <div className={css.intro}>
          <h2>{t('title')}</h2>
          <p>{t('description')}</p>
        </div>
        <div className={css.toolbar}>
          <span className={css.localTag}>{t('hostOnly')}</span>
          <Button
            size="sm"
            variant="outline"
            icon={<IconRefreshOutline16 size={16} />}
            disabled={loading || anyBusy}
            onClick={() => { void refresh() }}
          >
            {loading ? t('refreshing') : t('refresh')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={initialLoading || anyBusy}
            onClick={() => {
              setAcknowledged(false)
              setConfirmation({ kind: 'prune' })
            }}
          >
            {t('prune')}
          </Button>
        </div>
      </header>

      {initialLoading && <p className={css.loading} role="status">{t('loading')}</p>}

      {leases !== null && (
        <div className={css.summary} aria-label={t('total')}>
          <div className={css.metric}>
            <strong>{items.length}</strong>
            <span>{t('total')}</span>
          </div>
          <div className={css.metric}>
            <strong>{activeCount}</strong>
            <span>{t('activeCount')}</span>
          </div>
          <div className={css.metric}>
            <strong>{hibernatedCount}</strong>
            <span>{t('hibernatedCount')}</span>
          </div>
        </div>
      )}

      {error !== null && (
        <div className={css.error} role="alert">
          <span>{error}</span>
          {leases === null && (
            <Button size="sm" variant="outline" onClick={() => { void refresh() }}>
              {t('retry')}
            </Button>
          )}
        </div>
      )}
      {notice !== null && <p className={css.notice} role="status">{notice}</p>}

      {leases !== null && items.length === 0 && <p className={css.empty}>{t('empty')}</p>}

      {items.length > 0 && (
        <ul className={css.cards}>
          {items.map((lease) => {
            const leaseBusy = busy?.leaseId === lease.leaseId
            const expanded = expandedLeaseId === lease.leaseId
            const inspection = inspections[lease.leaseId]
            const comparison = comparisons[lease.leaseId]
            return (
              <li
                key={lease.leaseId}
                className={css.card}
                data-lease-id={lease.leaseId}
                data-phase={lease.phase}
                data-review-state={lease.reviewState}
              >
                <div className={css.cardHeader}>
                  <div className={css.identity}>
                    <span className={css.sessionLabel}>{t('session')}</span>
                    <code>{lease.sessionId}</code>
                  </div>
                  <div className={css.badges}>
                    {lease.reviewState === 'branch-retained' && (
                      <span className={css.reviewBadge}>{t('reviewRequired')}</span>
                    )}
                    <span className={lease.phase === 'active' ? css.phaseActive : css.phaseHibernated}>
                      <span className={css.phaseDot} aria-hidden="true" />
                      {t(lease.phase === 'active' ? 'phaseActive' : 'phaseHibernated')}
                    </span>
                  </div>
                </div>
                <dl className={css.details}>
                  <div>
                    <dt>{t('sourcePath')}</dt>
                    <dd><code title={lease.sourcePath}>{lease.sourcePath}</code></dd>
                  </div>
                  <div>
                    <dt>{t('checkoutPath')}</dt>
                    <dd><code title={lease.checkoutPath}>{lease.checkoutPath}</code></dd>
                  </div>
                  <div>
                    <dt>{t('branch')}</dt>
                    <dd><code title={lease.branch}>{lease.branch}</code></dd>
                  </div>
                  <div>
                    <dt>{t('updatedAt')}</dt>
                    <dd><time dateTime={lease.updatedAt}>{lease.updatedAt}</time></dd>
                  </div>
                </dl>
                <div className={css.actions}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={anyBusy}
                    onClick={() => {
                      if (expanded) setExpandedLeaseId(null)
                      else void loadInspection(lease)
                    }}
                  >
                    {leaseBusy && busy?.operation === 'inspect'
                      ? t('working')
                      : t(expanded ? 'hideDetails' : 'details')}
                  </Button>
                  {lease.phase === 'active'
                    ? (
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<IconPauseOutline16 size={16} />}
                        disabled={anyBusy}
                        onClick={() => { void runLeaseOperation('hibernate', lease) }}
                      >
                        {leaseBusy ? t('working') : t('hibernate')}
                      </Button>
                    )
                    : (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<IconPlayOutline16 size={16} />}
                        disabled={anyBusy}
                        onClick={() => { void runLeaseOperation('activate', lease) }}
                      >
                        {leaseBusy ? t('working') : t('activate')}
                      </Button>
                    )}
                  <Button
                    size="sm"
                    variant="outline"
                    className={css.destructive}
                    icon={<IconTrashOutline16 size={16} />}
                    disabled={anyBusy}
                    onClick={() => {
                      setAcknowledged(false)
                      setConfirmation({ kind: 'teardown', lease })
                    }}
                  >
                    {t('teardown')}
                  </Button>
                </div>

                {expanded && (
                  <div className={css.reviewPanel} data-review-panel="">
                    {inspection === undefined
                      ? <p className={css.inlineLoading}>{t('loadingDetails')}</p>
                      : (
                        <>
                          <dl className={css.reviewMetrics}>
                            <div><dt>{t('checkoutState')}</dt><dd>{t(`checkout${inspection.checkoutState === 'absent' ? 'Absent' : inspection.checkoutState === 'clean' ? 'Clean' : 'Dirty'}`)}</dd></div>
                            <div><dt>{t('baseBranch')}</dt><dd><code>{lease.baseBranch}</code></dd></div>
                            <div><dt>{t('baseHead')}</dt><dd><code>{lease.baseHead}</code></dd></div>
                            <div><dt>{t('branchHead')}</dt><dd><code>{inspection.branchHead}</code></dd></div>
                          </dl>
                          <div className={css.changeSection}>
                            <h3>{t('workingTreeChanges')}</h3>
                            {inspection.workingTreeChanges.length === 0
                              ? <p>{t('noWorkingTreeChanges')}</p>
                              : (
                                <ul className={css.changeList}>
                                  {inspection.workingTreeChanges.map(change => (
                                    <li key={`${change.kind}:${change.previousPath ?? ''}:${change.path}`}>
                                      <span>{changeLabel(change, t)}</span>
                                      <code>{change.previousPath === undefined
                                        ? change.path
                                        : `${change.previousPath} → ${change.path}`}</code>
                                    </li>
                                  ))}
                                </ul>
                              )}
                          </div>
                        </>
                      )}

                    <div className={css.reviewActions}>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={anyBusy}
                        onClick={() => { void loadComparison(lease) }}
                      >
                        {leaseBusy && busy?.operation === 'compare' ? t('working') : t('reviewChanges')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={anyBusy}
                        onClick={() => {
                          setAcknowledged(false)
                          setConfirmation({ kind: 'merge', lease })
                        }}
                      >
                        {t('merge')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={anyBusy}
                        onClick={() => {
                          setAcknowledged(false)
                          setConfirmation({ kind: 'cherryPick', lease })
                        }}
                      >
                        {t('cherryPick')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={anyBusy}
                        onClick={() => { void runExportPatch(lease) }}
                      >
                        {leaseBusy && busy?.operation === 'exportPatch' ? t('working') : t('exportPatch')}
                      </Button>
                    </div>

                    {comparison !== undefined && (
                      <div className={css.comparison}>
                        <div className={css.divergence}>
                          <span>{t('ahead', { n: comparison.ahead })}</span>
                          <span>{t('behind', { n: comparison.behind })}</span>
                          <span>{t('commitCount', { n: comparison.commits.length })}</span>
                          <span>{t('fileCount', { n: comparison.changedFiles.length })}</span>
                        </div>
                        {comparison.hasUntrackedFiles && (
                          <p className={css.warning}>{t('untrackedOmitted')}</p>
                        )}
                        {comparison.patchTruncated && (
                          <p className={css.warning}>{t('patchTruncated')}</p>
                        )}
                        <div className={css.changeSection}>
                          <h3>{t('commits')}</h3>
                          {comparison.commits.length === 0
                            ? <p>{t('noCommits')}</p>
                            : (
                              <ul className={css.commitList}>
                                {comparison.commits.map(commit => (
                                  <li key={commit.id}><code>{commit.id.slice(0, 12)}</code><span>{commit.summary}</span></li>
                                ))}
                              </ul>
                            )}
                        </div>
                        <div className={css.changeSection}>
                          <h3>{t('changedFiles')}</h3>
                          {comparison.changedFiles.length === 0
                            ? <p>{t('noChangedFiles')}</p>
                            : (
                              <ul className={css.changeList}>
                                {comparison.changedFiles.map(change => (
                                  <li key={`${change.kind}:${change.previousPath ?? ''}:${change.path}`}>
                                    <span>{changeLabel(change, t)}</span>
                                    <code>{change.previousPath === undefined
                                      ? change.path
                                      : `${change.previousPath} → ${change.path}`}</code>
                                  </li>
                                ))}
                              </ul>
                            )}
                        </div>
                        <h3 className={css.patchTitle}>{t('patch')}</h3>
                        <pre className={css.patch} aria-label={t('patch')}>
                          {comparison.patch.length === 0 ? t('emptyPatch') : comparison.patch}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <RiskConfirmation
        open={confirmation !== null}
        title={dialogCopy.title}
        description={dialogCopy.description}
        acknowledgeLabel={dialogCopy.acknowledge}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={dialogCopy.action}
        acknowledged={acknowledged}
        disabled={anyBusy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setAcknowledged(false)
          setConfirmation(null)
        }}
        onConfirm={() => {
          const target = confirmation
          if (target === null) return
          setAcknowledged(false)
          setConfirmation(null)
          switch (target.kind) {
            case 'teardown':
              void runLeaseOperation('teardown', target.lease)
              return
            case 'merge':
              void runIntegration('merge', target.lease)
              return
            case 'cherryPick':
              void runIntegration('cherryPick', target.lease)
              return
            case 'prune':
              void runPrune()
              return
            default:
              assertNever(target)
          }
        }}
      />
    </section>
  )
}
