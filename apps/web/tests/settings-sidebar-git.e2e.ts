/** The shipped client waits for the Git namespace before capturing its callbacks. */
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame } from './support.ts'

const EXPECTED = fileURLToPath(new URL('./expected/settings-sidebar-git/panel.expected.md', import.meta.url))
const FIXTURE = createChatScrollFixture({ markerPrefix: 'SETTINGS_GIT', title: 'Settings Git acceptance', turns: 1 })

it('opens the assembled sidebar Git panel and reads its Session repository', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const emptyConfig = join(scaffold.workspaceCwd, '.git-acceptance-config')
  await writeFile(emptyConfig, '')
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  await promisify(execFile)('git', ['init', '--template=', '--initial-branch=main', '--object-format=sha1'], {
    cwd: scaffold.workspaceCwd, timeout: 30_000,
    env: { ...inheritedEnv, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: emptyConfig, GIT_TERMINAL_PROMPT: '0' },
  })
  await writeFile(join(scaffold.workspaceCwd, '.gitignore'), '*\n!acceptance.txt\n')
  await writeFile(join(scaffold.workspaceCwd, 'acceptance.txt'), 'Git settings acceptance\n')
  await seedSession(scaffold, FIXTURE.log, 'settings-sidebar-git')
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1680, height: 1000 } })
  page.setDefaultTimeout(15_000)
  const observation = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, 'web-e2e-settings-sidebar-git'))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  await page.getByText('Ungrouped', { exact: true }).waitFor()
  const search = page.getByRole('button', { name: 'Search sessions', exact: true })
  if (await search.getAttribute('aria-expanded') !== 'true') await search.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => results.count()).toBe(1)
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(1), { exact: false }).last().waitFor()
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  const panel = page.locator('[data-dsh-panel]')
  await panel.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Source Control', exact: true }).click()
  await panel.getByRole('button', { name: '? acceptance.txt', exact: true }).waitFor()
  expect(await panel.getByRole('combobox', { name: 'Branch', exact: true }).isEnabled()).toBe(true)
  const panelAria = await captureStableAria(page, '[data-dsh-panel]', scaffold.workspaceCwd)
  expect(observation.pageErrors).toEqual([])
  expect(observation.warnings).toEqual([])
  const mode = webSnapshotMode()
  if (mode === 'refresh') await mkdir(dirname(EXPECTED), { recursive: true })
  await compareOrRefreshGolden(EXPECTED, panelAria, mode)
})
