/** Shipped profile wiring and disabled MCP configuration through the real settings UI. */
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it, onTestFinished } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-mcp-controller'
import {
  launchWebScaffold, watchConsole, acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, waitForApplicationFrame } from './support.ts'
import { startHttpMcpFixture } from '../../../packages/mcp/mcp-client/tests/http-fixture.ts'

let scaffold: WebScaffold
let browser: Browser
let page: Page

beforeAll(async () => {
  scaffold = await launchWebScaffold({})
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  page.setDefaultTimeout(10_000)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
})

afterAll(async () => { await browser?.close(); await scaffold?.close() })

it('uses the launch profile and saves, restores and removes disabled servers without executing them', async () => {
  const tripwire = watchConsole(page)
  expect(scaffold.ctx.mcpManagement.getSnapshot()).toMatchObject({ profile: 'scaffold', servers: [] })
  expect(scaffold.ctx.mcpController.snapshot().profile).toBe('scaffold')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  const nav = settings.getByRole('navigation', { name: 'Settings navigation' })
  await nav.getByRole('button', { name: 'MCP', exact: true }).click()
  await settings.getByText('No managed MCP servers.', { exact: true }).waitFor()
  await settings.getByRole('button', { name: 'Add server', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New server', exact: true })
  await dialog.getByRole('textbox', { name: 'Server name', exact: true }).fill('ui_disabled_fixture')
  await dialog.getByRole('textbox', { name: 'Command', exact: true }).fill('never-execute-disabled-fixture')
  expect(await dialog.getByRole('switch', { name: 'Enabled', exact: true }).isChecked()).toBe(false)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const row = settings.getByRole('article', { name: 'ui_disabled_fixture', exact: true })
  await row.getByText('Saved state: Disabled', { exact: true }).waitFor()
  await row.getByText('Connection: Stopped', { exact: true }).waitFor()
  expect(scaffold.ctx.mcpRegistry.getSnapshot()).toEqual([])
  expect(scaffold.ctx.mcpManagement.getSnapshot()).toMatchObject({ profile: 'scaffold', revision: 1,
    servers: [{ record: { serverName: 'ui_disabled_fixture', enabled: false }, observed: { phase: 'stopped' } }] })
  const warningCount = tripwire.warnings.length
  await page.reload({ waitUntil: 'load' })
  await waitForApplicationFrame(page)
  acknowledgeReloadConnectionLoss(tripwire, warningCount)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await nav.getByRole('button', { name: 'MCP', exact: true }).click()
  await row.getByText('Saved state: Disabled', { exact: true }).waitFor()
  const artifacts = fileURLToPath(new URL('../../../.artifacts/mcp-settings', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      expect(await settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await settings.locator('[data-settings-anchor="mcp-add-server"]').evaluate((element) => {
        const range = document.createRange()
        const text = document.createTreeWalker(element.querySelector('button')!, NodeFilter.SHOW_TEXT).nextNode()!
        range.selectNodeContents(text)
        return range.getClientRects().length
      })).toBe(1)
      await page.screenshot({ path: join(artifacts, 'disabled-' + colorScheme + '-' + String(width) + '.png') })
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await row.getByRole('button', { name: 'Remove ui_disabled_fixture', exact: true }).click()
  await page.getByRole('dialog', { name: 'Remove saved server?', exact: true }).getByRole('button', { name: 'Remove', exact: true }).click()
  await settings.getByText('No managed MCP servers.', { exact: true }).waitFor()
  expect(scaffold.ctx.mcpManagement.getSnapshot()).toMatchObject({ profile: 'scaffold', revision: 2, servers: [] })
  expect(scaffold.ctx.mcpRegistry.getSnapshot()).toEqual([])
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})

it('shows live readiness, authentication failure and recovery through discovery without invoking a tool', async () => {
  const endpoint = await startHttpMcpFixture()
  onTestFinished(async () => {
    try {
      const snapshot = scaffold.ctx.mcpManagement.getSnapshot()
      const record = snapshot.servers.find(item => item.record.serverName === 'ui_live_fixture')?.record
      if (record !== undefined) await scaffold.ctx.mcpManagement.remove({
        id: record.id, expectedRevision: snapshot.revision,
      })
    } finally { await endpoint.close() }
  })
  const settings = page.getByRole('region', { name: 'Settings', exact: true })
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  const tripwire = watchConsole(page)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await settings.getByRole('navigation', { name: 'Settings navigation' }).getByRole('button', { name: 'MCP', exact: true }).click()
  await settings.getByRole('button', { name: 'Add server', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New server', exact: true })
  await dialog.getByRole('textbox', { name: 'Server name', exact: true }).fill('ui_live_fixture')
  await dialog.getByRole('combobox', { name: 'Transport', exact: true }).selectOption('streamable-http')
  await dialog.getByRole('textbox', { name: 'Endpoint URL', exact: true }).fill(endpoint.url)
  await dialog.getByRole('switch', { name: 'Enabled', exact: true }).check()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const row = settings.getByRole('article', { name: 'ui_live_fixture', exact: true })
  await row.getByText('Connection: Ready', { exact: true }).waitFor()
  const saved = scaffold.ctx.mcpManagement.getSnapshot().servers.find(item => item.record.serverName === 'ui_live_fixture')!
  const revision = scaffold.ctx.mcpManagement.getSnapshot().revision
  expect(saved.observed.tools.map(tool => tool.name)).toEqual(['mcp__ui_live_fixture__ping'])
  const expected = fileURLToPath(new URL('./expected/mcp-settings', import.meta.url))
  if (webSnapshotMode() === 'refresh') await mkdir(expected, { recursive: true })
  await compareOrRefreshGolden(join(expected, 'ready.expected.md'),
    await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), webSnapshotMode())
  endpoint.setAuthorization('fixture-deny-anonymous')
  await row.getByRole('button', { name: 'Refresh tools', exact: true }).click()
  await row.getByText('The server rejected authentication.', { exact: true }).waitFor()
  await row.getByText('Connection: Connection error', { exact: true }).waitFor()
  await compareOrRefreshGolden(join(expected, 'authentication-error.expected.md'),
    await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), webSnapshotMode())
  endpoint.setAuthorization(undefined)
  endpoint.setTools([{ name: 'next', description: 'Updated fixture tool' }])
  await row.getByRole('button', { name: 'Refresh tools', exact: true }).click()
  await row.getByText('Connection: Ready', { exact: true }).waitFor()
  expect(scaffold.ctx.mcpManagement.getSnapshot().servers[0]?.observed.tools.map(tool => tool.name))
    .toEqual(['mcp__ui_live_fixture__next'])
  expect(scaffold.ctx.mcpManagement.getSnapshot().revision).toBe(revision)
  expect(endpoint.methods).not.toContain('tools/call')
  await row.getByRole('switch', { name: 'Enable ui_live_fixture', exact: true }).click()
  await row.getByText('Connection: Stopped', { exact: true }).waitFor()
  await expect.poll(() => row.getByRole('switch', { name: 'Enable ui_live_fixture', exact: true }).getAttribute('aria-checked')).toBe('false')
  await compareOrRefreshGolden(join(expected, 'stopped.expected.md'),
    await captureStableAria(page, '[data-dsh-settings-page]', scaffold.workspaceCwd), webSnapshotMode())
  expect(scaffold.ctx.mcpRegistry.getSnapshot()).toEqual([])
  expect(scaffold.ctx.tools.schemas().some(tool => tool.name.startsWith('mcp__ui_live_fixture__'))).toBe(false)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
})
