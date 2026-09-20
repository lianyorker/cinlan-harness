/** Voice resource actions use the real Host provider and Remote; only model hosting and native inference are fixtures. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire, Module } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, vi } from 'vitest'
import { modelFixture, nativeRecognizer } from '../../../packages/api/voice-controller/tests/harness.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from './support.ts'

it('manages real voice tasks across navigation and tests captured PCM without saving audio', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-browser-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let restoreNative: (() => void) | undefined
  try {
    const fixture = await modelFixture()
    const native = nativeRecognizer('Captured microphone fixture.')
    // Loader uses Node's external module identity; the source-level spy alone cannot replace that dependency.
    const nativeRequire = createRequire(new URL('../../../packages/voice/voice-sherpa-onnx/package.json', import.meta.url))
    const nativePath = nativeRequire.resolve('sherpa-onnx-node')
    const previousNative = nativeRequire.cache[nativePath]
    const nativeModule = new Module(nativePath)
    nativeModule.filename = nativePath
    nativeModule.loaded = true
    nativeModule.exports = native.load()
    nativeRequire.cache[nativePath] = nativeModule
    restoreNative = () => {
      if (previousNative === undefined) Reflect.deleteProperty(nativeRequire.cache, nativePath)
      else nativeRequire.cache[nativePath] = previousNative
    }
    const overlay = join(root, 'voice.patch.yml')
    await writeFile(overlay, JSON.stringify([{ id: 'voice-sherpa-onnx', config: {
      cacheRoot: join(root, 'cache'), downloadConcurrency: 1, downloadMaxAttempts: 1,
    } }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home') })
    const plugin = join(root, 'voice-fixture.mjs')
    await writeFile(plugin, [
      "export const inject = ['voice'];",
      'export function apply(ctx, config) { ctx.effect(() => ctx.voice.registerModel(config.definition)); }',
    ].join('\n') + '\n')
    const entryId = await scaffold.ctx.loader.create({ name: pathToFileURL(plugin).href, config: { definition: fixture.definition } })
    await scaffold.ctx.loader.await()
    const status = async () => {
      const rows = await scaffold!.ctx.voice.modelsList(new AbortController().signal)
      const row = rows.models.find(model => model.definition.id === fixture.definition.id)
      if (row === undefined) throw new Error('Browser voice fixture model was not registered')
      return row
    }

    // Chromium reads this owned PCM tone as an external microphone; no user device is opened.
    const audio = Buffer.alloc(44 + 16_000 * 2 * 2)
    audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVEfmt ', 8)
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22)
    audio.writeUInt32LE(16_000, 24); audio.writeUInt32LE(32_000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34)
    audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40)
    for (let i = 0; i < 32_000; i++) audio.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16_000) * 8000), 44 + i * 2)
    const audioPath = join(root, 'microphone.wav')
    await writeFile(audioPath, audio)
    browser = await chromium.launch({ args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-audio-capture=' + audioPath,
    ] })
    const page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    await page.addInitScript(() => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      const observations = { requests: 0, streams: [] as MediaStream[] }
      Object.defineProperty(window, '__voiceCapture', { value: observations })
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        observations.requests += 1
        const stream = await original(constraints)
        observations.streams.push(stream)
        return stream
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: 'Voice', exact: true }).click()
    const section = page.locator('[data-voice-settings-panel]')
    const row = section.getByRole('listitem').filter({ hasText: fixture.definition.name })
    await row.getByRole('button', { name: 'Download', exact: true }).waitFor()
    expect(await page.evaluate(() => (window as unknown as { __voiceCapture: { requests: number } }).__voiceCapture.requests)).toBe(0)
    expect(await section.getByRole('button', { name: 'Start microphone test' }).isDisabled()).toBe(true)

    const held = fixture.hold()
    await row.getByRole('button', { name: 'Download', exact: true }).click()
    await held.entered
    await expect.poll(async () => (await status()).task?.state).toBe('running')
    const firstTask = (await status()).task!.taskId
    await row.getByRole('button', { name: 'Cancel', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Notifications', exact: true }).click()
    expect((await status()).task?.taskId).toBe(firstTask)
    await page.getByRole('button', { name: 'Voice', exact: true }).click()
    await row.getByRole('button', { name: 'Cancel', exact: true }).click()
    await held.closed
    await expect.poll(async () => (await status()).task?.state).toBe('cancelled')
    held.release()
    await row.getByText('Task cancelled', { exact: false }).waitFor()

    await row.getByRole('button', { name: 'Download', exact: true }).click()
    await expect.poll(async () => (await status()).resource.integrity).toBe('verified')
    const installed = await status()
    if (installed.status.state !== 'ready') throw new Error('Expected committed model generation')
    for (const [name, bytes] of fixture.files) expect(await readFile(join(installed.status.cacheDir, name))).toEqual(bytes)
    await row.getByRole('button', { name: 'Reinstall', exact: true }).waitFor()
    expect(await row.getByRole('button', { name: 'Update', exact: true }).isDisabled()).toBe(true)
    await row.getByRole('button', { name: 'Reinstall', exact: true }).click()
    await expect.poll(async () => (await status()).resource.revision).not.toBe(installed.resource.revision)
    expect((await status()).resource.installedVersion).toBe(installed.resource.installedVersion)

    const changedBytes = Buffer.from('new pinned encoder fixture')
    fixture.files.set('encoder.onnx', changedBytes)
    if (fixture.definition.download.type !== 'files') throw new Error('Expected a file model fixture')
    const changedDefinition = { ...fixture.definition, download: { ...fixture.definition.download,
      entries: fixture.definition.download.entries.map(file => file.name === 'encoder.onnx'
        ? { ...file, bytes: changedBytes.length, sha256: createHash('sha256').update(changedBytes).digest('hex') } : file),
    } }
    await scaffold.ctx.loader.update(entryId, { config: { definition: changedDefinition } })
    await scaffold.ctx.loader.await()
    await section.getByRole('button', { name: 'Check model versions' }).click()
    await expect.poll(() => row.getByRole('button', { name: 'Update', exact: true }).isEnabled()).toBe(true)
    await row.getByRole('button', { name: 'Update', exact: true }).click()
    await expect.poll(async () => (await status()).resource.installedVersion).not.toBe(installed.resource.installedVersion)
    await expect.poll(async () => (await status()).resource.updateAvailable).toBe(false)

    await section.getByRole('combobox', { name: 'Speech Model', exact: true }).selectOption(fixture.definition.id)
    await expect.poll(() => section.getByRole('button', { name: 'Start microphone test' }).isEnabled()).toBe(true)
    await section.getByRole('button', { name: 'Start microphone test' }).click()
    await section.getByText('Recording...', { exact: true }).waitFor()
    await expect.poll(async () => Number(await section.getByRole('meter').getAttribute('value'))).toBeGreaterThan(0)
    await section.getByRole('button', { name: 'Stop and transcribe' }).click()
    await section.getByText('Captured microphone fixture.', { exact: true }).waitFor()
    expect(native.construct).toHaveBeenCalledOnce()
    expect(native.acceptWaveform).toHaveBeenCalledTimes(2)
    const captured = native.acceptWaveform.mock.calls[0]![0]
    expect(captured.sampleRate).toBe(16_000)
    expect(captured.samples.length).toBeGreaterThan(0)
    expect(captured.samples.length).toBeLessThanOrEqual(16_000 * 10)
    expect(captured.samples.some(sample => Math.abs(sample) > 0.01)).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { __voiceCapture: { streams: MediaStream[] } })
      .__voiceCapture.streams.every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
    if (webSnapshotMode() === 'refresh') await mkdir(fileURLToPath(new URL('./expected/voice-settings', import.meta.url)), { recursive: true })
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/voice-settings/microphone-test.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-settings-anchor="voice-test"]', scaffold.workspaceCwd), webSnapshotMode())

    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Remove voice model', exact: true })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await status()).status.state).toBe('ready')
    await row.getByRole('button', { name: 'Delete', exact: true }).click()
    await dialog.getByRole('button', { name: 'Confirm removal', exact: true }).click()
    await expect.poll(async () => (await status()).resource.installedVersion).toBeNull()
    await row.getByRole('button', { name: 'Download', exact: true }).waitFor()
  } finally {
    try {
      await browser?.close()
    } finally {
      try { await scaffold?.close() } finally {
        restoreNative?.()
        vi.restoreAllMocks()
        await rm(root, { recursive: true, force: true })
      }
    }
  }
}, 120_000)
