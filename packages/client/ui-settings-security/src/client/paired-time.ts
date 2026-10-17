/** Locale-owned wording for a paired device's relative pairing time. */
import type { RelativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilitySettingsKey } from './locales.ts'

/** Translator shape this surface passes down from its locale props. */
export type CompanionTranslate = (key: CapabilitySettingsKey, params?: Record<string, string | number>) => string

/**
 * Name one relative-time bucket with this surface's own dictionary words.
 * The bucket itself comes from `relativeTime`, so two surfaces dating the
 * same record agree on the moments and differ only in wording.
 * @param t - Locale-bound translator for this surface.
 * @param value - Bucket and magnitude produced by `relativeTime`.
 * @returns The localized phrase, e.g. "3 天前".
 */
export function relativeLabel(t: CompanionTranslate, value: RelativeTime): string {
  if (value.unit === 'now') return t('companionPairedJustNow')
  const suffix = value.unit[0]?.toUpperCase() ?? ''
  return t(`companionPaired${suffix}${value.unit.slice(1)}` as CapabilitySettingsKey, { n: value.n })
}
