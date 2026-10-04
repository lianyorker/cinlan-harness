/** Built Client settings over the real Host; no remote endpoint is contacted. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type {} from '@deepseek-ai/dsh-execution-host'
import type {} from '@deepseek-ai/dsh-execution-host-targets'
import type {} from '@deepseek-ai/dsh-execution-runtime'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import { acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, openSettings, saveFailureShot, waitForApplicationFrame } from './support.ts'

const ARTIFACTS = fileURLToPath(new URL('../../../.artifacts/native-migration', import.meta.url))

it('renders the SSH host page from built Client artifacts and keeps one saved target across a reload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-settings-web-'))
  let host: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  onTestFinished(async () => {
    try { await browser?.close() }
    finally { try { await host?.close() } finally { await rm(root, { recursive: true, force: true }) } }
  })
  host = await launchWebScaffold({ harnessHome: join(root, 'home') })
  expect(host.ctx.executionHost.current().platform).toBe(process.platform)
  expect(host.ctx.get('executionBindings')).toBeDefined()
  // The runtime installer keeps its Remote methods and Host service although no
  // surface on this page calls them any more.
  expect(host.ctx.get('executionRuntimes')).toBeDefined()
  expect(host.ctx.executionRuntimes.listTasks().tasks).toEqual([])
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'execution-hosts'))
  await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await openSettings(page, 'en')
  await page.getByRole('button', { name: 'SSH hosts', exact: true }).click()
  await page.getByRole('heading', { name: 'SSH remote hosts', exact: true }).waitFor()
  const targets = page.locator('[data-settings-anchor="hosts"]')
  await targets.getByText('No SSH targets configured.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Add target', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add SSH host', exact: true })
  await form.getByLabel('Label', { exact: true }).fill('Browser SSH target')
  await form.getByLabel('Host or alias *', { exact: true }).fill('inspection-browser-test')
  await form.getByRole('button', { name: 'Add Target', exact: true }).click()
  await page.getByText('Target saved.', { exact: true }).waitFor()
  const saved = host.ctx.executionHostTargets.list().targets.find(target => target.label === 'Browser SSH target')
  if (saved === undefined) throw new Error('Browser target was not persisted')
  expect(saved.sshAlias).toBe('inspection-browser-test')
  await mkdir(ARTIFACTS, { recursive: true })
  await targets.scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(ARTIFACTS, 'ssh-hosts-built.png'), fullPage: true })
  const warningStart = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningStart)
  await openSettings(page, 'en')
  await page.getByRole('button', { name: 'SSH hosts', exact: true }).click()
  const card = page.locator('[aria-label="Browser SSH target"]')
  await card.getByText('inspection-browser-test:22', { exact: true }).waitFor()
  await card.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog', { name: 'Delete target?', exact: true })
    .getByRole('button', { name: 'Delete target', exact: true }).click()
  await targets.getByText('No SSH targets configured.', { exact: true }).waitFor()
  expect(host.ctx.executionHostTargets.list().targets).toEqual([])
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
})
