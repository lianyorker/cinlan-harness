/** Every plugin name the role presets declare resolves to a loadable module. */
import { readFile } from 'node:fs/promises'
import { load } from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'

const patchUrl = new URL('../cordis.patch.yml', import.meta.url)

interface PresetConfig {
  id: string
  plugins: EntryOptions[]
}

async function presets(): Promise<PresetConfig[]> {
  const loaded: unknown = load(await readFile(patchUrl, 'utf8'), { schema: entryListSchema })
  const patch = Array.isArray(loaded) ? loaded : (loaded as { insert: EntryOptions[] }).insert
  return patch
    .flatMap((row: { insert?: EntryOptions[] } & EntryOptions) => row.insert ?? [row])
    .filter((row: EntryOptions) => row.name === '@deepseek-ai/dsh-agent-preset')
    .map((row: EntryOptions) => row.config as PresetConfig)
}

/** Resolve a plugin package name through the workspace package registry. */
async function importPlugin(name: string): Promise<unknown> {
  // tsconfig paths resolve every @cinlan/* and @deepseek-ai/dsh-* package to
  // its source entry; Node resolves it for the dynamic import the same way
  // the Loader's source launch does.
  return await import(/* @vite-ignore */ name)
}

describe('the role preset plugin declarations', () => {
  it('resolves every declared plugin name to a loadable module with a plugin shape', async () => {
    const all = await presets()
    expect(all.length).toBeGreaterThanOrEqual(9)
    const names = new Set(all.flatMap(preset => preset.plugins.map(row => String(row.name))))
    // Every referenced package exists in this workspace and exposes a Cordis
    // plugin contract: named `apply`/`inject`/`name` exports or a default class.
    for (const name of names) {
      const module = await importPlugin(name) as Record<string, unknown>
      const isFunctionPlugin = typeof module['apply'] === 'function'
      const isDefaultClassPlugin = typeof module['default'] === 'function'
      const isNamedClassPlugin = Object.values(module).some(value => typeof value === 'function' && (value as { prototype?: unknown }).prototype !== undefined)
      expect(
        isFunctionPlugin || isDefaultClassPlugin || isNamedClassPlugin,
        `${name} exposes a Cordis plugin contract`,
      ).toBe(true)
    }
  }, 120_000)
})
