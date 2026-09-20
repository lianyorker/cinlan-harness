/** Shipped bundle membership excludes facade tools and external CLI providers. */
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'

it('ships only the guarded native CUA provider', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  expect(patch).toContain("name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'")
  expect(patch).toContain('native: ask')
  expect(patch).not.toContain('dsh-computer-use-cinlan')
  expect(patch).not.toContain('dsh-tool-computer-use')
})
