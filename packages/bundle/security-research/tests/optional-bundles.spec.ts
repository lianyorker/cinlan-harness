/** Optional security bundles are actual insert patches, not inert entry arrays. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const expected = {
  'security-findings': ['finding-session', 'tool-finding'],
  'security-skills': ['security-skills'],
  'security-workflow': ['security-workflow-prompt'],
  'vuln-kb': ['vuln-kb-service', 'vuln-kb-nvd', 'tool-vuln-kb'],
}
describe('standalone security patch bundles', () => {
  it.each(Object.entries(expected))('inserts every %s capability into an empty profile', (name, ids) => {
    const directory = new URL('../../' + name + '/', import.meta.url)
    const manifest = JSON.parse(readFileSync(new URL('package.json', directory), 'utf8')) as {
      dsh: { bundle: { patch: string } }
      files: string[]
      dependencies: Record<string, string>
    }
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
    const warnings: string[] = []
    const rows = composeEntries([loadOverlayPatches('optional security test', fileURLToPath(new URL(manifest.dsh.bundle.patch, directory)))], warning => warnings.push(warning))
    expect(rows.map(row => row.id)).toEqual(ids)
    expect(warnings).toEqual([])
    for (const row of rows) expect(manifest.dependencies).toHaveProperty(row.name)
    expect(rows.filter(row => row.name === '@deepseek-ai/dsh-finding')).toEqual([])
  })
})

