// Keyless assembled-browser coverage for the goal bar over the shipped Web
// bundles and the fixture Connection RPC. The command creates a real projected
// goal in the fixture session; the golden pins the active strip, while the
// clear gesture proves the acknowledged tombstone leaves neither stale chrome
// nor a duplicate-mutation error.
// duplicate-mutation error. A blocked goal stays resumable after an edit.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/goal-bar', import.meta.url))
const ACTIVE_EXPECTED = join(SNAPSHOT_DIR, 'active.expected.md')
const INACTIVE_EXPECTED = join(SNAPSHOT_DIR, 'inactive.expected.md')
const BLOCKED_EXPECTED = join(SNAPSHOT_DIR, 'blocked.expected.md')
const OVERLAY = fileURLToPath(new URL('./goal-bar.overlay.yml', import.meta.url))
const MODE = webSnapshotMode()

describe('web e2e: goal bar clear convergence', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, welcomeNoticePending: true })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    const login = await page.context().request.get(scaffold.authenticatedUrl, { maxRedirects: 0 })
    expect(login.status()).toBe(303)
    await page.goto(`${scaffold.baseUrl}?fixture`, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('renders one active goal and clears it without exposing a stale error', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-bar-clear'))
    // Startup reuses the fixture workspace's blank session, keeping this
    // command independent of alpha's running replay and pending question.
    const input = page.locator('[data-composer-input][data-placeholder="Describe what you want to build, / commands, @ files or sessions"]')
    await input.waitFor({ timeout: 10_000 })
    await input.fill('/goal guard rapid clear clicks')
    await input.press('Enter')

    const bar = page.locator('[data-goal-bar]')
    await bar.waitFor({ timeout: 10_000 })
    await expect.poll(() => bar.getByRole('button', { name: 'Pause goal' }).count(), {
      timeout: 10_000,
    }).toBe(1)
    const snapshot = await captureStableAria(page, '[data-goal-bar]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACTIVE_EXPECTED, snapshot, MODE)

    await page.evaluate(() => {
      (globalThis as unknown as { __fxTiming?: { disarmOnlyGoal(): void } }).__fxTiming?.disarmOnlyGoal()
    })
    await expect.poll(() => bar.getByRole('button', { name: 'Resume goal' }).count(), {
      timeout: 10_000,
    }).toBe(1)
    const inactive = await captureStableAria(page, '[data-goal-bar]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(INACTIVE_EXPECTED, inactive, MODE)

    const clear = bar.getByRole('button', { name: 'Clear goal' })
    await clear.evaluate((button) => {
      const control = button as HTMLButtonElement
      control.click()
      control.click()
    })
    await expect.poll(() => page.locator('[data-goal-bar]').count(), { timeout: 10_000 }).toBe(0)
    expect(await page.getByText(/no current goal/iu).count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('resumes a blocked goal after its objective is edited', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-goal-bar-blocked-resume'))
    // `/goal <objective>` refuses to replace an unfinished goal, so start from none.
    for (const existing of scaffold.ctx.agents.list()) {
      const current = scaffold.ctx.goals.get(existing)
      if (current !== undefined) scaffold.ctx.goals.clear(existing, current)
    }
    const input = page.locator('[data-composer-input]')
    await input.fill('/goal retry after a blocker')
    await input.press('Enter')
    const bar = page.locator('[data-goal-bar]')
    await bar.getByRole('button', { name: 'Pause goal' }).waitFor({ timeout: 10_000 })

    const agents = scaffold.ctx.agents.list()
    expect(agents).toHaveLength(1)
    const agent = agents[0]!
    const active = scaffold.ctx.goals.get(agent)!
    scaffold.ctx.goals.block(agent, active, { code: 'stalled', message: 'No progress in 3 rounds' })
    await bar.getByText('Blocked Goal').waitFor({ timeout: 10_000 })
    expect(await bar.getByRole('button', { name: 'Resume goal' }).count()).toBe(1)

    await bar.getByRole('button', { name: 'Edit goal' }).click()
    await bar.getByRole('textbox', { name: 'Goal objective' }).fill('retry with the edited plan')
    await bar.getByRole('button', { name: 'Save goal' }).click()
    await bar.getByRole('button', { name: 'Edit goal' }).waitFor({ timeout: 10_000 })
    await bar.getByText('retry with the edited plan').waitFor({ timeout: 10_000 })
    expect(scaffold.ctx.goals.get(agent)?.phase).toBe('blocked')
    const blocked = await captureStableAria(page, '[data-goal-bar]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(BLOCKED_EXPECTED, blocked, MODE)

    await bar.getByRole('button', { name: 'Resume goal' }).click()
    await bar.getByRole('button', { name: 'Pause goal' }).waitFor({ timeout: 10_000 })
    expect(scaffold.ctx.goals.get(agent)).toMatchObject({
      phase: 'active', activation: 'armed', objective: 'retry with the edited plan',
    })
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['active.expected.md', 'blocked.expected.md', 'inactive.expected.md'])
  })
})
