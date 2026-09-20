/** Native runtime status, exact provider activation, and browser closure through real Web Remotes. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-browser-playwright/runtime'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame } from './support.ts'

it('activates the configured provider without launch, controls real Chromium, and closes only its runtime', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-resources-web-'))
  let scaffold: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Runtime fixture</title><button aria-label="Confirm native page" onclick="document.title=\'Native confirmed\'">Confirm native page</button>')
  })
  onTestFinished(async () => {
    try { await browser?.close() } finally {
      try { await scaffold?.close() } finally {
        try {
          if (server.listening) {
            server.closeAllConnections()
            await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
          }
        } finally { await rm(root, { recursive: true, force: true }) }
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Runtime fixture listener is missing')
  const url = 'http://127.0.0.1:' + String(address.port) + '/'
  const executablePath = chromium.executablePath()
  expect(existsSync(executablePath)).toBe(true)
  const runtimeDir = join(root, 'runtime')
  const overlay = join(root, 'browser.patch.yml')
  await writeFile(overlay, yaml.dump([
    { id: 'browser-runtime', config: { storageDir: runtimeDir } },
    { id: 'browser-playwright', config: { storageDir: join(root, 'profile'), browserChannel: 'chromium', executablePath, headless: true, homePage: url } },
    { id: 'browser-permission-policy', config: { observe: 'allow', navigate: 'allow', interact: 'allow' } },
  ]))
  const host = scaffold = await launchWebScaffold({
    harnessHome: join(root, 'home'), extraOverlayPath: overlay, toolsMode: 'ptc',
    profile: { packages: ['cinlan-browser', 'cinlan-computer-use', 'web-capability-defaults'].map(name => ({
      dir: fileURLToPath(new URL('../../../packages/bundle/' + name, import.meta.url)), enabled: true,
    })) },
  })
  const runtime = host.ctx.browserRuntime
  expect(runtime.status()).toMatchObject({ providerActive: false, browserState: 'stopped', managedInstalled: false, task: null })
  const providers = [...host.ctx.loader.entries()].filter(entry => entry.options.name === '@deepseek-ai/dsh-browser-playwright')
  expect(providers).toHaveLength(1)
  expect(providers[0]!.disabled).toBe(true)
  expect([...host.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native')?.disabled).toBe(true)
  const manifest = JSON.parse(await readFile(join(host.harnessHome, 'profiles', 'scaffold', 'package.json'), 'utf8')) as { dsh: { profile: { bundles: string[] } } }
  expect(manifest.dsh.profile.bundles).toEqual(['base', 'web-app', 'cinlan-browser', 'cinlan-computer-use', 'web-capability-defaults'].map(name => '@deepseek-ai/dsh-' + name))

  browser = await chromium.launch()
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
  page.setDefaultTimeout(20_000)
  const tripwire = watchConsole(page)
  const consoleErrors: string[] = []
  const networkErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', (response) => { if (response.status() >= 400) networkErrors.push(String(response.status()) + ' ' + response.url()) })
  onTestFailed(() => saveFailureShot(page, 'web-e2e-browser-resources'))
  await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Browser', exact: true }).click()
  const section = page.locator('[data-capability="browser"]')
  const resources = section.getByRole('region', { name: 'Browser runtime', exact: true })
  await resources.getByText('The Browser plugin is inactive; managed runtime resources can still be maintained.', { exact: true }).waitFor()
  const install = resources.getByRole('button', { name: 'Install runtime', exact: true })
  expect(await install.isEnabled()).toBe(true)
  expect(existsSync(runtimeDir)).toBe(false)
  const activation = section.locator('[data-settings-anchor="browser-activation"]')
  await expect.poll(() => activation.locator('code').allTextContents()).toEqual([providers[0]!.id])
  await activation.getByRole('button', { name: 'Enable provider', exact: true }).click()
  await activation.getByText('Configuration applied. Readiness is checked separately.', { exact: true }).waitFor()
  await expect.poll(() => runtime.status().providerActive).toBe(true)
  expect(runtime.status()).toMatchObject({ source: 'custom', executablePath, installed: true, managedInstalled: false, browserState: 'stopped', task: null })
  const savedPatch = yaml.load(await readFile(join(host.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml'), 'utf8'))
  expect(savedPatch).toContainEqual({ id: 'browser-playwright', disabled: false })
  expect([...host.ctx.loader.entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native')?.disabled).toBe(true)
  expect(existsSync(runtimeDir)).toBe(false)
  await resources.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await resources.getByText('Custom executable', { exact: true }).waitFor()
  await resources.getByText('Runtime files installed', { exact: true }).waitFor()
  expect(await resources.getByRole('button', { name: 'Repair runtime', exact: true }).count()).toBe(0)
  expect(await resources.getByRole('button', { name: 'Remove runtime', exact: true }).count()).toBe(0)
  const expected = fileURLToPath(new URL('./expected/browser-resources/custom-stopped.expected.md', import.meta.url))
  if (webSnapshotMode() === 'refresh') await mkdir(dirname(expected), { recursive: true })
  await compareOrRefreshGolden(expected, await captureStableAria(page, '[data-capability="browser"] section[aria-label="Browser runtime"]', host.workspaceCwd), webSnapshotMode())

  try { await section.getByRole('button', { name: 'Connect / refresh browser', exact: true }).click() } catch (error) {
    await saveFailureShot(page, 'web-e2e-browser-resources')
    throw new Error('Browser controls unavailable after activation: ' + await section.innerText(), { cause: error })
  }
  await expect.poll(() => runtime.status().browserState).toBe('running')
  await section.getByRole('button', { name: 'Open home page', exact: true }).click()
  await expect.poll(() => section.getByRole('combobox', { name: 'Browser page', exact: true }).textContent()).toContain('Runtime fixture')
  const agent = await host.ctx.agents.create({ sessionId: SessionId('browser-resource-worker'), meta: { cwd: host.workspaceCwd } })
  try {
    const result = await host.ctx.tools.execute({
      name: 'run_code', callId: ToolCallId('browser-resource-worker'), agent: agent.agent, signal: new AbortController().signal,
      arguments: { description: 'Observe and operate the native fixture page', code:
        'const pages = await tools.browser_list({}); const page = pages.pages.find(page => page.title === "Runtime fixture"); if (!page) throw new Error("Fixture page missing"); const before = await tools.browser_snapshot({page_id: page.page_id}); const button = before.elements.find(element => element.name === "Confirm native page"); if (!button) throw new Error("Fixture button missing"); await tools.browser_click({page_id: page.page_id, observation_id: before.observation_id, element_id: button.element_id}); return await tools.browser_snapshot({page_id: page.page_id});' },
    })
    expect(result.isError, JSON.stringify(result.content)).toBe(false)
    expect(JSON.stringify(result.content)).toContain('Native confirmed')
    const nativePage = (await host.ctx.browser.listPages()).find(page => page.title === 'Native confirmed')
    expect(nativePage).toBeDefined()
    const image = await host.ctx.browser.screenshot({ pageId: nativePage!.pageId, format: 'png' })
    const evidence = fileURLToPath(new URL('../../../.artifacts/native-migration', import.meta.url))
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, 'browser-resource-native-page.png'), image.data)
    await writeFile(join(evidence, 'browser-resource-worker-result.json'), JSON.stringify({ result, page: nativePage, runtime: runtime.status() }, null, 2) + '\n')
  } finally { await agent.dispose() }
  await resources.getByRole('button', { name: 'Refresh status', exact: true }).click()
  await resources.getByRole('button', { name: 'Close browser', exact: true }).waitFor()
  expect(await install.isDisabled()).toBe(true)
  await resources.getByText('Stop the current browser before installing, repairing, or removing its runtime.', { exact: true }).waitFor()
  const screenshots = fileURLToPath(new URL('../../../.artifacts/native-migration', import.meta.url))
  await mkdir(screenshots, { recursive: true })
  for (const width of [1680, 600]) {
    await page.setViewportSize({ width, height: 1000 })
    await resources.scrollIntoViewIfNeeded()
    expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: join(screenshots, 'browser-resources-running-' + String(width) + '.png') })
  }
  await resources.getByRole('button', { name: 'Close browser', exact: true }).click()
  await expect.poll(() => runtime.status().browserState).toBe('stopped')
  expect(runtime.status()).toMatchObject({ providerActive: true, installed: true, managedInstalled: false, task: null })
  expect(existsSync(join(runtimeDir, 'operation.lock'))).toBe(false)
  expect(existsSync(executablePath)).toBe(true)
  await expect.poll(() => install.isEnabled()).toBe(true)
  expect(await resources.getByRole('button', { name: 'Close browser', exact: true }).count()).toBe(0)
  expect(await activation.getByRole('button', { name: 'Disable provider', exact: true }).count()).toBe(1)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
  expect(consoleErrors).toEqual([])
  expect(networkErrors).toEqual([])
})
