/** Built-in browser dictation inserts a draft before the ordinary recorded Session submission. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished, vi } from 'vitest'
import { VoiceModelId } from '@deepseek-ai/dsh-voice'
import {
  captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, webSnapshotMode, watchConsole,
  type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const fixture = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v4.jsonl', import.meta.url))
const overlay = fileURLToPath(new URL('./voice-replay.overlay.yml', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('dictates a draft and submits only the reviewed transcript through Session replay', async () => {
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { vi.restoreAllMocks() }
    }
  })
  const prompt = fixtureUserPrompts(await readFile(fixture, 'utf8'))[0]!
  const prefix = prompt.slice(0, prompt.indexOf(' ') + 1)
  const scaffold = await launchWebScaffold({ replayFixture: fixture, compareReplaySession: 'read-only', extraOverlayPath: overlay })
  resources.scaffold = scaffold
  // Availability and native inference are fixtures; capture and the authenticated voice Remote remain real.
  const modelId = VoiceModelId('fixture-model')
  vi.spyOn(scaffold.ctx.voice, 'modelsList').mockResolvedValue({ models: [{
    definition: { id: modelId, name: 'Recorded recognizer', description: '', recommended: false, approximateBytes: 1 },
    status: { state: 'ready', cacheDir: '/fixture' }, task: null,
    resource: { revision: 'fixture', source: [], installedVersion: 'fixture', availableVersion: 'fixture', updateAvailable: false, integrity: 'verified' },
  }] })
  const recognize = vi.spyOn(scaffold.ctx.voice, 'transcribe').mockImplementation(async (input) => {
    expect(input.modelId).toBe(modelId)
    expect(input.samples.length).toBeGreaterThan(0)
    return { text: prompt.slice(prefix.length) }
  })
  let messages = 0
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message' && event.data.source.kind === 'user') messages++
  })
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
  resources.browser = browser
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  const voiceErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[dsh-voice]')) voiceErrors.push(message.text())
  })
  await page.addInitScript(() => {
    const holder = window as Window & {
      voiceTestStreams?: MediaStream[]
      voiceTestExcluded?: string[]
      voiceTestNames?: Record<string, string>
    }
    holder.voiceTestStreams = []
    holder.voiceTestExcluded = []
    holder.voiceTestNames = {}
    const enumerateDevices = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices)
    navigator.mediaDevices.enumerateDevices = async () => (await enumerateDevices())
      .filter(device => !holder.voiceTestExcluded!.includes(device.deviceId))
      .map((device) => {
        const label = holder.voiceTestNames![device.deviceId]
        if (label) Object.defineProperty(device, 'label', { value: label })
        return device
      })
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints)
      holder.voiceTestStreams!.push(stream)
      return stream
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]'), mic = page.getByRole('button', { name: 'Start recording', exact: true })
  const setupMic = page.getByRole('button', { name: 'Open voice input setup', exact: true })
  await input.fill(prefix)
  await setupMic.click()
  const setup = page.getByRole('dialog', { name: 'Set up voice input before recording', exact: true })
  await setup.waitFor()
  const setupAction = setup.getByRole('button', { name: 'Go to setup', exact: true })
  await expect.poll(() => setupAction.evaluate(element => element === document.activeElement)).toBe(true)
  await page.keyboard.type('NoDraftEdits')
  expect(await input.innerText()).toBe(prefix)
  expect(messages).toBe(0)
  await page.keyboard.press('Tab')
  expect(await setup.getByRole('button', { name: 'Cancel', exact: true }).evaluate(element => element === document.activeElement)).toBe(true)
  await page.keyboard.press('Shift+Tab')
  expect(await setupAction.evaluate(element => element === document.activeElement)).toBe(true)
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/setup.expected.md', import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  await setup.getByRole('button', { name: 'Later', exact: true }).click()
  expect(await setup.count()).toBe(0)
  expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
  expect(recognize).not.toHaveBeenCalled()
  preparation = { phase: 'checking', step: 'check', startedAt: 0 }
  for (const listener of readinessListeners) listener()
  await setupMic.click()
  const unavailable = page.getByRole('dialog', { name: 'Speech recognition is not ready', exact: true })
  await unavailable.waitFor()
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/unavailable.expected.md', import.meta.url)),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  await page.setViewportSize({ width: 420, height: 900 })
  const dialogBox = await unavailable.boundingBox()
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(420)
  await page.keyboard.press('Escape')
  await unavailable.waitFor({ state: 'hidden' })
  expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
  expect(await input.innerText()).toBe(prefix)
  preparation = { phase: 'failed', message: 'Model preparation failed' }
  for (const listener of readinessListeners) listener()
  await setupMic.click()
  const detailsAction = unavailable.getByRole('button', { name: 'Open voice plugin settings', exact: true })
  await expect.poll(() => detailsAction.evaluate(element => element === document.activeElement)).toBe(true)
  await page.keyboard.press('Enter')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('[data-plugin-detail="@deepseek-ai/dsh-experimental-voice-input-bundle"]')
    .getByRole('button', { name: 'Retry preparation', exact: true }).waitFor()
  expect(await unavailable.count()).toBe(0)
  expect(messages).toBe(0)
  expect(recognize).not.toHaveBeenCalled()
  preparation = { phase: 'standby' }
  for (const listener of readinessListeners) listener()
  const devicePicker = page.getByRole('combobox', { name: 'Input device', exact: true })
  const level = page.getByRole('img', { name: 'Microphone input level', exact: true })
  await level.waitFor()
  const devices = await page.evaluate(async () => (await navigator.mediaDevices.enumerateDevices())
    .filter(device => device.kind === 'audioinput' && device.deviceId !== 'default'))
  const selectedDevice = devices[0]!
  await devicePicker.selectOption(selectedDevice.deviceId)
  await expect.poll(() => devicePicker.inputValue()).toBe(selectedDevice.deviceId)
  await expect.poll(() => page.evaluate(() => {
    const streams = (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!
    return streams.filter(stream => stream.getTracks().some(track => track.readyState === 'live')).length
  })).toBe(1)
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/device.expected.md', import.meta.url)),
    await captureStableAria(page, '[data-voice-input-device]', scaffold.workspaceCwd), webSnapshotMode())
  const acquisitions = await page.evaluate(() => (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!.length)
  const otherDevice = devices[1]!
  for (const excluded of [[otherDevice.deviceId], []]) {
    await page.evaluate((ids) => {
      (window as Window & { voiceTestExcluded?: string[] }).voiceTestExcluded = ids
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
    }, excluded)
    await expect.poll(() => page.getByRole('option', { name: otherDevice.label, exact: true }).count()).toBe(excluded.length ? 0 : 1)
    expect(await page.evaluate(() => (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!.length)).toBe(acquisitions)
    await level.waitFor()
  }
  await page.evaluate((id) => {
    const holder = window as Window & { voiceTestExcluded?: string[]; voiceTestStreams?: MediaStream[] }
    holder.voiceTestExcluded = [id]
    const track = holder.voiceTestStreams!.at(-1)!.getAudioTracks()[0]!
    track.stop(); track.dispatchEvent(new Event('ended'))
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  }, selectedDevice.deviceId)
  const missing = page.getByRole('option', { name: `${selectedDevice.label} — Unavailable`, exact: true })
  await expect.poll(() => missing.count()).toBe(1)
  expect(await missing.isDisabled()).toBe(true)
  await level.waitFor({ state: 'hidden' })
  expect(await devicePicker.evaluate(element => (element as HTMLSelectElement).selectedOptions[0]?.textContent)).toContain('Unavailable')
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/device-missing.expected.md', import.meta.url)),
    await captureStableAria(page, '[data-voice-input-device]', scaffold.workspaceCwd), webSnapshotMode())
  await page.evaluate(() => {
    (window as Window & { voiceTestExcluded?: string[] }).voiceTestExcluded = []
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  })
  await expect.poll(() => devicePicker.evaluate(element => (element as HTMLSelectElement).selectedOptions[0]?.textContent))
    .not.toContain('Unavailable')
  await level.waitFor()
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams?: MediaStream[] })
    .voiceTestStreams!.length)).toBe(acquisitions + 1)
  await devicePicker.blur()
  await level.waitFor()
  const longName = 'USB studio microphone — conference room recording input'
  await page.evaluate(({ id, label }) => {
    (window as Window & { voiceTestNames?: Record<string, string> }).voiceTestNames![id] = label
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'))
  }, { id: selectedDevice.deviceId, label: longName })
  await expect.poll(() => devicePicker.evaluate(element => (element as HTMLSelectElement).selectedOptions[0]?.textContent)).toBe(longName)
  await page.setViewportSize({ width: 360, height: 900 })
  await level.waitFor()
  await devicePicker.scrollIntoViewIfNeeded()
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/device-long.expected.md', import.meta.url)),
    await captureStableAria(page, '[data-voice-input-device]', scaffold.workspaceCwd), webSnapshotMode())
  const pickerBounds = (await devicePicker.boundingBox())!, levelBounds = (await level.boundingBox())!
  expect(levelBounds.x).toBeGreaterThan(pickerBounds.x + pickerBounds.width / 2)
  expect(levelBounds.x + levelBounds.width).toBeLessThan(pickerBounds.x + pickerBounds.width)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
  await mic.waitFor()
  await expect.poll(() => page.evaluate(() => (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!
    .every(stream => stream.getTracks().every(track => track.readyState === 'ended')))).toBe(true)
  await page.getByRole('button', { name: 'Plugins', exact: true }).click()
  await page.locator('[data-plugin-package="@deepseek-ai/dsh-experimental-voice-input-bundle"]').waitFor()
  expect(await page.locator('[data-plugin-detail]').count()).toBe(0)
  await page.getByRole('button', { name: 'New session', exact: true }).filter({ hasText: 'New Session' }).click()
  await mic.waitFor()
  const micBox = await mic.boundingBox(), modelBox = await page.getByRole('button', { name: /^Select model, current/ }).boundingBox()
  const sendBox = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox()
  expect(micBox!.x).toBeGreaterThan(modelBox!.x)
  expect(micBox!.x).toBeLessThan(sendBox!.x)
  await input.fill(prefix)
  await mic.click()
  await page.getByRole('button', { name: 'Stop and transcribe', exact: true }).waitFor()
  expect(await page.evaluate(() => (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!
    .at(-1)!.getAudioTracks()[0]!.getSettings().deviceId)).toBe(selectedDevice.deviceId)
  await compareOrRefreshGolden(recordingExpected,
    await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), webSnapshotMode())
  await expect.poll(() => page.evaluate(() => {
    const blocks: unknown = Reflect.get(window, '__dictationBlocks')
    return typeof blocks === 'number' ? blocks : 0
  })).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Stop voice dictation', exact: true }).click()
  await mic.waitFor()
  expect(voiceErrors).toEqual([])
  expect(recognize).toHaveBeenCalledOnce()
  await expect.poll(() => input.innerText()).toBe(prompt)
  expect(recognize).toHaveBeenCalledOnce()
  expect(messages).toBe(0)
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/builtin-draft.expected.md', import.meta.url)),
    await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), webSnapshotMode())
  const settled = scaffold.whenTurnSettled()
  await input.press('Enter')
  await settled
  await page.getByText('DONE', { exact: true }).waitFor()
  const meter = page.getByRole('button', { name: /% of context used/ })
  await meter.waitFor()
  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => {
      const micRect = await mic.boundingBox(), meterRect = await meter.boundingBox()
      return micRect !== null && meterRect !== null && meterRect.y >= micRect.y + micRect.height
    }).toBe(true)
    await meter.click()
    await page.getByRole('dialog', { name: 'of context used', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }
  await mic.hover()
  await page.getByRole('tooltip', { name: 'Dictate', exact: true }).waitFor()
  const controlBackground = await page.getByRole('button', { name: 'Add files or run commands', exact: true })
    .evaluate(element => getComputedStyle(element).backgroundColor)
  await mic.click()
  const stop = page.getByRole('button', { name: 'Stop and transcribe', exact: true })
  await stop.waitFor()
  for (const width of [1280, 420]) {
    await page.setViewportSize({ width, height: 900 })
    const waveformBox = await page.getByRole('img', { name: 'Recording…', exact: true }).boundingBox()
    const stopBox = await stop.boundingBox(), cancelBox = await page.getByRole('button', { name: 'Cancel', exact: true }).boundingBox()
    expect(waveformBox!.height).toBeLessThanOrEqual(Math.min(stopBox!.height, cancelBox!.height))
  }
  await input.hover()
  expect(await meter.isVisible()).toBe(false)
  expect(await stop.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(controlBackground)
  expect(await page.getByRole('button', { name: 'Cancel', exact: true })
    .evaluate(element => getComputedStyle(element).backgroundColor)).toBe(controlBackground)
  await page.keyboard.press('Escape')
  await mic.waitFor()
  await meter.waitFor()
  await meter.click()
  await page.getByRole('dialog', { name: 'of context used', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await mic.click()
  await stop.waitFor()
  await page.evaluate(() => {
    const track = (window as Window & { voiceTestStreams?: MediaStream[] }).voiceTestStreams!.at(-1)!.getAudioTracks()[0]!
    track.stop(); track.dispatchEvent(new Event('ended'))
  })
  await page.getByRole('button', { name: 'Record again', exact: true }).waitFor()
  await page.evaluate(() => { navigator.mediaDevices.dispatchEvent(new Event('devicechange')) })
  expect(await stop.count()).toBe(0)
  await compareOrRefreshGolden(interruptedExpected,
    await captureStableAria(page, '[data-composer-card]', scaffold.workspaceCwd), webSnapshotMode())
  expect(recognize).toHaveBeenCalledOnce()
  await page.getByRole('button', { name: 'Record again', exact: true }).click()
  await stop.waitFor()
  await page.keyboard.press('Escape')
  expect(messages).toBe(1)
  expect(tripwire.pageErrors).toEqual([])
}, 120_000)
