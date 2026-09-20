/** Native feature pages own these fields; panel contributions show the rest. */
import type { SidebarSettingsDeclaration } from './service.ts'

const NATIVE_FIELDS: Readonly<Record<string, ReadonlySet<string>>> = {
  terminal: new Set(['terminalShell', 'terminalShellArgs', 'terminalFontFamily', 'terminalFontSize', 'terminalScrollback', 'terminalCursorStyle', 'terminalCursorBlink']),
  browser: new Set(['browserInterceptLinks', 'browserInterceptHttp', 'browserInterceptHttps']),
}

/**
 * Exclude fields already presented by the native page without dropping plugin controls.
 * @param feature The panel or viewer descriptor whose settings are presented.
 * @param embedded Whether the controls are appended to an existing native page.
 * @returns The descriptor with only its contributed settings, or the unchanged descriptor.
 */
export function featureSettings<T extends { id: string; settings?: SidebarSettingsDeclaration }>(feature: T, embedded: boolean): T {
  const owned = embedded ? NATIVE_FIELDS[feature.id] : undefined
  if (owned === undefined || feature.settings === undefined) return feature
  return { ...feature, settings: { ...feature.settings, toggles: feature.settings.toggles?.filter(toggle => !owned.has(toggle.key)) } }
}
