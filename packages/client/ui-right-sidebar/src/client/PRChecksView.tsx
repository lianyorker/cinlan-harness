/** PR Checks summary and remediation view. */
import { useCallback, useState } from 'react'
import type { RightSidebarContributorsKey } from './locales.ts'
import {
  formatCheckDuration,
  getBrokenChecks,
  getCheckConclusion,
} from './pr-checks-fix-prompt.ts'
import type { PRCheckDetail, PRSummary } from './pr-checks-types.ts'
import css from './SidebarContributors.module.css'

export interface PRChecksViewProps {
  readonly pr?: PRSummary | null | undefined
  readonly onFixBrokenChecks?: ((pr: PRSummary) => Promise<void> | void) | undefined
  readonly onRerunChecks?: ((pr: PRSummary) => Promise<void> | void) | undefined
  readonly onRefresh?: (() => Promise<void> | void) | undefined
  readonly busy?: boolean | undefined
  readonly t: (key: RightSidebarContributorsKey, params?: Record<string, string | number>) => string
}

function getStatusLabel(check: PRCheckDetail, t: (key: RightSidebarContributorsKey) => string): string {
  const conclusion = getCheckConclusion(check)
  switch (conclusion) {
    case 'success':
      return t('review.checkStatus.success')
    case 'failure':
      return t('review.checkStatus.failure')
    case 'timed_out':
      return t('review.checkStatus.timed_out')
    case 'cancelled':
      return t('review.checkStatus.cancelled')
    default:
      if (check.status === 'in_progress') return t('review.checkStatus.in_progress')
      if (check.status === 'queued' || check.status === 'waiting') return t('review.checkStatus.queued')
      return t('review.checkStatus.in_progress')
  }
}

function getStatusBadgeClass(check: PRCheckDetail): string {
  const conclusion = getCheckConclusion(check)
  if (conclusion === 'success') return css.badgeCheckSuccess ?? ''
  if (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'cancelled') {
    return css.badgeCheckFailure ?? ''
  }
  return css.badgeCheckPending ?? ''
}

export function PRChecksView({
  pr,
  onFixBrokenChecks,
  onRerunChecks,
  onRefresh,
  busy,
  t,
}: PRChecksViewProps): JSX.Element {
  const [expandedLogs, setExpandedLogs] = useState<Readonly<Record<string, boolean>>>({})
  const [fixing, setFixing] = useState(false)
  const [fixSent, setFixSent] = useState(false)

  const toggleLog = useCallback((id: string) => {
    setExpandedLogs(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const brokenChecks = pr ? getBrokenChecks(pr.checks) : []
  const hasRunning = pr ? pr.checks.some(c => c.status === 'in_progress' || c.status === 'queued') : false

  const handleFix = useCallback(async () => {
    if (!pr || brokenChecks.length === 0) return
    setFixing(true)
    try {
      if (onFixBrokenChecks) {
        await onFixBrokenChecks(pr)
      }
      setFixSent(true)
    } finally {
      setFixing(false)
    }
  }, [pr, brokenChecks.length, onFixBrokenChecks])

  const handleRerun = useCallback(async () => {
    if (!pr) return
    if (onRerunChecks) {
      await onRerunChecks(pr)
    } else if (onRefresh) {
      await onRefresh()
    }
  }, [pr, onRerunChecks, onRefresh])

  if (!pr) {
    return (
      <div className={css.panel}>
        <p className={css.muted}>{t('review.noPR')}</p>
        {onRefresh ? (
          <div className={css.toolbar}>
            <button type="button" className={css.button} onClick={() => { void onRefresh() }} disabled={busy}>
              {t('review.refresh')}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className={css.prPanel}>
      <div className={css.prCard}>
        <div className={css.prHeader}>
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className={css.prTitle}>
            #{pr.number} {pr.title}
          </a>
          <span className={`${css.badge} ${pr.state === 'open' ? css.badgeSaved : css.badgeDraft}`}>
            {pr.state}
          </span>
        </div>
        <div className={css.prMeta}>
          <span>{pr.author}</span>
          <span>•</span>
          <span className={css.prBranchBadge}>{pr.branch}</span>
          <span>→</span>
          <span className={css.prBranchBadge}>{pr.baseBranch}</span>
        </div>
      </div>

      <div className={css.toolbar}>
        <button
          type="button"
          className={css.primaryButton}
          disabled={brokenChecks.length === 0 || fixing || busy}
          onClick={() => { void handleFix() }}
        >
          {t('review.fixBrokenChecks')}
        </button>
        <button
          type="button"
          className={css.button}
          disabled={busy}
          onClick={() => { void handleRerun() }}
        >
          {t('review.rerunChecks')}
        </button>
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          className={css.button}
          style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
        >
          {t('review.openInGit')}
        </a>
      </div>

      {fixSent ? (
        <div className={css.fixSentNotice} role="status">
          {t('review.fixPromptSent')}
        </div>
      ) : null}

      {brokenChecks.length > 0 ? (
        <div className={`${css.checkOverviewBanner} ${css.checkBannerFailure}`}>
          {t('review.checksFailed', { count: brokenChecks.length })}
        </div>
      ) : hasRunning ? (
        <div className={`${css.checkOverviewBanner} ${css.checkBannerRunning}`}>
          {t('review.checksRunning')}
        </div>
      ) : pr.checks.length > 0 ? (
        <div className={`${css.checkOverviewBanner} ${css.checkBannerSuccess}`}>
          {t('review.checksPassed')}
        </div>
      ) : (
        <p className={css.muted}>{t('review.noChecks')}</p>
      )}

      {pr.checks.length > 0 ? (
        <div className={css.prChecksSection}>
          <h4 className={css.heading}>
            {t('review.prChecksTitle', { count: pr.checks.length })}
          </h4>
          <ul className={css.checksList}>
            {pr.checks.map(check => {
              const duration = formatCheckDuration(check.startedAt, check.completedAt)
              const isExpanded = Boolean(expandedLogs[check.id])
              const statusLabel = getStatusLabel(check, t)
              const badgeClass = getStatusBadgeClass(check)

              return (
                <li key={check.id} className={css.checkItem}>
                  <div className={css.checkItemHeader}>
                    <div className={css.checkItemName}>
                      <span className={`${css.badge} ${badgeClass}`}>
                        {statusLabel}
                      </span>
                      <span>{check.name}</span>
                    </div>
                    <div className={css.checkItemMeta}>
                      {duration ? <span>{duration}</span> : null}
                      {check.logTail ? (
                        <button
                          type="button"
                          className={css.diffAddCommentBtn}
                          onClick={() => { toggleLog(check.id) }}
                        >
                          {t('review.viewLogs')}
                        </button>
                      ) : null}
                      {check.url ? (
                        <a
                          href={check.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={css.diffAddCommentBtn}
                          style={{ textDecoration: 'none' }}
                        >
                          {t('review.openInGit')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {isExpanded && check.logTail ? (
                    <pre className={css.logTailPre}>{check.logTail}</pre>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
