/** Native Android composition with an owned command fixture replacing only the external ADB executable. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include, { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentLimits, ImageAttachmentRef, SaveImageAttachment, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import MobileDeviceRuntime, { MobileDeviceId } from '@deepseek-ai/dsh-mobile-device'
import * as NativeAdb from '@deepseek-ai/dsh-mobile-device-adb'
import * as MobileDevicePermissionPolicy from '@deepseek-ai/dsh-mobile-device-permission-policy'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as ToolMobileDevice from '@deepseek-ai/dsh-tool-mobile-device'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as yaml from 'js-yaml'
import { afterEach, expect, it, vi } from 'vitest'

const roots: { ctx: Context; path: string }[] = []
const timeoutMs = 30_000
class FixtureAttachments extends AttachmentStore {
  readonly imageLimits: ImageAttachmentLimits = { maxImageBytes: 1024 * 1024, maxImagesPerMessage: 1, maxMessageImageBytes: 1024 * 1024 }
  async saveImage(_request: SaveImageAttachment): Promise<ImageAttachmentRef> { throw new Error('Screenshots disabled in tool fixture') }
  async getImage(_id: ImageAttachmentRef['attachmentId']): Promise<StoredImageAttachment | undefined> { return undefined }
}
afterEach(async () => {
  for (const root of roots.splice(0)) { await root.ctx.fiber.dispose(); await rm(root.path, { recursive: true, force: true }) }
  vi.restoreAllMocks()
}, timeoutMs)
async function boot(policy = 'allow') {
  const path = await mkdtemp(join(tmpdir(), 'dsh-native-adb-loader-'))
  const ctx = new Context()
  roots.push({ ctx, path })
  const devices = [{ serial: 'fixture-serial', state: 'device', transportId: '7', bootId: '11111111-2222-4333-8444-555555555555' }]
  await writeFile(join(path, 'fixture-state.json'), JSON.stringify({ devices }))
  await writeFile(join(path, 'calls.jsonl'), '')
  await writeFile(join(path, 'settings.json'), JSON.stringify({ 'mobile-device': { enabled: true, defaultDeviceId: 'android:fixture-serial' } }))
  const patches = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const fixture: PatchOptions[] = [{ insert: [
    { name: 'local-subprocess' }, { name: 'settings', config: { path: join(path, 'settings.json'), watch: false } },
    { name: 'attachments' }, { name: 'prompt' }, { name: 'tools' },
  ] }]
  const entries = applyEntryPatches([], [...fixture, ...patches,
    { id: 'mobile-device-adb', config: { providerId: 'adb', command: process.execPath, cwd: path } },
    { id: 'mobile-device-permission-policy', config: { observe: policy, touch: 'deny', textInput: 'allow', deviceNavigation: 'deny' } },
  ], () => {})
  const configPath = join(path, 'cordis.yml')
  await writeFile(configPath, yaml.dump(entries, { lineWidth: -1, noRefs: true }))
  const modules = new Map<string, unknown>([
    ['local-subprocess', LocalSubprocessRuntime], ['settings', FileSettingsProvider], ['attachments', FixtureAttachments],
    ['prompt', SystemPrompt], ['tools', ToolRuntime], ['@deepseek-ai/dsh-mobile-device', MobileDeviceRuntime],
    ['@deepseek-ai/dsh-mobile-device-adb', NativeAdb], ['@deepseek-ai/dsh-mobile-device-permission-policy', MobileDevicePermissionPolicy],
    ['@deepseek-ai/dsh-tool-mobile-device', ToolMobileDevice],
  ])
  ctx.baseUrl = pathToFileURL(path).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  // The Loader consumes only imports; this map deliberately omits production registry caches.
  ctx.loader.internal = { version: 'v2', async import(name: string) { return modules.get(name) } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const script = fileURLToPath(new URL('../../../mobile-device/mobile-device-adb/tests/fixtures/adb.mjs', import.meta.url))
  vi.spyOn(ctx.subprocess, 'spawn').mockImplementation(spec => spawn({ ...spec, argv: [process.execPath, script, ...spec.argv.slice(1)] }))
  const calls = async (): Promise<string[][]> => (await readFile(join(path, 'calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as string[])
  return { ctx, path, devices, calls }
}
it('selects native Android in the shipped bundle and preserves least-privilege policies', async () => {
  const patches = yaml.load(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  const rows = applyEntryPatches([], patches, () => {})
  expect(rows.map(row => row.id)).toEqual(['mobile-device', 'mobile-device-adb', 'mobile-device-permission-policy', 'tool-mobile-device'])
  expect(rows[0]?.config).toEqual({ provider: 'adb' })
  expect(rows[2]?.config).toEqual({ observe: 'ask', touch: 'ask', textInput: 'ask', deviceNavigation: 'ask' })
})
it('observes an exact transport through Loader and consumes the model input token once', async () => {
  const b = await boot()
  const observed = await b.ctx.mobileDevice.observe({ captureScreenshot: false })
  expect(observed.tree).toContain('Controlled Android fixture')
  expect(observed.device.id).toBe('android:fixture-serial')
  const result = await b.ctx.tools.execute({
    callId: ToolCallId('native-adb-type'), name: 'mobile_type',
    arguments: { device_id: observed.device.id, observation_id: observed.observationId, text: 'private text' },
    signal: new AbortController().signal,
  })
  expect(result.isError).toBe(false)
  expect(JSON.stringify(result)).not.toContain('private text')
  const calls = await b.calls()
  expect(calls).toContainEqual(['-t', '7', 'shell', 'input', 'text', 'private%stext'])
  expect(calls.some(args => args.includes('orca') || args.includes('emulator'))).toBe(false)
  await expect(b.ctx.mobileDevice.typeText({ deviceId: observed.device.id, observationId: observed.observationId, text: 'again' }))
    .rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
}, timeoutMs)
it('keeps denied tool observation from starting any native command', async () => {
  const b = await boot('deny')
  const result = await b.ctx.tools.execute({ callId: ToolCallId('native-adb-denied'), name: 'mobile_list_devices', arguments: {}, signal: new AbortController().signal })
  expect(result.isError).toBe(true)
  expect(await b.calls()).toEqual([])
}, timeoutMs)
it('rejects a changed transport and never falls back to another connected device', async () => {
  const b = await boot()
  const observed = await b.ctx.mobileDevice.observe({ captureScreenshot: false })
  await writeFile(join(b.path, 'fixture-state.json'), JSON.stringify({ devices: [{ ...b.devices[0], transportId: '8' }] }))
  await expect(b.ctx.mobileDevice.pressButton({ deviceId: observed.device.id, observationId: observed.observationId, button: 'home' }))
    .rejects.toMatchObject({ code: 'MOBILE_OBSERVATION_STALE' })
  expect((await b.calls()).some(args => args.includes('input'))).toBe(false)
  await expect(b.ctx.mobileDevice.observe({ deviceId: MobileDeviceId('android:missing'), captureScreenshot: false }))
    .rejects.toMatchObject({ code: 'MOBILE_DEVICE_NOT_FOUND' })
}, timeoutMs)
