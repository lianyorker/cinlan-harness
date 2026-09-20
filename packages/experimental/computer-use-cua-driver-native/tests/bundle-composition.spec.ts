/** Shipped patch through the real Loader, with only the external SDK mocked. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import ComputerUseRuntime from '@deepseek-ai/dsh-computer-use'
import * as NativeProvider from '../src/index.ts'
import * as Policy from '@deepseek-ai/dsh-computer-use-permission-policy'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({ calls: 0, shutdowns: 0, destroys: 0 }))
vi.mock('@trycua/cua-driver', () => ({ CuaDriver: { create: () => ({
  listToolsJson: async () => JSON.stringify({ tools: [{ name: 'check_permissions', description: 'Check permissions.', inputSchema: { type: 'object', properties: {} } }] }),
  callTool: async () => { sdk.calls += 1; return { rawJson: JSON.stringify({ content: [{ type: 'text', text: 'Fixture permissions unknown.' }] }) } },
  shutdown: async () => { sdk.shutdowns += 1 },
  uniffiDestroy: () => { sdk.destroys += 1 },
}) } }))

const PACKAGE_ROOT = fileURLToPath(new URL('../../../bundle/cinlan-computer-use/', import.meta.url))
let root: string | undefined
let ctx: Context | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function inputs() {
  const manifest = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; dsh: { bundle: { patch: string } } }
  const patches = yaml.load(await readFile(resolve(PACKAGE_ROOT, manifest.dsh.bundle.patch), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  return { manifest, patches }
}

describe('native computer-use bundle', () => {
  it('selects only native CUA and guards the entire SDK catalog by default', async () => {
    const { manifest, patches } = await inputs()
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@deepseek-ai/dsh-computer-use', '@deepseek-ai/dsh-computer-use-permission-policy', '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
    ])
    const rows = applyEntryPatches([], patches, () => {})
    expect(rows.map(row => row.id)).toEqual(['computer-use', 'computer-use-permission-policy', 'computer-use-cua-driver-native'])
    expect(rows[0]?.config).toEqual({ provider: 'cua-driver-native' })
    expect(rows[1]?.config).toEqual({ native: 'ask' })
    const base = await readFile(resolve(PACKAGE_ROOT, '../base/cordis.patch.yml'), 'utf8')
    for (const name of Object.keys(manifest.dependencies)) expect(base).not.toContain(name)
  })

  it.each(['ask', 'deny', 'allow'] as const)('loads the shipped composition with native policy %s', async (native) => {
    sdk.calls = 0; sdk.shutdowns = 0; sdk.destroys = 0
    const { patches } = await inputs()
    root = await mkdtemp(join(tmpdir(), 'dsh-native-bundle-'))
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt], ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-computer-use', ComputerUseRuntime], ['@deepseek-ai/dsh-computer-use-permission-policy', Policy],
      ['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', NativeProvider],
    ])
    const rows = applyEntryPatches([], [
      { insert: [{ id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' }, { id: 'tools', name: '@deepseek-ai/dsh-tools' }] },
      ...patches, { id: 'computer-use-permission-policy', config: { native } },
    ], () => {})
    const path = join(root, 'cordis.yml')
    await writeFile(path, yaml.dump(rows, { lineWidth: -1, noRefs: true }))
    const context = ctx = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = { version: 'v2', async import(name: string) {
      if (!modules.has(name)) throw new Error('Unexpected module: ' + name)
      return modules.get(name)
    } } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(path).href } })
    await context.loader.await()
    for (const entry of context.loader.entries()) await entry.fiber?.await()
    expect(context.tools.schemas().map(tool => tool.name)).toEqual(['cua_driver_native__check_permissions'])
    await expect(context.computerUse.readiness()).resolves.toMatchObject({ kind: 'tool-catalog', state: 'ready', permissions: 'unknown' })
    const result = await context.tools.execute({ name: 'cua_driver_native__check_permissions', callId: ToolCallId('bundle-native'), arguments: {}, signal: new AbortController().signal })
    expect(result.isError).toBe(native !== 'allow')
    expect(sdk.calls).toBe(native === 'allow' ? 1 : 0)
    expect(result.content).toEqual([{ type: 'text', text: native === 'allow' ? 'Fixture permissions unknown.' : native === 'deny' ? 'Error: Native computer use is denied by policy.' : 'Error: ' + Policy.COMPUTER_NATIVE_APPROVAL_REASON }])
    await context.fiber.dispose()
    expect(sdk.shutdowns).toBe(1)
    expect(sdk.destroys).toBe(1)
  })
})
