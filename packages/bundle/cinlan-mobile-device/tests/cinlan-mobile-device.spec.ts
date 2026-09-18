import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import MobileDeviceRuntime, { MobileDeviceId } from '@deepseek-ai/dsh-mobile-device'
import * as CinlanMobileDevice from '@deepseek-ai/dsh-mobile-device-cinlan'
import * as MobileDevicePermissionPolicy from '@deepseek-ai/dsh-mobile-device-permission-policy'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolMobileDevice from '@deepseek-ai/dsh-tool-mobile-device'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Bundle from '../src/index.ts'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const FIXTURE_TIMEOUT_MS = 30_000
const MOBILE_PACKAGES = [
  '@deepseek-ai/dsh-mobile-device', '@deepseek-ai/dsh-mobile-device-cinlan',
  '@deepseek-ai/dsh-mobile-device-permission-policy', '@deepseek-ai/dsh-tool-mobile-device',
] as const

let fixtureRoot: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = undefined
}, FIXTURE_TIMEOUT_MS)

class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = {
    maxImageBytes: 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024,
    maxImagePixels: 1024, maxImageDimension: 1024, mediaTypes: ['image/png'],
  }
  validateImage(_input: SaveImageAttachment): Promise<void> { return Promise.resolve() }
  saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    return Promise.reject(new Error('fixture does not persist screenshots'))
  }
  readImage(_ref: ImageAttachmentRef): Promise<StoredImageAttachment> {
    return Promise.reject(new Error('fixture does not read screenshots'))
  }
}

