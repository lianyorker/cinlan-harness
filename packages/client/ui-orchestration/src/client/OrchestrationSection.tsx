/** Host tool parallelism and evaluated preset capabilities in a compact settings page. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button,
  IconBranchOutline16,
  IconListChecksOutline16,
  IconRefreshOutline16,
  IconWorkflowOutline16,
  Input,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationSettingsKey } from './locales.ts'
import {
  detectOrchestrationCoverage,
  coverageSummary,
  type OrchestrationCoverage,
  type OrchestrationCoverageStatus,
} from './view.ts'
import css from './OrchestrationSection.module.css'

/** The Host setting sampled by the agent loop at the next tool-call group. */
export interface ParallelismSettings {
  /** Maximum parallel-safe calls in flight per agent step. */
  maxParallelToolCalls: number
}

/** Registration-owned reads and writes; preset composition remains read-only. */
export interface OrchestrationSectionInjected {
  readonly loadInventory: () => Promise<PluginInventorySnapshot>
  readonly hooks: { readonly parallelism: SettingsScope<ParallelismSettings> }
  /** Persist a positive integer, or remove the user override with null. */
  readonly saveParallelism: (value: number | null) => Promise<boolean>
}

/** Props assembled by the settings section renderer. */
export type OrchestrationSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.orchestration'>
  & InjectFace<OrchestrationSectionInjected>

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; coverage: OrchestrationCoverage }
  | { phase: 'error'; message: string }

type Translate = OrchestrationSectionProps['t']

const STATUS_KEYS = {
  active: 'coverageActive', configured: 'coverageConfigured', disabled: 'coverageDisabled',
  conditional: 'coverageConditional', pending: 'coveragePending', failed: 'coverageFailed',
  missing: 'coverageMissing', broken: 'coverageBroken',
} satisfies Record<OrchestrationCoverageStatus, OrchestrationSettingsKey>

const EXAMPLES = [
  { id: 'Workflow', icon: IconWorkflowOutline16 },
  { id: 'Parallel', icon: IconBranchOutline16 },
  { id: 'Pipeline', icon: IconListChecksOutline16 },
] as const

function Status({ status, t }: { status: OrchestrationCoverageStatus; t: Translate }): ReactNode {
  const tone = status === 'active' || status === 'configured' ? 'success'
    : status === 'failed' || status === 'broken' ? 'danger'
      : status === 'conditional' || status === 'pending' ? 'warning' : 'neutral'
  return <Tag tone={tone}>{t(STATUS_KEYS[status])}</Tag>
}

function CapabilityStatus({ state, t }: { state: LoadState; t: Translate }): ReactNode {
  if (state.phase === 'loading') return <Tag tone="neutral">{t('capabilityChecking')}</Tag>
  if (state.phase === 'error') return <Tag tone="danger">{t('coverageFailed')}</Tag>
  const summary = coverageSummary(state.coverage)
  if (summary.total === 0) return <Tag tone="neutral">{t('capabilityNoPresets')}</Tag>
  if (summary.ready === 0) return <Tag tone="warning">{t('capabilityNeedsSetup')}</Tag>
  return <Tag tone="success">{t('capabilityReady', { count: summary.ready })}</Tag>
}

function CoverageSummary({ state, t }: { state: LoadState; t: Translate }): ReactNode {
  if (state.phase === 'loading') return <p className={css.help} role="status">{t('coverageLoading')}</p>
  if (state.phase === 'error') return <p className={css.error} role="alert">{t('coverageError')} {state.message}</p>
  const summary = coverageSummary(state.coverage)
  return <p className={css.help}>{summary.total === 0
    ? t('noPresets')
    : t('coverageSummaryReady', { count: summary.ready, total: summary.total })}</p>
}

function CoverageDetails({ state, t }: { state: LoadState; t: Translate }): ReactNode {
  if (state.phase !== 'ready') return <CoverageSummary state={state} t={t} />
  if (state.coverage.presets.length === 0) return <p className={css.help}>{t('noPresets')}</p>
  return <ul className={css.coverageList}>
    {state.coverage.presets.map(entry => <li key={entry.preset.id} className={css.coverageRow}>
      <div className={css.presetIdentity}>
        <span className={css.label}>{entry.preset.name ?? entry.preset.id}</span>
        <code className={css.presetId}>{entry.preset.id}</code>
        {entry.preset.broken === undefined ? null : <p className={css.error}>{entry.preset.broken}</p>}
      </div>
      <dl className={css.capabilities}>
        <div><dt>{t('workflowTool')}</dt><dd><Status status={entry.status} t={t} /></dd></div>
        <div><dt>{t('subagentTool')}</dt><dd><Status status={entry.subagent} t={t} /></dd></div>
        <div><dt>{t('presetEngine')}</dt><dd><Status status={entry.engine} t={t} /></dd></div>
      </dl>
    </li>)}
  </ul>
}

/**
 * Render editable Host tool parallelism with progressively disclosed capability diagnostics.
 * @param props - framework-bound settings state and operations.
 * @returns the compact settings page with searchable capability details.
 */
