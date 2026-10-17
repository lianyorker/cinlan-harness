/** Native settings presentation over framework-bound report and viewing-state hooks. */
import { useEffect, useId, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { UsageQueryRequest, UsageQueryResult, UsageRow, UsageTokens } from '@deepseek-ai/dsh-api-usage-controller/types'
import type { createUsageFiltersStore } from './filters.ts'
import { requestFromFilters, sameRequest } from './filters.ts'
import type { UsageSnapshot } from './source.ts'
import type { UsageTranslate } from './csv.ts'
import type { UsageKey } from './locales.ts'
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

/** Orca-style compact magnitude for cards; exact values stay in the table and CSV. */
function compactCount(value: number): string {
  for (const [size, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const) {
    if (value >= size) {
      const scaled = value / size
      const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1).replace(/\.0$/u, '')
      return text + suffix
    }
  }
  return String(value)
}

interface DistributionSegment {
  readonly key: 'distInput' | 'distOutput' | 'distCache'
  readonly value: number
  readonly className: string | undefined
}

/** Known token buckets only; a missing cache bucket omits the cache segment. */
function distributionSegments(tokens: UsageTokens): readonly DistributionSegment[] {
  const segments: DistributionSegment[] = [
    { key: 'distInput', value: tokens.uncachedInputTokens, className: css.segInput },
    { key: 'distOutput', value: tokens.outputTokens, className: css.segOutput },
  ]
  if (tokens.cacheReadTokens !== undefined && tokens.cacheWriteTokens !== undefined) {
    segments.push({ key: 'distCache', value: tokens.cacheReadTokens + tokens.cacheWriteTokens, className: css.segCache })
  }
  return segments.filter(segment => segment.value > 0)
}

interface ProviderGroup {
  readonly provider: string | undefined
  turns: number
  attempts: number
  tokens: number | undefined
}

/** Aggregate route rows by provider; one unknown row makes the group total unavailable. */
function providerGroups(rows: readonly UsageRow[]): readonly ProviderGroup[] {
  const groups = new Map<string | undefined, ProviderGroup>()
  for (const row of rows) {
    const group = groups.get(row.provider) ?? { provider: row.provider, turns: 0, attempts: 0, tokens: 0 }
    group.turns += row.turns
    group.attempts += row.attempts
    if (group.tokens !== undefined) {
      group.tokens = row.tokens === null ? undefined : group.tokens + row.tokens.totalTokens
    }
    groups.set(row.provider, group)
  }
  return [...groups.values()]
}

function StatCards({ result, t }: { result: UsageQueryResult | undefined; t: UsageTranslate }) {
  const cards: readonly (readonly [UsageKey, string])[] = [
    ['statTurns', result ? compactCount(result.totals.turns) : '—'],
    ['statTokens', result?.totals.tokens ? compactCount(result.totals.tokens.totalTokens) : '—'],
    ['statAttempts', result ? compactCount(result.totals.attempts) : '—'],
  ]
  return <dl className={css.metrics}>
    {cards.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
  </dl>
}

function SummaryCard({ tokens, t }: { tokens: UsageTokens | null; t: UsageTranslate }) {
  const tiles: readonly (readonly [UsageKey, string | number])[] = [
    ['totalTokens', tokens?.totalTokens ?? t('unavailable')],
    ['outputTokens', tokens?.outputTokens ?? t('unavailable')],
    ['cacheReadTokens', tokens?.cacheReadTokens ?? t('unavailable')],
    ['uncachedInputTokens', tokens?.uncachedInputTokens ?? t('unavailable')],
  ]
  return <div className={css.card}>
    <h3>{t('summary')}</h3>
    <dl className={css.tiles}>
      {tiles.map(([key, value]) => <div key={key}><dt>{t(key)}</dt><dd>{value}</dd></div>)}
    </dl>
    <p className={css.help}>{t('accountingHelp')}</p>
    <p className={css.help}>{t('unavailableHelp')}</p>
  </div>
}

function DistributionCard({ tokens, t }: { tokens: UsageTokens; t: UsageTranslate }) {
  const segments = distributionSegments(tokens)
  const denom = segments.reduce((total, segment) => total + segment.value, 0)
  return <div className={css.card}>
    <h3>{t('distribution')}</h3>
    <div className={css.bar}>
      {denom === 0 ? <div className={css.barEmpty} /> :
        segments.map(segment =>
          <div key={segment.key} className={segment.className} style={{ width: `${(segment.value / denom) * 100}%` }} />)}
    </div>
    <dl className={css.legend}>
      {segments.map(segment => <div key={segment.key}>
        <dt><span className={clsx(css.swatch, segment.className)} aria-hidden="true" />{t(segment.key)}</dt>
        <dd>{segment.value}</dd>
      </div>)}
    </dl>
    {tokens.reasoningTokens !== undefined && tokens.reasoningTokens > 0 &&
      <p className={css.badge}>{compactCount(tokens.reasoningTokens)} {t('distReasoning')}</p>}
  </div>
}

function ProviderCards({ result, t, onSelect }: {
  result: UsageQueryResult
  t: UsageTranslate
  onSelect: (provider: string) => void
}) {
  const groups = providerGroups(result.rows)
  const denom = groups.reduce((total, group) => total + (group.tokens ?? 0), 0)
  if (groups.length === 0) return <p className={css.empty}>{t('noProviders')}</p>
  return <div className={css.providerGrid}>
    {groups.map((group, index) => {
      const { provider } = group
      const name = provider === undefined ? t('mixed') : provider || t('blankLabel')
      const share = group.tokens !== undefined && denom > 0 ? group.tokens / denom : undefined
      const body = <>
        <div className={css.providerHead}>
          <span className={css.providerName}>{name}</span>
          <span className={css.providerTokens}>{group.tokens === undefined ? t('unavailable') : compactCount(group.tokens)}</span>
        </div>
        <p className={css.providerMeta}>{t('statTurns')} {group.turns} · {t('statAttempts')} {group.attempts}</p>
        <div className={css.shareBar} aria-hidden="true">
          {share !== undefined && <div className={css.shareFill} style={{ width: `${share * 100}%` }} />}
        </div>
      </>
      return provider === undefined
        ? <div key={index} className={css.providerCard}>{body}</div>
        : <button key={index} type="button" className={css.providerCard} onClick={() => { onSelect(provider) }}>{body}</button>
    })}
  </div>
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
    <section data-settings-anchor="usage-overview" className={css.block}>
      <StatCards result={result} t={t} />
      {snapshot.status === 'unavailable' && <p className={css.empty} role="status">{t('serviceUnavailable')}</p>}
      {snapshot.status === 'error' && <p className={css.error} role="alert">{t('error')}</p>}
      {busy && request !== undefined && <p className={css.status} role="status">{t('loading')}</p>}
      {result && <>
        <p className={clsx(css.status, result.partial && css.warning)} role="status">{t(result.partial ? 'partial' : 'complete')}</p>
        {result.partial && <p className={css.help}>{t('partialHelp')}</p>}
      </>}
    </section>
    <section data-settings-anchor="usage-filters" className={css.block}>
      <h2>{t('filters')}</h2>
      <div className={css.filters}>
        <label className={css.field}>{t('from')}<Input type="date" value={filters.fromDate}
          aria-describedby={helpId} aria-invalid={request === undefined}
          onChange={(event) => { actions.setDate('fromDate', event.target.value) }} /></label>
        <label className={css.field}>{t('to')}<Input type="date" value={filters.toDate}
          aria-describedby={helpId} aria-invalid={request === undefined}
          onChange={(event) => { actions.setDate('toDate', event.target.value) }} /></label>
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
    <section className={css.block}>
      <div className={css.analysisHead}>
        <h2>{t('analysis')}</h2>
        <div className={css.switcher}>
          <span className={css.switcherLabel}>{t('provider')}</span>
          <select value={filters.provider === null ? '' : 'route:' + filters.provider} aria-label={t('provider')}
            onChange={(event) => { actions.setRoute('provider', event.target.value === '' ? null : event.target.value.slice(6)) }}>
            <option value="">{t('allProviders')}</option>
            {providers.map(provider => <option key={provider} value={'route:' + provider}>{provider || t('blankLabel')}</option>)}
          </select>
        </div>
        {result && <span className={css.updated}>
          {t('updatedAt')} <time dateTime={new Date(result.generatedAt).toISOString()}>
            {new Date(result.generatedAt).toLocaleString()}</time>
        </span>}
      </div>
      {result && <div className={css.analysisGrid}>
        <SummaryCard tokens={result.totals.tokens} t={t} />
        {result.totals.tokens && <DistributionCard tokens={result.totals.tokens} t={t} />}
      </div>}
    </section>
    {result && <>
      <section className={css.block}>
        <h2>{t('providersTitle')}</h2>
        <ProviderCards result={result} t={t} onSelect={(provider) => { actions.setRoute('provider', provider) }} />
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
    </>}
  </div>
}