async function bundleInputs(): Promise<{
  manifest: { dependencies?: Record<string, string>; dsh?: { bundle?: { patch?: string } } }
  patches: PatchOptions[]
}> {
  const manifest = JSON.parse(await readFile(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { bundle?: { patch?: string } }
  }
  expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  const parsed = yaml.load(await readFile(resolve(PACKAGE_ROOT, manifest.dsh!.bundle!.patch!), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(parsed)) throw new TypeError('cinlan-mobile-device patch must be a patch list')
  return { manifest, patches: parsed as PatchOptions[] }
}

function device(id: string, isAvailable = true) {
  return { backend: 'android', id, name: id, state: 'booted', isAvailable }
}

async function state(value: { devices: ReturnType<typeof device>[]; observeFailure?: string; hang?: boolean }): Promise<void> {
  await writeFile(join(fixtureRoot!, 'fixture-state.json'), JSON.stringify(value))
}

async function calls(): Promise<{ argv: string[]; input: string; local: boolean }[]> {
  const text = await readFile(join(fixtureRoot!, 'calls.jsonl'), 'utf8')
  return text.trim().length === 0 ? [] : text.trim().split('\n').map(line => JSON.parse(line) as { argv: string[]; input: string; local: boolean })
}

async function boot(policy: 'ask' | 'allow' | 'deny' = 'allow'): Promise<Context> {
  const { patches } = await bundleInputs()
  fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-cinlan-mobile-device-bundle-'))
  const configPath = join(fixtureRoot, 'cordis.yml')
  await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({ type: 'module' }))
  // Node consumes the provider's existing "emulator" argv entry as this fixture's filename.
  await copyFile(new URL('./fixtures/emulator.mjs', import.meta.url), join(fixtureRoot, 'emulator'))
  await writeFile(join(fixtureRoot, 'calls.jsonl'), '')
  await writeFile(join(fixtureRoot, 'settings.json'), JSON.stringify({ 'mobile-device': { defaultDeviceId: 'saved' } }))
  await state({ devices: [device('saved'), device('other')] })
  const fixtureLayer: PatchOptions[] = [{ insert: [
    { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
    { id: 'settings', name: '@deepseek-ai/dsh-settings-file', config: { path: join(fixtureRoot, 'settings.json'), watch: false } },
    { id: 'fixture-attachments', name: 'fixture-attachments' },
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
    { id: 'tools', name: '@deepseek-ai/dsh-tools' },
  ] }]
  const override: PatchOptions[] = [
    { id: 'mobile-device-cinlan', config: { providerId: 'cinlan', command: process.execPath, cwd: fixtureRoot } },
    { id: 'mobile-device-permission-policy', config: { observe: policy, touch: 'deny', textInput: 'allow', deviceNavigation: 'deny' } },
  ]
  const composed = applyEntryPatches([], structuredClone([...fixtureLayer, ...patches, ...override]), () => {})
  await writeFile(configPath, yaml.dump(composed, { lineWidth: -1, noRefs: true }))
  context = new Context()
  context.baseUrl = pathToFileURL(fixtureRoot).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-subprocess-local', LocalSubprocessRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['fixture-attachments', FixtureAttachments], ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime], ['@deepseek-ai/dsh-mobile-device', MobileDeviceRuntime],
    ['@deepseek-ai/dsh-mobile-device-cinlan', CinlanMobileDevice],
    ['@deepseek-ai/dsh-mobile-device-permission-policy', MobileDevicePermissionPolicy],
    ['@deepseek-ai/dsh-tool-mobile-device', ToolMobileDevice],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  return context
}

function execute(ctx: Context, name: string, args: Record<string, unknown>) {
  return ctx.tools.execute({ callId: ToolCallId('fixture-' + name), name, arguments: args, signal: new AbortController().signal })
}

// Several native managed-process launches share each assertion sequence.
describe('dsh-cinlan-mobile-device bundle', { timeout: FIXTURE_TIMEOUT_MS }, () => {
  it('remains opt-in and composes all permission classes as ask', async () => {
    expect(Bundle.name).toBe('cinlan-mobile-device-bundle')
    Bundle.apply()
    const { manifest, patches } = await bundleInputs()
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([...MOBILE_PACKAGES].sort())
    const basePatch = await readFile(resolve(PACKAGE_ROOT, '../base/cordis.patch.yml'), 'utf8')
    for (const packageName of MOBILE_PACKAGES) expect(basePatch).not.toContain(packageName)
    const rows = applyEntryPatches([], structuredClone(patches), () => {})
    expect(rows.map(row => row.id)).toEqual(['mobile-device', 'mobile-device-cinlan', 'mobile-device-permission-policy', 'tool-mobile-device'])
    expect(rows.find(row => row.id === 'mobile-device-permission-policy')?.config).toEqual({
      observe: 'ask', touch: 'ask', textInput: 'ask', deviceNavigation: 'ask',
    })
  })

  it.each(['ask', 'deny'] as const)('does not spawn any process under %s policy, including an omitted observation id', async (policy) => {
    const ctx = await boot(policy)
    for (const name of ['mobile_list_devices', 'mobile_observe']) {
      expect((await execute(ctx, name, {})).isError).toBe(true)
    }
    expect(await calls()).toEqual([])
    expect(ctx.settings.describe().map(value => value.ns)).toEqual(['mobile-device'])
  })

  it('uses saved settings through Loader and exact child argv, while text only reaches stdin', async () => {
    const ctx = await boot()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual(['mobile_list_devices', 'mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button'])
    expect((await ctx.systemPrompt.assemble()).sections.find(section => section.name === 'tool:mobile-device')?.text)
      .toBe(ToolMobileDevice.MOBILE_DEVICE_SYSTEM_PROMPT)
    const observed = await execute(ctx, 'mobile_observe', {})
    expect(observed).toMatchObject({ isError: false, value: { device: { device_id: 'saved' }, observation_id: 'fixture-observation' } })
    expect((await calls()).map(call => call.argv)).toEqual([
      ['emulator', 'devices', '--json'], ['emulator', 'observe', '--device', 'saved', '--no-screenshot', '--json'],
    ])
    const typed = await execute(ctx, 'mobile_type', { device_id: 'saved', observation_id: 'fixture-observation', text: 'literal secret' })
    expect(typed).toMatchObject({ isError: false, value: { device_id: 'saved', requires_fresh_observe: true } })
    const journal = await calls()
    expect(journal.at(-1)).toEqual({
      argv: ['emulator', 'type', '--text-stdin', '--device', 'saved', '--observation-id', 'fixture-observation', '--json'],
      input: 'literal secret', local: true,
    })
    expect(journal.every(call => !call.argv.includes('literal secret') && call.local)).toBe(true)
    const repeated = await execute(ctx, 'mobile_type', { device_id: 'saved', observation_id: 'fixture-observation', text: 'again' })
    expect(repeated.isError).toBe(true)
    expect(await calls()).toHaveLength(journal.length)
    await ctx.settings.update('mobile-device', { defaultDeviceId: 'missing' })
    expect(JSON.parse(await readFile(join(fixtureRoot!, 'settings.json'), 'utf8'))).toEqual({ 'mobile-device': { defaultDeviceId: 'missing' } })
    await expect(ctx.mobileDevice.observe({ deviceId: MobileDeviceId('other') })).resolves.toMatchObject({ device: { id: 'other' } })
    expect((await calls()).at(-1)?.argv).toEqual(['emulator', 'observe', '--device', 'other', '--no-screenshot', '--json'])
    const length = (await calls()).length
    expect((await execute(ctx, 'mobile_observe', {})).isError).toBe(true)
    expect((await calls()).slice(length).map(call => call.argv)).toEqual([['emulator', 'devices', '--json']])
  })

  it('never retries another available device after the selected device fails in the child', async () => {
    const ctx = await boot()
    await state({ devices: [device('saved'), device('other')], observeFailure: 'device_not_found' })
    await expect(ctx.mobileDevice.observe({})).rejects.toMatchObject({ code: 'MOBILE_DEVICE_NOT_FOUND' })
    expect((await calls()).map(call => call.argv)).toEqual([
      ['emulator', 'devices', '--json'], ['emulator', 'observe', '--device', 'saved', '--no-screenshot', '--json'],
    ])
  })

  it('cancels a ready real child and joins its managed range on disposal', async () => {
    const ctx = await boot()
    await state({ devices: [], hang: true })
    const spawn = vi.spyOn(ctx.subprocess, 'spawn')
    const controller = new AbortController()
    const reason = new Error('fixture cancelled')
    const pending = expect(ctx.mobileDevice.listDevices(controller.signal)).rejects.toBe(reason)
    await vi.waitFor(async () => { expect(await calls()).toHaveLength(1) }, { timeout: 10_000 })
    controller.abort(reason)
    await pending
    const result = spawn.mock.results[0]!
    if (result.type !== 'return') throw new Error('fixture spawn did not return a handle')
    const handle = result.value
    await ctx.fiber.dispose()
    await expect(handle.waitForExit()).resolves.toBe(true)
    expect(ctx.get('mobileDevice')).toBeUndefined()
  })
})
