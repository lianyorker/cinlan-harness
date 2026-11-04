/** The security-research composition keeps REA out of the default runtime and persona. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const bundleDir = new URL('../', import.meta.url)

function composedRows() {
  const warnings: string[] = []
  const rows = composeEntries(
    [loadOverlayPatches('security-rea test', fileURLToPath(new URL('cordis.patch.yml', bundleDir)))],
    warning => warnings.push(warning),
  )
  return { rows, warnings }
}

describe('security-research REA integration', () => {
  it('does not mount or depend on REA in the default composition', () => {
    const { rows, warnings } = composedRows()
    const row = rows.find(item => item.id === 'security-rea')
    expect(row).toBeUndefined()
    expect(rows.some(item => item.name === '@deepseek-ai/dsh-security-rea')).toBe(false)
    expect(warnings).toEqual([])
    const manifest = JSON.parse(readFileSync(new URL('package.json', bundleDir), 'utf8'))
    expect(manifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-security-rea')
  })

  it('categorizes the effectful mcp__rea__* tools under the assessment-scope policy', () => {
    const { rows } = composedRows()
    const row = rows.find(item => item.id === 'assessment-scope-tool-policy')
    expect(row).toBeDefined()
    const config = (row?.config ?? {}) as Record<string, readonly string[]>
    for (const key of ['shellTools', 'networkTools', 'browserTools']) {
      expect(config[key], `${key} must keep its deployment list`).toBeInstanceOf(Array)
    }
    expect(config.shellTools).toContain('bash')
    expect(config.shellTools).toContain('pwsh')
    expect(config.shellTools).toContain('mcp__rea__rizin_debug_command')
    expect(config.shellTools).toContain('mcp__rea__install_adb_package')
    expect(config.networkTools).toContain('web_search')
    expect(config.networkTools).toContain('mcp__rea__capture_browser_scenario')
    expect(config.browserTools).toContain('browser_navigate')
    // Read-only inspectors deliberately stay unlisted and pass through.
    for (const list of [config.shellTools, config.networkTools, config.browserTools]) {
      expect(list).not.toContain('mcp__rea__list_strings')
      expect(list).not.toContain('mcp__rea__procedure_pseudo_code')
      expect(list).not.toContain('mcp__rea__inspect_pe_imports')
    }
  })

  it('keeps the security persona without prescribing absent REA tools', () => {
    const persona = readFileSync(new URL('presets/security-research/agent.cordis.yml', bundleDir), 'utf8')
    expect(persona).not.toContain('mcp__rea__')
    expect(persona).not.toContain('if REA reports')
  })
})
