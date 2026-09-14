/** Orchestration settings section: workflow engine overview, preset coverage, and usage examples. */
import { useEffect, useState, type ReactNode } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetRow, AgentPresetDocument } from '@deepseek-ai/dsh-agent-presets/types'
import type { OrchestrationSettingsKey } from './locales.ts'
import { detectOrchestrationCoverage, coverageSummary, type OrchestrationCoverage } from './view.ts'
import css from './OrchestrationSection.module.css'

/** Injected face for the Orchestration section. */
export interface OrchestrationSectionInjected {
  readonly list: () => Promise<readonly AgentPresetRow[]>
  readonly read: (id: string) => Promise<AgentPresetDocument>
  readonly t: (key: OrchestrationSettingsKey, params?: Record<string, string | number>) => string
}

/** Owner props from the settings shell. */
export interface OrchestrationSectionProps extends OrchestrationSectionInjected {
  close: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; coverage: OrchestrationCoverage }
  | { phase: 'error'; message: string }

function useCoverage(injected: OrchestrationSectionInjected): {
  state: LoadState
  refresh: () => void
} {
  const { list, read } = injected
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  useEffect(() => {
    let current = true
    setState({ phase: 'loading' })
    void detectOrchestrationCoverage(list, read).then(
      (coverage) => { if (current) setState({ phase: 'ready', coverage }) },
      (error: unknown) => { if (current) setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { current = false }
  }, [list, read, request])
  return { state, refresh: () => { setRequest(value => value + 1) } }
}

function coverageLabel(status: 'ready' | 'missing' | 'broken', t: OrchestrationSectionInjected['t']): string {
  switch (status) {
    case 'ready': return t('coverageReady')
    case 'missing': return t('coverageMissing')
    case 'broken': return t('coverageBroken')
  }
}

function renderCoverage(state: LoadState, t: OrchestrationSectionInjected['t']): ReactNode {
  if (state.phase === 'loading') return <p className={css.loadingText}>{t('coverageLoading')}</p>
  if (state.phase === 'error') return <p className={css.errorText}>{t('coverageError')}</p>
  const { coverage } = state
  if (coverage.presets.length === 0) return <p className={css.noPresets}>{t('noPresets')}</p>
  const summary = coverageSummary(coverage)
  return <>
    <div className={css.coverageList}>
      {coverage.presets.map(entry => (
        <div key={entry.preset.id} className={css.coverageRow}>
          <span className={css.coverageName}>{entry.preset.name ?? entry.preset.id}</span>
          <span className={css.badge} data-coverage-status={entry.status} role="status">
            <span className={css.dot} aria-hidden="true" />{coverageLabel(entry.status, t)}
          </span>
        </div>
      ))}
    </div>
    <p className={css.summary}>
      {t('coverageSummaryReady', { count: summary.ready, total: summary.total })}
    </p>
  </>
}

/** The Orchestration settings section component. */
export function OrchestrationSection(props: OrchestrationSectionProps): ReactNode {
  const { t } = props
  const { state, refresh } = useCoverage(props)
  return <div className={css.section}>
    <div className={css.card}>
      <h2 className={css.cardTitle}>{t('engineOverviewTitle')}</h2>
      <p className={css.cardDescription}>{t('engineOverviewDescription')}</p>
      <div className={css.factRow}>
        <div className={css.fact}>
          <span className={css.factLabel}>{t('engineConcurrencyLabel')}</span>
          <span className={css.factValue}>{t('engineConcurrencyDescription')}</span>
        </div>
        <div className={css.fact}>
          <span className={css.factLabel}>{t('engineTotalAgentsLabel')}</span>
          <span className={css.factValue}>{t('engineTotalAgentsDescription')}</span>
        </div>
      </div>
    </div>
    <div className={css.card}>
      <h2 className={css.cardTitle}>{t('coverageTitle')}</h2>
      <p className={css.cardDescription}>{t('coverageDescription')}</p>
      {renderCoverage(state, t)}
      <button type="button" className={css.refreshButton} onClick={refresh}>
        <IconRefreshOutline16 size={16} />{t('coverageRefresh')}
      </button>
    </div>
    <div className={css.card}>
      <h2 className={css.cardTitle}>{t('examplesTitle')}</h2>
      <p className={css.cardDescription}>{t('examplesDescription')}</p>
      <div className={css.exampleList}>
        <div className={css.exampleItem}>
          <h3 className={css.exampleTitle}>{t('exampleWorkflowTitle')}</h3>
          <p className={css.exampleDescription}>{t('exampleWorkflowDescription')}</p>
        </div>
        <div className={css.exampleItem}>
          <h3 className={css.exampleTitle}>{t('exampleParallelTitle')}</h3>
          <p className={css.exampleDescription}>{t('exampleParallelDescription')}</p>
        </div>
        <div className={css.exampleItem}>
          <h3 className={css.exampleTitle}>{t('examplePipelineTitle')}</h3>
          <p className={css.exampleDescription}>{t('examplePipelineDescription')}</p>
        </div>
      </div>
    </div>
  </div>
}
