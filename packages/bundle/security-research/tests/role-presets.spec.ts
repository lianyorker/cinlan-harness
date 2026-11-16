/** The role-preset declarations in the bundle patch stay structurally complete. */
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)

interface PresetConfig {
  id: string
  name?: string
  order?: number
  plugins: EntryOptions[]
}

async function patchRows(): Promise<EntryOptions[]> {
  const loaded = load(await readFile(patchUrl, 'utf8'), { schema: entryListSchema })
  const patch = Array.isArray(loaded) ? loaded : loaded.insert
  return patch.flatMap((row: { insert?: EntryOptions[] } & EntryOptions) => row.insert ?? [row])
}

async function presets(): Promise<Map<string, PresetConfig>> {
  const rows = await patchRows()
  const out = new Map<string, PresetConfig>()
  for (const row of rows) {
    if (row.name !== '@deepseek-ai/dsh-agent-preset') continue
    const config = row.config as PresetConfig
    expect(out.has(config.id), `duplicate preset id ${config.id}`).toBe(false)
    out.set(config.id, config)
  }
  return out
}

function pluginNames(config: PresetConfig): readonly string[] {
  return config.plugins.map(row => String(row.name))
}

function personaPrefix(config: PresetConfig): string {
  const persona = config.plugins.find(row => row.id === 'persona')
  const prefix = (persona?.config as { prefix?: unknown } | undefined)?.prefix
  return typeof prefix === 'string' ? prefix : ''
}

describe('the role-preset declarations', () => {
  it('declares the commander and eight role presets with unique ids', async () => {
    const all = await presets()
    expect([...all.keys()].sort()).toEqual([
      'audit-report', 'audit-static', 'audit-verify',
      'redteam-asset', 'redteam-exploit', 'redteam-intranet', 'redteam-recon', 'redteam-vuln',
      'security-code-audit', 'security-redteam',
    ].sort())
    for (const config of all.values()) {
      expect(personaPrefix(config).length, `${config.id} persona is non-empty`).toBeGreaterThan(80)
      expect(pluginNames(config), `${config.id} records findings`).toContain('@deepseek-ai/dsh-tool-finding')
    }
  })

  it('exposes exactly the eight role presets on the subagent tool allowlist', async () => {
    const rows = await patchRows()
    const subagent = rows.find(row => row.name === '@deepseek-ai/dsh-tool-subagent')
    const config = subagent?.config as { allowedAgentPresets?: string[] } | undefined
    expect([...(config?.allowedAgentPresets ?? [])].sort()).toEqual([
      'audit-report', 'audit-static', 'audit-verify',
      'redteam-asset', 'redteam-exploit', 'redteam-intranet', 'redteam-recon', 'redteam-vuln',
    ].sort())
  })

  it('gives every execution role the skill library and the audit verify role a shell', async () => {
    const all = await presets()
    const roles = [...all.values()].filter(config => config.id !== 'security-redteam' && config.id !== 'security-code-audit')
    for (const config of roles) {
      expect(pluginNames(config), `${config.id} loads skills`).toContain('@deepseek-ai/dsh-tool-skill')
      expect(pluginNames(config), `${config.id} mounts the skill filesystem source`).toContain('@deepseek-ai/dsh-skill-filesystem')
    }
    const verify = all.get('audit-verify')
    expect(verify, 'audit-verify preset exists').toBeDefined()
    const verifyPlugins = verify?.plugins.filter(row => row.name === '@deepseek-ai/dsh-tool-bash' || row.name === '@deepseek-ai/dsh-tool-pwsh') ?? []
    expect(verifyPlugins.length, 'audit-verify mounts both platform shells').toBe(2)
  })

  it('gives the red-team and audit commanders the subagent seam but no scan tools', async () => {
    const all = await presets()
    for (const commander of ['security-redteam', 'security-code-audit']) {
      const config = all.get(commander)
      expect(config, `${commander} exists`).toBeDefined()
      const names = config ? pluginNames(config) : []
      expect(names, `${commander} delegates`).toContain('@deepseek-ai/dsh-tool-finding')
      expect(names, `${commander} owns no scanner`).not.toContain('@cinlan/tool-nmap')
      expect(names, `${commander} owns no cloud client`).not.toContain('@cinlan/tool-aws')
    }
  })
})
