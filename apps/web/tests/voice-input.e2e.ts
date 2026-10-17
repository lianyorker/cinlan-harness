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
    const NativeContext = window.AudioContext
    let blocks = 0
    Object.defineProperty(window, '__dictationBlocks', { get: () => blocks })
    window.AudioContext = class extends NativeContext {
      // oxlint-disable-next-line typescript/no-deprecated -- Observe the existing capture API without replacing audio processing.
      override createScriptProcessor(bufferSize?: number, inputChannels?: number, outputChannels?: number): ScriptProcessorNode {
        // oxlint-disable-next-line typescript/no-deprecated -- The product's capture still uses ScriptProcessorNode.
        const processor = super.createScriptProcessor(bufferSize, inputChannels, outputChannels)
        processor.addEventListener('audioprocess', () => { blocks++ })
        return processor
      }
    }
  })
  await page.goto(scaffold.authenticatedUrl)
  await connectFreshWorkspace(page, scaffold.workspaceCwd)
  const input = page.locator('[data-composer-input]')
  const mic = page.getByRole('button', { name: 'Start voice dictation', exact: true })
  await input.fill(prefix)
  await mic.click()
  await page.getByRole('button', { name: 'Stop voice dictation', exact: true }).waitFor()
  await compareOrRefreshGolden(fileURLToPath(new URL('../../../snapshots/web/voice-input/builtin-recording.expected.md', import.meta.url)),
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
  await page.getByText('LIGHTHOUSE', { exact: true }).waitFor()
  expect(messages).toBe(1)
  expect(tripwire.pageErrors).toEqual([])
}, 120_000)
