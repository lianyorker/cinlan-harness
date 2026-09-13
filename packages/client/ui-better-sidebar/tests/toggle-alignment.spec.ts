import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/sidebar.module.css', import.meta.url)), 'utf8')
const source = readFileSync(fileURLToPath(new URL('../src/client/Sidebar.tsx', import.meta.url)), 'utf8')

describe('collapsed workbench toggle alignment', () => {
  it('centers beside a live Session log action only while the right panel is closed', () => {
    expect(css).toMatch(/\.toggleCluster\s*\{[^}]*top:\s*calc\(3px \+ env\(safe-area-inset-top\)\)/su)
    const sessionLogRule = css.match(
      /:global\(body:has\(\[data-slot='conversation.session.header.utilities'\]\)\) \.toggleCluster:not\(\[data-panel-open\]\)\s*\{[^}]*\}/su,
    )?.[0]
    expect(sessionLogRule).toMatch(/transform:\s*translateY\(11px\)/su)
    expect(css).not.toContain('data-dsh-session-log-action')
    expect(source).toMatch(/data-panel-open=\{state\.panelOpen \|\| undefined\}/u)
  })
})
