/** Host tool parallelism and evaluated preset capabilities in native settings rows. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutline16, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { OrchestrationSettingsKey } from './locales.ts'
import { detectOrchestrationCoverage, coverageSummary, type OrchestrationCoverage, type OrchestrationCoverageStatus } from './view.ts'
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

function Status({ status, t }: { status: OrchestrationCoverageStatus; t: Translate }): ReactNode {
  return <Tag tone={status === 'failed' || status === 'broken' ? 'danger' : 'neutral'}>{t(STATUS_KEYS[status])}</Tag>
}

function renderCoverage(state: LoadState, t: Translate): ReactNode {
  if (state.phase === 'loading') return <p className={css.help} role="status">{t('coverageLoading')}</p>
  if (state.phase === 'error') return <p className={css.error} role="alert">{t('coverageError')} {state.message}</p>
  const { coverage } = state
  if (coverage.presets.length === 0) return <p className={css.help}>{t('noPresets')}</p>
  const summary = coverageSummary(coverage)
  return <>
    <ul className={css.coverageList}>
      {coverage.presets.map(entry => (
        <li key={entry.preset.id} className={css.coverageRow}>
          <div className={css.copy}>
            <span className={css.label}>{entry.preset.name ?? entry.preset.id}</span>
            <code className={css.presetId}>{entry.preset.id}</code>
            {entry.preset.broken === undefined ? null : <p className={css.error}>{entry.preset.broken}</p>}
          </div>
          <dl className={css.capabilities}>
            <div><dt>{t('workflowTool')}</dt><dd><Status status={entry.status} t={t} /></dd></div>
            <div><dt>{t('subagentTool')}</dt><dd><Status status={entry.subagent} t={t} /></dd></div>
            <div><dt>{t('presetEngine')}</dt><dd><Status status={entry.engine} t={t} /></dd></div>
          </dl>
        </li>
      ))}
    </ul>
    <p className={css.help}>{t('coverageSummaryReady', { count: summary.ready, total: summary.total })}</p>
  </>
}

/**
 * Render editable Host tool parallelism and read-only preset capability coverage.
 * @param props - framework-bound settings state and operations.
 * @returns the settings page with search anchors and explicit availability.
 */
export function OrchestrationSection(props: OrchestrationSectionProps): ReactNode {
  const { t, loadInventory, target } = props
  const parallelism = props.useParallelism(value => value)
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const limits = useRef<HTMLDetailsElement>(null)
  const inputId = useId()
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
    if (target?.anchorId === 'orchestration-workflow-limits' && limits.current !== null) limits.current.open = true
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
      <h1 className={css.title}>{t('title')}</h1>
      <p className={css.intro}>{t('description')}</p>
    </header>
    <section>
      <h2 className={css.sectionTitle}>{t('executionTitle')}</h2>
      <div className={css.row} data-settings-anchor="orchestration-parallelism">
        <div className={css.copy}>
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
      <details className={css.details} ref={limits}>
        <summary>{t('engineOverviewTitle')}</summary>
        <div data-settings-anchor="orchestration-workflow-limits" className={css.detailContent}>
          <p className={css.help}>{t('engineOverviewDescription')}</p>
          <div className={css.row}>
            <span className={css.label}>{t('engineAvailability')}</span>
            {state.phase === 'ready' ? <Status status={state.coverage.engine} t={t} /> : <span className={css.help}>{t(state.phase === 'loading' ? 'coverageLoading' : 'coverageError')}</span>}
          </div>
          <p className={css.help}>{t('engineLimitsHelp')}</p>
        </div>
      </details>
    </section>
    <section data-settings-anchor="orchestration-coverage">
      <div className={css.sectionHeading}>
        <h2 className={css.sectionTitle}>{t('coverageTitle')}</h2>
        <Button variant="outline" icon={<IconRefreshOutline16 size={16} />} disabled={state.phase === 'loading'}
          onClick={() => { setRequest(value => value + 1) }}>{t('coverageRefresh')}</Button>
      </div>
      <p className={css.help}>{t('coverageDescription')}</p>
      {renderCoverage(state, t)}
    </section>
    <section data-settings-anchor="orchestration-examples">
      <h2 className={css.sectionTitle}>{t('examplesTitle')}</h2>
      <p className={css.help}>{t('examplesDescription')}</p>
      {(['Workflow', 'Parallel', 'Pipeline'] as const).map(example => (
        <div className={css.row} key={example}>
          <div className={css.copy}>
            <h3 className={css.label}>{t(`example${example}Title`)}</h3>
            <p className={css.help}>{t(`example${example}Description`)}</p>
          </div>
        </div>
      ))}
    </section>
  </div>
}
