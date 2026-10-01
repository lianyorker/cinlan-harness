/** Settings navigation groups and search over feature-owned public copy. */
import type { SettingsGroupId, SettingsNavigationTarget } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsSectionRow } from './shell-contract.ts'

/** Product group order; empty groups do not create unavailable pages. */
export const SETTINGS_GROUPS: readonly SettingsGroupId[] = [
  'personal', 'ai', 'development', 'tools', 'extensions', 'experimental',
]

/** One page or field match, with the owning section and optional focus target. */
export interface SettingsSearchResult {
  section: SettingsSectionRow
  title: string
  description?: string
  target?: SettingsNavigationTarget
}

/**
 * Rank visible section labels and registered field copy; values never enter this index.
 * @param rows - Sections projected from live slot entries.
 * @param query - User-entered search terms.
 * @returns Results ordered by label relevance and then contribution order.
 */
export function searchSettings(rows: readonly SettingsSectionRow[], query: string): readonly SettingsSearchResult[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)
  if (terms.length === 0) return []
  const score = (title: string, extra: string): number => {
    const normalized = title.toLocaleLowerCase()
    const body = (title + ' ' + extra).toLocaleLowerCase()
    if (!terms.every(term => body.includes(term))) return 0
    return terms.every(term => normalized.includes(term)) ? 2 : 1
  }
  const results: (SettingsSearchResult & { score: number })[] = []
  for (const section of rows) {
    const pageScore = score(section.label, '')
    if (pageScore > 0) results.push({ section, title: section.label, score: 3 })
    for (const item of section.items) {
      const itemScore = score(item.title, [item.description ?? '', ...item.keywords].join(' '))
      if (itemScore === 0) continue
      results.push({
        section, title: item.title, ...(item.description === undefined ? {} : { description: item.description }), score: itemScore,
        target: { itemId: item.id, anchorId: item.anchorId, ...(item.tabId === undefined ? {} : { tabId: item.tabId }) },
      })
    }
  }
  return results.sort((a, b) => b.score - a.score)
}
