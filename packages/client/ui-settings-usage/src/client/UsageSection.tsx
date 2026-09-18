/** Native settings presentation over framework-bound report and viewing-state hooks. */
import { useEffect, useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { UsageQueryRequest, UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'
import type { createUsageFiltersStore } from './filters.ts'
import { requestFromFilters, sameRequest } from './filters.ts'
import type { UsageSnapshot } from './source.ts'
import type { UsageTranslate } from './csv.ts'
import { accountingCells, countColumns, tokenColumns, usageCsv } from './csv.ts'
import css from './UsageSection.module.css'

/** Private source and callbacks projected by the plugin registration. */
export interface UsageSectionInjected {
  /** Stable report source; the renderer supplies the useUsage hook. */
  hooks: { usage: ObservableSnapshot<UsageSnapshot> }
  /**
   * @param request - selected inclusive/exclusive UTC range and routes.
   * @returns settlement after the active query publishes success or failure.
   */
  load: (request: UsageQueryRequest) => Promise<void>
  /** Cancel outstanding work when this page leaves the tree. */
  cancel: () => void
  /**
   * @param content - escaped CSV.
   * @param filename - localized download name.
   */
  download: (content: string, filename: string) => void
}

/** Complete framework shares for the Usage settings entry. */
export type UsageSectionProps = PropsRuntime<'settings.section'>
  & PropsStore<ReturnType<typeof createUsageFiltersStore>>
  & PropsLocale<'settings.usage'> & InjectFace<UsageSectionInjected>

function routeOptions(options: readonly string[], selected: string | null): readonly string[] {
  return selected === null || options.includes(selected) ? options : [selected, ...options]
}

function UsageReport({ result, t }: { result: UsageQueryResult; t: UsageTranslate }) {
  const { totals } = result
  return <>
    <section data-settings-anchor="usage-overview" className={css.block}>
      <h2>{t('overview')}</h2>
      <p className={clsx(css.status, result.partial && css.warning)} role="status">{t(result.partial ? 'partial' : 'complete')}</p>
      {result.partial && <p className={css.help}>{t('partialHelp')}</p>}
      <dl className={css.metrics}>
        <div><dt>{t('turns')}</dt><dd>{totals.turns}</dd></div>
        <div><dt>{t('tokens')}</dt><dd>{totals.tokens?.totalTokens ?? t('unavailable')}</dd></div>
        <div><dt>{t('unknownTurns')}</dt><dd>{totals.unknownTurns}</dd></div>
      </dl>
      <dl className={css.facts}>
        {countColumns.filter(key => key !== 'turns' && key !== 'unknownTurns').map(key =>
          <div key={key}><dt>{t(key)}</dt><dd>{totals[key]}</dd></div>)}
        {tokenColumns.map(key => <div key={key}><dt>{t(key)}</dt><dd>{totals.tokens?.[key] ?? t('unavailable')}</dd></div>)}
      </dl>
      <p className={css.help}>{t('accountingHelp')}</p>
      <p className={css.help}>{t('unavailableHelp')}</p>
    </section>
    <section className={css.block}>
      <h2>{t('routes')}</h2>
      <p className={css.help}>{t('routeHelp')}</p>
      {result.rows.length === 0
        ? <p className={css.empty}>{t(result.partial ? 'noObserved' : 'empty')}</p>
        : <div className={css.tableScroll} role="region" aria-label={t('routes')} tabIndex={0}>
          <table className={css.table}>
            <thead><tr>
              <th scope="col">{t('provider')}</th><th scope="col">{t('model')}</th>
              {[...countColumns, ...tokenColumns].map(key => <th key={key} scope="col">{t(key)}</th>)}
            </tr></thead>
            <tbody>{result.rows.map((row, index) => <tr key={index}>
              <th scope="row">{row.provider === undefined ? t('mixed') : row.provider || t('blankLabel')}</th>
              <td>{row.model === undefined ? t('mixed') : row.model || t('blankLabel')}</td>
              {accountingCells(row, t).map((value, cell) => <td key={cell}>{value}</td>)}
            </tr>)}</tbody>
          </table>
        </div>}
    </section>
    <section data-settings-anchor="usage-coverage" className={css.block}>
      <h2>{t('coverage')}</h2>
      <dl className={css.facts}>
        <div><dt>{t('generatedAt')}</dt><dd><time dateTime={new Date(result.generatedAt).toISOString()}>{new Date(result.generatedAt).toISOString()}</time></dd></div>
        {(['scannedSessions', 'skippedSessions', 'examinedEvents', 'unattributedTurns'] as const).map(key =>
          <div key={key}><dt>{t(key)}</dt><dd>{result[key]}</dd></div>)}
      </dl>
      {result.reasons.length > 0 && <ul className={css.warning} aria-label={t('reasons')}>
        {result.reasons.map(reason => <li key={reason}>{t(`reason.${reason}`)}</li>)}
      </ul>}
    </section>
  </>
}

/**
 * Render exact Host accounting with view-only filters and manual refresh.
 * @param props - framework-derived locale, store, source and callback seats.
 * @returns the native settings page and its localized query states.
 */
export function UsageSection({ useStore, actions, useUsage, load, cancel, download, t }: UsageSectionProps) {
  const filters = useStore(value => value)
  const snapshot = useUsage(value => value)
  const request = useMemo(() => requestFromFilters(filters), [filters])
  const [exportFailed, setExportFailed] = useState(false)
  const helpId = useId()
  useEffect(() => {
    setExportFailed(false)
    if (request) void load(request)
    else cancel()
    return cancel
  }, [request, load, cancel])
  const result = snapshot.status === 'ready' && request && sameRequest(snapshot.result.request, request)
    ? snapshot.result : undefined
  const busy = snapshot.status === 'loading' || snapshot.status === 'idle'
    || (snapshot.status === 'ready' && result === undefined)
  const providers = routeOptions(result?.providers ?? [], filters.provider)
  const models = routeOptions(result?.models ?? [], filters.model)
  const exportReport = (displayed: UsageQueryResult): void => {
    setExportFailed(false)
    const content = usageCsv(displayed, t)
    try {
      download(content, t('csvFilename'))
    } catch {
      // Browser download failures are recoverable through the same displayed report.
      setExportFailed(true)
    }
  }
  return <div className={css.section}>
    <p className={css.intro}>{t('intro')}</p>
    <section data-settings-anchor="usage-filters" className={css.block}>
      <h2>{t('filters')}</h2>
      <div className={css.filters}>
        <label className={css.field}>{t('from')}<Input type="date" value={filters.fromDate}
          aria-describedby={helpId} aria-invalid={request === undefined}
          onChange={(event) => { actions.setDate('fromDate', event.target.value) }} /></label>
        <label className={css.field}>{t('to')}<Input type="date" value={filters.toDate}
          aria-describedby={helpId} aria-invalid={request === undefined}
          onChange={(event) => { actions.setDate('toDate', event.target.value) }} /></label>
        <label className={css.field}>{t('provider')}<select value={filters.provider === null ? '' : 'route:' + filters.provider}
          onChange={(event) => { actions.setRoute('provider', event.target.value === '' ? null : event.target.value.slice(6)) }}>
          <option value="">{t('allProviders')}</option>
          {providers.map(provider => <option key={provider} value={'route:' + provider}>{provider || t('blankLabel')}</option>)}
        </select></label>
        <label className={css.field}>{t('model')}<select value={filters.model === null ? '' : 'route:' + filters.model}
          onChange={(event) => { actions.setRoute('model', event.target.value === '' ? null : event.target.value.slice(6)) }}>
          <option value="">{t('allModels')}</option>
          {models.map(model => <option key={model} value={'route:' + model}>{model || t('blankLabel')}</option>)}
        </select></label>
      </div>
      <p id={helpId} className={css.help}>{t('dateHelp')}</p>
      {request === undefined && <p className={css.error} role="alert">{t('invalidRange')}</p>}
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={!request || busy || snapshot.status === 'unavailable'}
          onClick={request === undefined ? undefined : () => { void load(request) }}>{t('refresh')}</Button>
        <Button variant="outline" size="sm" disabled={!result}
          onClick={result === undefined ? undefined : () => { exportReport(result) }}
          title={t('exportHelp')} data-settings-anchor="usage-export">{t('export')}</Button>
      </div>
      {exportFailed && <p className={css.error} role="alert">{t('exportError')}</p>}
    </section>
    <div aria-busy={busy && request !== undefined}>
      {snapshot.status === 'unavailable' && <p className={css.empty} role="status">{t('serviceUnavailable')}</p>}
      {snapshot.status === 'error' && <p className={css.error} role="alert">{t('error')}</p>}
      {busy && request !== undefined && <p className={css.empty} role="status">{t('loading')}</p>}
      {result && <UsageReport result={result} t={t} />}
    </div>
  </div>
}
