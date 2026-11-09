/** Host-backed settings section for the built-in REA reverse-engineering service. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconRefreshOutline16, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SecurityReaDoctorSnapshot, SecurityReaState } from '@cinlan/api-security-research-controller/types'
import type { CapabilityDefinition, CapabilitySlotProps } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './ReaSection.module.css'

/** Required REA registration inputs. */
export interface ReaSectionInjected {
  /** Page registration metadata. */
  definition: CapabilityDefinition
  /** Read the REA doctor report on the Host. */
  describeRea: (signal: AbortSignal) => Promise<SecurityReaDoctorSnapshot>
}

/** Shared renderer props preserve each feature's required inputs. */
export type ReaSectionProps = CapabilitySlotProps<ReaSectionInjected>

type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly report: SecurityReaDoctorSnapshot }

const REA_STATE_KEYS = {
  ready: 'reaStatusReady',
  connecting: 'reaStatusConnecting',
  unavailable: 'reaStatusUnavailable',
  disabled: 'reaStatusDisabled',
} as const satisfies Record<SecurityReaState, CapabilitySettingsKey>

const REA_BADGE = {
  ready: 'ready',
  connecting: 'checking',
  unavailable: 'unavailable',
  disabled: 'not-configured',
} as const satisfies Record<SecurityReaState, string>

function statusText(state: ViewState, t: ReaSectionProps['t']): string {
  if (state.phase === 'loading') return t('reaStatusConnecting')
  if (state.phase === 'error') return t('reaCheckFailed')
  const { status } = state.report
  if (status.reason === 'component-missing') return t('reaNotMounted')
  if (status.state === 'ready') return t('reaReadyDescription')
  return status.detail ?? t('reaStatusUnknown')
}

/**
 * Render the REA capability page through the Host doctor report; the page
 * only reads status and detected tools, it never launches an analysis.
 * @param props - Settings slot hooks and the read-only doctor callback.
 * @returns The localized reverse-engineering page.
 */
export function ReaSection(props: ReaSectionProps): ReactNode {
  const { describeRea, definition, t } = props
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  useEffect(() => {
    let current = true
    const abort = new AbortController()
    setState({ phase: 'loading' })
    void describeRea(abort.signal).then(
      (report) => { if (current) setState({ phase: 'ready', report }) },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false; abort.abort() }
  }, [describeRea, request])
  const loading = state.phase === 'loading'
  const status = state.phase === 'ready' ? state.report.status : undefined
  const badge = status === undefined ? (loading ? 'checking' : 'unavailable') : REA_BADGE[status.state]
  const stateKey: CapabilitySettingsKey = status === undefined
    ? (loading ? 'reaStatusConnecting' : 'reaStatusUnavailable')
    : REA_STATE_KEYS[status.state]
  const report = state.phase === 'ready' ? state.report : undefined
  return <section className={css.section} data-capability={definition.id} aria-busy={loading}>
    <p className={css.intro}>{t('reaDescription')}</p>
    <div className={css.card}>
      {state.phase === 'error' && <p className={css.failure} role="alert">{t('loadFailed')}</p>}
      <section id="rea-status" className={css.runtime}>
        <div className={css.header}>
          <div className={css.title}>
            <h2>{t('reaStatusTitle')}</h2>
            <p className={css.status} role="status">{statusText(state, t)}</p>
          </div>
          <div className={css.actions}>
            <span data-capability-status={badge}><Tag tone="neutral">{t(stateKey)}</Tag></span>
            <Button variant="outline" disabled={loading} onClick={() => { setRequest(value => value + 1) }}>
              <IconRefreshOutline16 />{t('reaRecheck')}
            </Button>
          </div>
        </div>
        {status !== undefined && status.reason !== 'component-missing' && (
          <details className={css.details}>
            <summary>{t('reaRuntimeDetails')}</summary>
            <dl className={css.metrics}>
              <div><dt>{t('reaNodeVersion')}</dt><dd>{status.nodeVersion ?? '—'}</dd></div>
              <div><dt>{t('reaRequiredNode')}</dt><dd>{status.requiredEngines ?? '—'}</dd></div>
              <div><dt>{t('reaVersion')}</dt><dd>{status.reaVersion ?? '—'}</dd></div>
              <div><dt>{t('reaToolCount')}</dt><dd>{status.toolCount ?? '—'}</dd></div>
            </dl>
            {report?.stateDir != null && <div>
              <dl className={css.diagnostics}><div><dt>{t('reaStateDir')}</dt><dd><code>{report.stateDir}</code></dd></div></dl>
            </div>}
          </details>
        )}
      </section>
      {state.phase === 'ready' && state.report.tools.length > 0 && (
        <details id="rea-tools" className={css.tools}>
          <summary className={css.toolSummary}>
            <span className={css.title}><strong>{t('reaToolsTitle')}</strong><span>{t('reaToolsDescription')}</span></span>
            <span className={css.count}>{t('reaToolsSummary', { detected: state.report.tools.filter(tool => tool.detected).length, total: state.report.tools.length })}</span>
          </summary>
          <ul className={css.toolList}>
            {state.report.tools.map(tool => (
              <li key={tool.name} className={css.tool}>
                <code>{tool.name}</code>
                <span className={css.toolState} data-detected={tool.detected}>
                  <span className={css.dot} />{t(tool.detected ? 'reaToolDetected' : 'reaToolMissing')}
                </span>
              </li>
            ))}
          </ul>
          <details className={css.details}>
            <summary>{t('reaDiagnostics')}</summary>
            <dl className={css.diagnostics}>{state.report.tools.map(tool => (
              <div key={tool.name}><dt><code>{tool.name}</code></dt><dd>{tool.detected ? (tool.version ?? t('reaToolDetected')) : (tool.hint ?? t('reaToolMissing'))}</dd></div>
            ))}</dl>
          </details>
        </details>
      )}
      <section id="rea-examples" className={css.examples}>
        <h2>{t('reaGuideTitle')}</h2>
        <p>{t('reaGuideDescription')}</p>
        <ol className={css.steps}>
          {(['Runtime', 'Target', 'Request'] as const).map(step => <li key={step}>
            <strong>{t(`reaStep${step}`)}</strong>
            <p>{t(`reaStep${step}Help`)}</p>
          </li>)}
        </ol>
        <blockquote className={css.prompt}>{t('reaExample')}</blockquote>
        <p className={css.presetNote}>{t('reaPageHelp')}</p>
      </section>
    </div>
  </section>
}