export function OrchestrationSection(props: OrchestrationSectionProps): ReactNode {
  const { t, loadInventory, target } = props
  const parallelism = props.useParallelism(value => value)
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const inputId = useId()
  const capabilityTitleId = useId()
  const text = draft ?? String(parallelism.value?.maxParallelToolCalls ?? '')
  const parsed = Number(text)
  const invalid = text.trim() === '' || !Number.isSafeInteger(parsed) || parsed < 1
  const available = parallelism.status === 'ready'
  const writable = available && parallelism.writable
  const overridden = typeof parallelism.user === 'object' && parallelism.user !== null
    && Object.hasOwn(parallelism.user, 'maxParallelToolCalls')

  useEffect(() => {
    let current = true
    setState({ phase: 'loading' })
    void detectOrchestrationCoverage(loadInventory).then(
      (coverage) => { if (current) setState({ phase: 'ready', coverage }) },
      (error: unknown) => { if (current) setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) }) },
    )
    return () => { current = false }
  }, [loadInventory, request])

  useLayoutEffect(() => {
    if ((target?.anchorId === 'orchestration-workflow-limits' || target?.anchorId === 'orchestration-coverage')
      && details.current !== null) details.current.open = true
  }, [target])

  async function save(value: number | null): Promise<void> {
    if (!writable || saving) return
    setSaving(true)
    setFailed(false)
    try {
      if (await props.saveParallelism(value)) setDraft(null)
      else setFailed(true)
    } catch {
      // The settings transport may reject; retain the draft for an explicit retry.
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }

  return <div className={css.section}>
    <header className={css.heading}>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </header>

    <section className={css.capabilityCard} aria-labelledby={capabilityTitleId}>
      <div className={css.heroHeader}>
        <div className={css.heroIcon} aria-hidden="true"><IconWorkflowOutline16 size={20} /></div>
        <div className={css.heroCopy}>
          <div className={css.heroTitle}>
            <h2 id={capabilityTitleId}>{t('capabilityTitle')}</h2>
            <CapabilityStatus state={state} t={t} />
          </div>
          <p>{t('capabilityDescription')}</p>
        </div>
      </div>

      <Button variant="outline" size="sm" icon={<IconRefreshOutline16 size={16} />}
        className={css.recheckButton} disabled={state.phase === 'loading'}
        onClick={() => { setRequest(value => value + 1) }}>{t('coverageRefresh')}</Button>

      <div className={css.settingRow} data-settings-anchor="orchestration-parallelism">
        <div className={css.settingCopy}>
          <label htmlFor={inputId} className={css.label}>{t('parallelismLabel')}</label>
          <p className={css.help} id={inputId + '-help'}>{t('parallelismHelp')}</p>
          {!available ? <p className={css.help} role="status">{t(parallelism.status === 'loading' ? 'loading' : 'unavailable')}</p>
            : !parallelism.writable ? <p className={css.help}>{t('readOnly')}</p> : null}
        </div>
        <div className={css.controls}>
          <Input id={inputId} className={css.number as string} type="number" min={1} step={1}
            value={text} disabled={!writable || saving} aria-describedby={inputId + '-help'}
            aria-invalid={draft !== null && invalid}
            onChange={(event) => { setDraft(event.target.value); setFailed(false) }} />
          <Button variant="outline" disabled={!writable || saving || draft === null || invalid}
            onClick={() => { void save(parsed) }}>{t(saving ? 'saving' : 'save')}</Button>
          <Button disabled={!writable || saving || !overridden}
            onClick={() => { void save(null) }}>{t('reset')}</Button>
        </div>
      </div>
      {draft !== null && invalid ? <p className={css.error} role="alert">{t('invalidParallelism')}</p> : null}
      {failed ? <p className={css.error} role="alert">{t('saveFailed')}</p> : null}

      <div className={css.coverageSummary}>
        <h3>{t('coverageTitle')}</h3>
        <CoverageSummary state={state} t={t} />
      </div>

      <details className={css.details} ref={details}>
        <summary>{t('capabilityDetails')}</summary>
        <div className={css.detailsContent}>
          <section data-settings-anchor="orchestration-workflow-limits">
            <h3>{t('engineOverviewTitle')}</h3>
            <p className={css.help}>{t('engineOverviewDescription')}</p>
            <div className={css.engineStatus}>
              <span className={css.label}>{t('engineAvailability')}</span>
              {state.phase === 'ready' ? <Status status={state.coverage.engine} t={t} />
                : <span className={css.help}>{t(state.phase === 'loading' ? 'coverageLoading' : 'coverageError')}</span>}
            </div>
            <p className={css.help}>{t('engineLimitsHelp')}</p>
          </section>
          <section className={css.detailsSection} data-settings-anchor="orchestration-coverage">
            <h3>{t('coverageTitle')}</h3>
            <p className={css.help}>{t('coverageDetailDescription')}</p>
            <CoverageDetails state={state} t={t} />
          </section>
        </div>
      </details>
    </section>

    <section className={css.examples} data-settings-anchor="orchestration-examples">
      <h2>{t('examplesTitle')}</h2>
      <p>{t('examplesDescription')}</p>
      <div className={css.exampleGrid}>
        {EXAMPLES.map(({ id, icon: Icon }) => <article className={css.exampleCard} key={id}>
          <div className={css.exampleIcon} aria-hidden="true"><Icon size={16} /></div>
          <div>
            <h3>{t(`example${id}Title`)}</h3>
            <p>{t(`example${id}Description`)}</p>
          </div>
        </article>)}
      </div>
    </section>
  </div>
}
