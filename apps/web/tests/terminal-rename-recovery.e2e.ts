/** Real Session, Remote, native PTY, and Host-retained title recovery through the Web UI. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import * as yaml from 'js-yaml'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { acknowledgeReloadConnectionLoss, captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame } from './support.ts'

const FIXTURE = createChatScrollFixture({ markerPrefix: 'TERMINAL_RENAME', title: 'Retained terminal Session', turns: 1 })
it('renames one real native process and recovers its canonical title after local layout loss', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-terminal-rename-web-'))
  let host: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  onTestFinished(async () => {
    try { await browser?.close() } finally {
      try { await host?.close() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  const shell = process.platform === 'win32' ? join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh'
  const overlay = join(root, 'terminal.patch.yml')
  await writeFile(overlay, yaml.dump([{ id: 'ui-better-sidebar', config: { shell, shellArgs: process.platform === 'win32' ? ['-NoLogo', '-NoProfile'] : ['-s'] } }]))
  const scaffold = host = await launchWebScaffold({ extraOverlayPath: overlay })
  const sessionId = await seedSession(scaffold, FIXTURE.log, 'terminal-rename-source')
  const owner = sessionId
  browser = await chromium.launch()
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
  page.setDefaultTimeout(20_000)
  const tripwire = watchConsole(page)
  const terminalResponses: unknown[] = []
  page.on('response', (response) => {
    if (/\/sidebarTerminals\/(listUi|renameUi)$/.test(response.url())) {
      void response.text().then(text => terminalResponses.push({ url: response.url(), text }), () => {})
    }
  })
  const captureFailure = async (): Promise<void> => {
    await saveFailureShot(page, 'terminal-rename-failure')
    await writeFile('.artifacts/native-migration/stage5-terminal-browser-failure.json', JSON.stringify({
      text: await page.locator('body').innerText(), terminalResponses, errors: tripwire,
      terminals: scaffold.ctx.sidebarTerminals.listUi(owner),
    }, null, 2))
  }
  try {
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
    const search = page.getByRole('button', { name: 'Search sessions', exact: true })
    if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
    await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(FIXTURE.markers.user(1))
    const rows = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
    await expect.poll(() => rows.count()).toBe(1)
    await rows.click()
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    const panel = page.locator('[data-dsh-panel]')
    await panel.getByRole('button', { name: 'New tab', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Terminal', exact: true }).click()
    await panel.getByRole('button', { name: 'Start terminal', exact: true }).click()
    await expect.poll(() => scaffold.ctx.sidebarTerminals.listUi(owner).length).toBe(1)
    // ConPTY publishes its native PID when its data pipe becomes ready, after spawn returns.
    await expect.poll(() => scaffold.ctx.sidebarTerminals.listUi(owner)[0]?.pid ?? 0).toBeGreaterThan(0)
    const initial = scaffold.ctx.sidebarTerminals.listUi(owner)[0]!
    const input = panel.locator('.xterm-helper-textarea')
    await input.focus()
    const outputPath = join(scaffold.workspaceCwd, 'terminal-pid.txt')
    const quoted = "'" + outputPath.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
    const command = process.platform === 'win32'
      ? '[IO.File]::WriteAllText(' + quoted + ', [string]$PID); Write-Output (\'terminal-\' + \'verified\')'
      : 'printf %s "$$" > ' + quoted + '; printf "terminal-verified\\n"'
    await input.pressSequentially(command)
    await input.press('Enter')
    await expect.poll(() => readFile(outputPath, 'utf8')).toBe(String(initial.pid))
    const terminalTab = panel.getByRole('tab', { name: initial.title, exact: true })
    await terminalTab.dblclick()
    const dialog = page.getByRole('dialog', { name: 'Rename terminal', exact: true })
    await dialog.getByRole('textbox', { name: 'Rename terminal', exact: true }).fill('Native build 终端')
    await dialog.getByRole('button', { name: 'Save terminal title', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    await panel.getByRole('tab', { name: 'Native build 终端', exact: true }).waitFor()
    expect(scaffold.ctx.sidebarTerminals.listUi(owner)).toEqual([expect.objectContaining({ processId: initial.processId, pid: initial.pid, title: 'Native build 终端' })])
    const golden = fileURLToPath(new URL('./expected/terminal-rename-recovery/tab.expected.md', import.meta.url))
    if (webSnapshotMode() === 'refresh') await mkdir(dirname(golden), { recursive: true })
    await compareOrRefreshGolden(golden, await captureStableAria(page, '[data-dsh-panel] [role="tablist"]', scaffold.workspaceCwd), webSnapshotMode())
    await saveFailureShot(page, 'terminal-rename-before-recovery')
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await waitForApplicationFrame(page)
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await panel.getByRole('tab', { name: 'Native build 终端', exact: true }).waitFor()
    expect(scaffold.ctx.sidebarTerminals.listUi(owner)[0]).toMatchObject({ processId: initial.processId, pid: initial.pid, title: 'Native build 终端' })
    await page.addInitScript((id) => { localStorage.removeItem('dsh-sidebar:v1:' + id) }, sessionId)
    const recoveryWarnings = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await waitForApplicationFrame(page)
    acknowledgeReloadConnectionLoss(tripwire, recoveryWarnings)
    await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await panel.getByRole('tab', { name: 'Native build 终端', exact: true }).waitFor()
    await expect.poll(() => panel.locator('.xterm-rows').textContent()).toContain('terminal-verified')
    expect(scaffold.ctx.sidebarTerminals.listUi(owner)).toEqual([expect.objectContaining({ processId: initial.processId, pid: initial.pid, title: 'Native build 终端' })])
    await saveFailureShot(page, 'terminal-rename-after-recovery')
    await panel.getByRole('tab', { name: 'Native build 终端', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
    await expect.poll(() => scaffold.ctx.sidebarTerminals.listUi(owner)).toEqual([])
    await expect.poll(() => { try { process.kill(initial.pid, 0); return false } catch { return true } }).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  } catch (error) { await captureFailure(); throw error }
})
