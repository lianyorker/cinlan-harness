/** Integrated sidebar terminal preferences resolved into xterm rendering options. */
import { clampTerminalFontSize, clampTerminalScrollback, type SidebarPrefs } from '../prefs-shared.ts'

/**
 * Resolve preferences supported by the active xterm renderer.
 * @param prefs - current integrated-sidebar terminal preferences.
 * @param themeFontFamily - theme monospace family when no explicit family is stored.
 * @returns xterm font, scrollback, and cursor options; applying them does not replace the PTY.
 */
export function resolveTerminalOptions(prefs: SidebarPrefs, themeFontFamily: string | undefined) {
  return {
    ...resolveTerminalFont(prefs, themeFontFamily),
    scrollback: clampTerminalScrollback(prefs.terminalScrollback),
    cursorStyle: prefs.terminalCursorStyle,
    cursorBlink: prefs.terminalCursorBlink,
  }
}

/** The built-in fallback stack when neither the user nor the theme sets one. */
export const DEFAULT_TERMINAL_FONT_FAMILY = '"SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

/**
 * Resolve the xterm font options for the given prefs.
 * @param prefs - the current side card preferences.
 * @param themeFontFamily - the app's theme code font (`--ds-font-family-code`
 *   token value, read live by the caller); undefined when the token is absent.
 * @returns the `fontFamily` / `fontSize` xterm options.
 */
export function resolveTerminalFont(
  prefs: SidebarPrefs,
  themeFontFamily: string | undefined,
): { fontFamily: string; fontSize: number } {
  const custom = prefs.terminalFontFamily.trim()
  return {
    fontFamily: custom !== '' ? custom : (themeFontFamily || DEFAULT_TERMINAL_FONT_FAMILY),
    fontSize: clampTerminalFontSize(prefs.terminalFontSize),
  }
}
