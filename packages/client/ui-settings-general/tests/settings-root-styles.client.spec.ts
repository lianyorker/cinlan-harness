/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')

it('keeps the indicator carrier full-width without inspecting account state', () => {
  // The carrier spans the rail column with a negative-margin bleed; no
  // signed-out state variant exists in the stylesheet.
  expect(css).toMatch(/\.trigger\s*\{[^}]*width: calc\(100% \+ 4px\);[^}]*margin: 4px -2px;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.rail\s*\{[^}]*width: 36px;/)
})
