/**
 * Terminal font resolution tests: the custom font prefs (side card settings,
 * terminal card) resolve into xterm options with a strict fallback chain —
 * user family > theme code font > the built-in monospace stack, and the size
 * clamped into the 9–32 contract.
 */
import { describe, expect, it } from 'vitest'
import { SIDEBAR_PREFS_DEFAULTS, clampTerminalFontSize, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '../src/prefs-shared.ts'
import { DEFAULT_TERMINAL_FONT_FAMILY, resolveTerminalFont } from '../src/client/terminal-font.ts'
import { PrefsSchema } from '../src/config.ts'
import { parsePrefs } from '../src/client/prefs.ts'

describe('terminal renderer preference validation', () => {
  it.each([
    { terminalScrollback: -1 }, { terminalScrollback: 100001 }, { terminalScrollback: 1.5 },
    { terminalCursorStyle: 'beam' }, { terminalCursorBlink: 'yes' },
  ])('rejects invalid durable renderer options: %j', (patch) => {
    expect(() => PrefsSchema(patch as never)).toThrow()
  })

  it('bounds incoming scrollback and keeps safe defaults for malformed wire values', () => {
    expect(parsePrefs({ terminalScrollback: 120000, terminalCursorStyle: 'underline', terminalCursorBlink: false }))
      .toMatchObject({ terminalScrollback: 100000, terminalCursorStyle: 'underline', terminalCursorBlink: false })
    expect(parsePrefs({ terminalScrollback: Number.NaN, terminalCursorStyle: 'beam', terminalCursorBlink: 'yes' }))
      .toMatchObject({ terminalScrollback: 4000, terminalCursorStyle: 'block', terminalCursorBlink: true })
  })
})

describe('clampTerminalFontSize', () => {
  it('rounds and clamps into the 9–32 contract', () => {
    expect(clampTerminalFontSize(13)).toBe(13)
    expect(clampTerminalFontSize(15.6)).toBe(16)
    expect(clampTerminalFontSize(5)).toBe(TERMINAL_FONT_SIZE_MIN)
    expect(clampTerminalFontSize(40)).toBe(TERMINAL_FONT_SIZE_MAX)
  })
})

describe('resolveTerminalFont', () => {
  it('falls back to the theme code font when the family pref is empty', () => {
    const { fontFamily, fontSize } = resolveTerminalFont(SIDEBAR_PREFS_DEFAULTS, 'var-theme-font')
    expect(fontFamily).toBe('var-theme-font')
    expect(fontSize).toBe(13)
  })

  it('falls back to the built-in monospace stack when neither the pref nor the theme provides one', () => {
    expect(resolveTerminalFont(SIDEBAR_PREFS_DEFAULTS, undefined).fontFamily).toBe(DEFAULT_TERMINAL_FONT_FAMILY)
    // A whitespace-only pref counts as empty (theme default).
    expect(resolveTerminalFont({ ...SIDEBAR_PREFS_DEFAULTS, terminalFontFamily: '   ' }, undefined).fontFamily)
      .toBe(DEFAULT_TERMINAL_FONT_FAMILY)
  })

  it('prefers the custom family verbatim and clamps the size', () => {
    const { fontFamily, fontSize } = resolveTerminalFont(
      { ...SIDEBAR_PREFS_DEFAULTS, terminalFontFamily: '"JetBrains Mono", monospace', terminalFontSize: 40 },
      'var-theme-font',
    )
    expect(fontFamily).toBe('"JetBrains Mono", monospace')
    expect(fontSize).toBe(TERMINAL_FONT_SIZE_MAX)
  })
})
