/** Failed built-in model transfers retain resources and can be retried from the model menu. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { modelFixture } from '../../../packages/api/voice-controller/tests/harness.ts'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from './support.ts'

it('reports a failed Host download and retries to a verified installation without selecting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-voice-download-'))
  const resources: { scaffold?: WebScaffold; browser?: Browser } = {}
  onTestFinished(async () => {
    try { await resources.browser?.close() } finally {
      try { await resources.scaffold?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  const fixture = await modelFixture()
  fixture.fail(503)
  const overlay = join(root, 'voice.patch.yml')
  await writeFile(overlay, JSON.stringify([{ id: 'voice-sherpa-onnx', config: {
    cacheRoot: join(root, 'cache'), downloadConcurrency: 1, downloadMaxAttempts: 1,
  } }]))
  const scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home') })
  resources.scaffold = scaffold
  const plugin = join(root, 'voice-fixture.mjs')
  await writeFile(plugin, "export const inject = ['voice']; export function apply(ctx, config) { ctx.effect(() => ctx.voice.registerModel(config.definition)); }\n")
  await scaffold.ctx.loader.create({ name: pathToFileURL(plugin).href, config: { definition: fixture.definition } })
  await scaffold.ctx.loader.await()
  const status = async () => (await scaffold.ctx.voice.modelsList(new AbortController().signal)).models
    .find(row => row.definition.id === fixture.definition.id)
  const browser = await chromium.launch()
  resources.browser = browser
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl)
  await waitForApplicationFrame(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Voice', exact: true }).click()
  const trigger = page.getByRole('button', { name: 'Speech Model', exact: true })
  await trigger.click()
  const row = page.locator(`[data-voice-model="${fixture.definition.id}"]`)
  await row.getByRole('button', { name: 'Download', exact: true }).click()
  await expect.poll(async () => (await status())?.task?.state).toBe('failed')
  await row.getByText('Model operation failed. Refresh status and try again.', { exact: false }).waitFor()
  expect(await row.getByRole('menuitem').isDisabled()).toBe(true)
  expect(await trigger.textContent()).toContain('Select Model')
  fixture.fail(200)
  await row.getByRole('button', { name: 'Download', exact: true }).click()
  await expect.poll(async () => (await status())?.resource.integrity).toBe('verified')
  await expect.poll(() => row.getByRole('menuitem').isEnabled()).toBe(true)
  expect(await trigger.textContent()).toContain('Select Model')
  expect(tripwire.pageErrors).toEqual([])
})
