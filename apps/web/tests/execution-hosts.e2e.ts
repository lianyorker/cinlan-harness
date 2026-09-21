/** Built Client settings and Workspace selection over the real Host; no remote endpoint is contacted. */
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
import { newEnglishPage, saveFailureShot, waitForApplicationFrame } from './support.ts'

const ARTIFACTS = fileURLToPath(new URL('../../../.artifacts/native-migration', import.meta.url))

it('renders explicit runtime configuration and withdraws a stale Workspace target in actual Client artifacts', async () => {
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
  expect(host.ctx.get('executionRuntimes')).toBeDefined()
  expect(host.ctx.executionRuntimes.listTasks().tasks).toEqual([])
  browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'execution-hosts'))
  await page.goto(host.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Execution hosts', exact: true }).click()
  await settings.getByRole('button', { name: 'Add host', exact: true }).click()
  await settings.getByRole('textbox', { name: 'Host label', exact: true }).fill('Browser SSH target')
  await settings.getByRole('textbox', { name: 'SSH alias', exact: true }).fill('inspection-browser-test')
  await settings.getByRole('button', { name: 'Save host', exact: true }).click()
  await settings.getByRole('heading', { name: 'Browser SSH target', exact: true }).waitFor()
  const saved = host.ctx.executionHostTargets.list().targets.find(target => target.label === 'Browser SSH target')
  if (saved === undefined) throw new Error('Browser target was not persisted')
  const runtime = page.locator('[data-settings-anchor="runtime"]')
  await runtime.getByRole('combobox', { name: 'Saved target', exact: true }).selectOption(saved.id)
  await runtime.getByRole('textbox', { name: 'SSH hostname', exact: true }).waitFor()
  expect(await runtime.getByRole('button', { name: 'Install runtime', exact: true }).isDisabled()).toBe(true)
  expect(await runtime.getByText('Installations continue when you leave this page or disconnect.', { exact: false }).isVisible()).toBe(true)
  await mkdir(ARTIFACTS, { recursive: true })
  await runtime.scrollIntoViewIfNeeded()
  await runtime.screenshot({ path: join(ARTIFACTS, 'runtime-settings-panel-built.png') })
  await page.screenshot({ path: join(ARTIFACTS, 'runtime-settings-built.png'), fullPage: true })
  const execution = {
    endpoint: { host: '127.0.0.1', port: 1, username: 'browser-test', privateKeyFile: join(root, 'unread-key'), hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', helper: '/opt/runtime/helper', helperHash: 'b'.repeat(64), workspace: '/srv/project',
    bootstrapPath: '/opt/runtime/bootstrap', bootstrapHash: 'c'.repeat(64),
  }
  const selected = (await host.ctx.executionHostTargets.update({
    id: saved.id, revision: saved.revision, label: saved.label, sshAlias: saved.sshAlias, execution,
  })).target
  const staleExecution = host.ctx.executionHostTargets.snapshotExecution({ id: selected.id, revision: selected.revision })
  const warningStart = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningStart)
  await page.getByRole('button', { name: 'Add workspace', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Choose Workspace Host', exact: true })
  await dialog.waitFor()
  expect(await dialog.getByRole('combobox').inputValue()).toBe('')
  await dialog.getByRole('combobox').selectOption(selected.id + ':' + String(selected.revision))
  expect(await dialog.getByRole('textbox', { name: 'Remote directory', exact: true }).inputValue()).toBe('/srv/project')
  await host.ctx.executionHostTargets.update({
    id: selected.id, revision: selected.revision, label: selected.label, sshAlias: selected.sshAlias, execution,
  })
  await dialog.getByText('This target changed or became unavailable. Select an available revision again.', { exact: true }).waitFor()
  expect(await dialog.getByRole('button', { name: 'Continue', exact: true }).isDisabled()).toBe(true)
  await expect(host.ctx.workspaceRegistry.create('/srv/project', 'stale remote', staleExecution))
    .rejects.toMatchObject({ code: 'conflict' })
  expect(host.ctx.workspaceRegistry.list().some(workspace => workspace.execution.kind === 'ssh')).toBe(false)
  await page.screenshot({ path: join(ARTIFACTS, 'workspace-host-stale-built.png'), fullPage: true })
  expect(tripwire.warnings).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
})
