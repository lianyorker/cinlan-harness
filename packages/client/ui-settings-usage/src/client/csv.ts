/** CSV projection of one displayed Host report; export never issues another query. */
import type { UsageCounts, UsageQueryResult } from '@deepseek-ai/dsh-api-usage-controller/types'
import type { UsageKey } from './locales.ts'

/** Locale callback shared by the report table and download. */
export type UsageTranslate = (key: UsageKey) => string

/** Count columns preserve the Host's canonical Turn accounting. */
export const countColumns = ['turns', 'knownTurns', 'unknownTurns', 'attempts', 'retries'] as const
/** Token columns retain unknown optional buckets and reasoning as an output subset. */
export const tokenColumns = [
  'totalTokens', 'uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens',
] as const

/**
 * Project exact counts and token buckets without treating unavailable as zero.
 * @param counts - aggregate or route row from the displayed result.
 * @param t - current UI locale.
 * @returns numeric cells followed by token values or localized unavailability.
 */
export function accountingCells(counts: UsageCounts, t: UsageTranslate): (string | number)[] {
  return [
    ...countColumns.map(key => counts[key]),
    ...tokenColumns.map(key => counts.tokens?.[key] ?? t('unavailable')),
  ]
}

/**
 * Quote CSV text and neutralize spreadsheet formulas, including whitespace prefixes.
 * @param value - exact numeric value or arbitrary provider/model/localized text.
 * @returns one RFC 4180 cell safe to open as spreadsheet text.
 */
export function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value)
  const safe = /^[\s\u0000-\u0008\u000e-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? "'" + value : value
  return '"' + safe.replaceAll('"', '""') + '"'
}

/**
 * Serialize totals, ordered route rows, interval and coverage from one report.
 * @param result - the exact ready result shown in the page.
 * @param t - current page locale; columns and status use the same dictionary.
 * @returns UTF-8 BOM CSV with CRLF row separators.
 */
export function usageCsv(result: UsageQueryResult, t: UsageTranslate): string {
  const columns: UsageKey[] = [
    'record', 'provider', 'model', ...countColumns, ...tokenColumns,
    'from', 'to', 'selectedProvider', 'selectedModel', 'generatedAt', 'coverage',
    'scannedSessions', 'skippedSessions', 'examinedEvents', 'unattributedTurns', 'reasons',
  ]
  const coverage = [
    new Date(result.request.from).toISOString(), new Date(result.request.to).toISOString(),
    result.request.provider ?? t('allProviders'), result.request.model ?? t('allModels'),
    new Date(result.generatedAt).toISOString(), t(result.partial ? 'partial' : 'complete'),
    result.scannedSessions, result.skippedSessions, result.examinedEvents, result.unattributedTurns,
    result.reasons.length ? result.reasons.map(reason => t(`reason.${reason}`)).join(' ') : t('noReasons'),
  ]
  const rows = [
    columns.map(key => t(key)),
    [t('total'), result.request.provider ?? t('allProviders'), result.request.model ?? t('allModels'), ...accountingCells(result.totals, t), ...coverage],
    ...result.rows.map(row => [
      t('route'), row.provider ?? t('mixed'), row.model ?? t('mixed'), ...accountingCells(row, t), ...coverage,
    ]),
  ]
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/**
 * Download locally produced CSV and release its object URL after activation.
 * @param content - complete report bytes, already escaped for spreadsheets.
 * @param filename - locale-owned suggested download name.
 */
export function downloadCsv(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}
