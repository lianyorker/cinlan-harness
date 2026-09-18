/** Locale-owned initial markup remains readable before the startup renderer connects over IPC. */

import type { DesktopLocale } from './locale.ts'

declare const __DSH_DESKTOP_THEME_CSS__: string

/**
 * Read the canonical Web theme embedded at bundle time, independent of the installed profile.
 * @returns Product color and font tokens for the shell's local stylesheet response.
 */
export function desktopStartupTheme(): string { return __DSH_DESKTOP_THEME_CSS__ }

/**
 * Fill the trusted startup HTML template with escaped locale copy.
 * @param template - Packaged startup document.
 * @param locale - Electron's selected dictionary.
 * @returns The initial localized document without inline scripts or renderer-side HTML injection.
 */
export function localizeStartupDocument(template: string, locale: DesktopLocale): string {
  const values: Readonly<Record<string, string>> = { ...locale.messages, lang: locale.id }
  return template.replaceAll(/\{\{([A-Za-z]+)\}\}/gu, (_placeholder, key: string) => {
    const value = values[key]
    if (value === undefined) throw new Error(`Desktop startup document has an unknown locale key: ${key}`)
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  })
}
