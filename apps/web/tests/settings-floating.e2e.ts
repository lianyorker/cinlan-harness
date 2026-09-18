/** Real Web settings and popup lifecycle through the shipped app and durable Session API. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import { waitForApplicationFrame } from './support.ts'
import {
  acknowledgeReloadConnectionLoss, assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'

const MODE = webSnapshotMode()
const EXPECTED = fileURLToPath(new URL('./expected/settings-floating', import.meta.url))
const ARTIFACTS = fileURLToPath(new URL('../../../.artifacts/settings-floating', import.meta.url))
const GOLDENS = ['settings.expected.md', 'popup-control.expected.md', 'narrow.expected.md', 'keybinding.expected.md', 'blocked.expected.md']
const SECTION = '[data-floating-workspace-section]'
const COMMAND_ROW = '[data-settings-anchor="keybinding-floatingWorkspace.toggle"]'
const SESSION_ID = 'floating-workspace-browser-session'
const FIXTURE = createChatScrollFixture({ markerPrefix: 'FLOATING_WORKSPACE_BROWSER', title: 'Floating workspace browser acceptance', turns: 1 })

/** Live-page evidence retained before context teardown, including setup failures. */
interface PageDiagnostics {
  console: { type: string; text: string }[]
  responses: { path: string; type: string; status: number }[]
  failures: { path: string; error: string | undefined }[]
}

async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
  })
}

async function openSeed(page: Page): Promise<void> {
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  const searchButton = page.getByRole('button', { name: 'Search sessions', exact: true })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  await page.getByRole('textbox', { name: 'Search sessions...', exact: true }).fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await expect.poll(() => results.count(), { timeout: 30_000 }).toBe(1)
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(1), { exact: false }).last().waitFor({ timeout: 30_000 })
}

async function closeChild(child: Page): Promise<void> {
  await Promise.all([
    child.waitForEvent('close'),
    child.locator('[data-floating-child-control]').getByRole('button', { name: 'Close workspace window', exact: true }).click(),
  ])
}

async function dimensions(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
}

describe('web e2e: floating workspace uses the real app window', () => {
  let browser: Browser
  let scaffold: WebScaffold
  let context: BrowserContext
  let page: Page
  let observedPages = new Map<Page, ReturnType<typeof watchConsole>>()
  let observedDiagnostics = new Map<Page, PageDiagnostics>()
  let artifactDir: string

  beforeAll(async () => {
    await mkdir(ARTIFACTS, { recursive: true })
    if (MODE === 'refresh') await mkdir(EXPECTED, { recursive: true })
    browser = await chromium.launch()
  })

  afterAll(async () => { await browser?.close() })

  beforeEach(async () => {
    const observations = new Map<Page, ReturnType<typeof watchConsole>>()
    const diagnostics = new Map<Page, PageDiagnostics>()
    observedPages = observations
    observedDiagnostics = diagnostics
    artifactDir = await mkdtemp(join(ARTIFACTS, 'run-'))
    const ownedArtifacts = artifactDir
    const ownScaffold = await launchWebScaffold({})
    scaffold = ownScaffold
    let ownContext: BrowserContext | undefined = undefined
    const recordPage = (value: Page): void => {
      observations.set(value, watchConsole(value))
      const diagnostic: PageDiagnostics = { console: [], responses: [], failures: [] }
      diagnostics.set(value, diagnostic)
      value.on('console', (message) => { diagnostic.console.push({ type: message.type(), text: message.text() }) })
      value.on('response', (response) => { diagnostic.responses.push({ path: new URL(response.url()).pathname, type: response.request().resourceType(), status: response.status() }) })
      value.on('requestfailed', (request) => { diagnostic.failures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }) })
    }
    // Register before seeding or browser navigation so failed setup also releases the Host.
    onTestFinished(async () => {
      const failures: unknown[] = []
      let diagnosticIndex = 0
      for (const [observed, observation] of observations) {
        if (!observed.isClosed()) {
          await (async () => {
            await observed.screenshot({ path: join(ownedArtifacts, 'final-' + String(diagnosticIndex) + '.png') })
            const pageState = await observed.evaluate(() => {
              const boot: unknown = Reflect.get(globalThis, '__DSH_BOOT__')
              return { body: document.body.innerText, title: document.title, ready: document.readyState, boot }
            })
            await writeFile(join(ownedArtifacts, 'diagnostics-' + String(diagnosticIndex) + '.json'), JSON.stringify({ pageState, ...diagnostics.get(observed), ...observation }, null, 2) + '\n')
          })().catch((error: unknown) => { failures.push(error) })
        }
        diagnosticIndex += 1
      }
      ownContext?.off('page', recordPage)
      await ownContext?.close().catch((error: unknown) => { failures.push(error) })
      await ownScaffold.close().catch((error: unknown) => { failures.push(error) })
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) throw new AggregateError(failures, 'Floating Web scenario cleanup failed')
    })
    await seedSession(ownScaffold, FIXTURE.log, SESSION_ID)
    ownContext = await browser.newContext({ viewport: null, locale: 'en-US' })
    context = ownContext
    ownContext.on('page', recordPage)
    page = await ownContext.newPage()
    // The main page has a review viewport; actual popups keep the context's native geometry.
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(ownScaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
    await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 30_000 })
    await openSeed(page)
  })

  afterEach(() => {
    for (const observation of observedPages.values()) {
      expect(observation.warnings).toEqual([])
      expect(observation.pageErrors).toEqual([])
    }
    for (const diagnostic of observedDiagnostics.values()) {
      expect(diagnostic.console.filter(message => message.type === 'error')).toEqual([])
    }
  })

  async function openSettings(label: 'Floating Workspace' | 'Keybindings' = 'Floating Workspace'): Promise<Locator> {
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    if (!await settings.isVisible()) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const navigation = settings.getByRole('button', { name: label, exact: true })
    await navigation.click()
    await expect.poll(() => navigation.getAttribute('aria-current')).toBe('page')
    await settings.locator(label === 'Floating Workspace' ? SECTION : '[data-keybindings-section]').waitFor()
    return settings
  }

  async function closeSettings(): Promise<void> {
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'Back to app', exact: true }).click()
    await settings.waitFor({ state: 'hidden' })
  }

  async function overrides(namespace: string): Promise<Record<string, unknown>> {
    const document: unknown = load(await readFile(join(scaffold.harnessHome, 'settings.yaml'), 'utf8'))
    if (typeof document !== 'object' || document === null || Array.isArray(document)) throw new Error('Expected a settings document')
    const value = (document as Record<string, unknown>)[namespace]
    if (value === undefined) return {}
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected namespace settings')
    return value as Record<string, unknown>
  }

  async function setEnabled(value: boolean): Promise<void> {
    const control = page.locator(SECTION).getByRole('switch', { name: 'Enable Floating Workspace', exact: true })
    await expect.poll(() => control.isEnabled()).toBe(true)
    if (await control.getAttribute('aria-checked') !== String(value)) await control.click()
    await expect.poll(() => control.getAttribute('aria-checked')).toBe(String(value))
    await expect.poll(() => overrides('floating-workspace')).toMatchObject({ enabled: value })
    await expect.poll(() => control.isEnabled()).toBe(true)
  }

  async function setPosition(value: 'header' | 'sidebar' | 'floating'): Promise<void> {
    const control = page.locator(SECTION).getByRole('combobox', { name: 'Entry position', exact: true })
    await control.selectOption(value)
    await expect.poll(() => overrides('floating-workspace')).toMatchObject({ toggleButtonPosition: value })
    await expect.poll(() => control.isEnabled()).toBe(true)
  }

  async function setDimension(label: 'Window width' | 'Window height', key: 'floatDefaultWidth' | 'floatDefaultHeight', value: number): Promise<void> {
    const control = page.locator(SECTION).getByRole('spinbutton', { name: label, exact: true })
    await control.fill(String(value))
    await control.press('Enter')
    await expect.poll(() => overrides('floating-workspace')).toMatchObject({ [key]: value })
    await expect.poll(() => control.isEnabled()).toBe(true)
  }

  async function capture(name: string, selector: string, source = page): Promise<void> {
    const snapshot = await captureStableAria(source, selector, scaffold.workspaceCwd)
    await compareOrRefreshGolden(join(EXPECTED, name + '.expected.md'), snapshot, MODE)
    await source.screenshot({ path: join(artifactDir, name + '.png') })
  }

  async function assertClearControls(source: Page, subject: Locator, label: string): Promise<void> {
    const viewport = await dimensions(source)
    const measured = async (target: Locator) => {
      await target.waitFor({ state: 'visible' })
      const box = await target.boundingBox()
      if (box === null) throw new Error('Visible control has no measured box: ' + target.toString())
      return box
    }
    const subjectBox = await measured(subject)
    const protectedBoxes = [{ label: 'Send message', box: await measured(source.getByRole('button', { name: 'Send message', exact: true })) }]
    const header = source.locator('header').filter({ has: source.getByRole('button', { name: 'Session log', exact: true }) })
    const headerButtons = header.getByRole('button')
    expect(await headerButtons.count()).toBeGreaterThan(0)
    for (const button of await headerButtons.all()) {
      if (await button.isVisible()) protectedBoxes.push({ label: await button.getAttribute('aria-label') ?? await button.innerText(), box: await measured(button) })
    }
    await writeFile(join(artifactDir, label + '-' + String(observedPages.size) + '.geometry.json'), JSON.stringify({ viewport, subject: subjectBox, protected: protectedBoxes }, null, 2) + '\n')
    for (const { box } of [{ box: subjectBox }, ...protectedBoxes]) {
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.x).toBeGreaterThanOrEqual(-0.5)
      expect(box.y).toBeGreaterThanOrEqual(-0.5)
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5)
    }
    for (const protectedControl of protectedBoxes) {
      const box = protectedControl.box
      expect(subjectBox.x + subjectBox.width <= box.x || box.x + box.width <= subjectBox.x
        || subjectBox.y + subjectBox.height <= box.y || box.y + box.height <= subjectBox.y,
      label + ' overlaps ' + protectedControl.label).toBe(true)
    }
  }

  async function openChild(gesture: () => Promise<void>): Promise<Page> {
    const [child] = await Promise.all([page.waitForEvent('popup'), gesture()])
    await child.waitForLoadState('load')
    await waitForApplicationFrame(child)
    await child.getByText(FIXTURE.markers.assistant(1), { exact: false }).last().waitFor({ timeout: 30_000 })
    await child.locator('[data-floating-child-control]').waitFor({ timeout: 30_000 })
    await assertClearControls(child, child.locator('[data-floating-child-control]'), 'child-close')
    return child
  }

  it('persists accepted preferences and owns one real Session popup through close and disable', async () => {
    await openSettings()
    const section = page.locator(SECTION)
    expect(await section.getByRole('switch', { name: 'Enable Floating Workspace', exact: true }).getAttribute('aria-checked')).toBe('false')
    expect(await section.getByRole('spinbutton', { name: 'Window width', exact: true }).inputValue()).toBe('400')
    expect(await section.getByRole('spinbutton', { name: 'Window height', exact: true }).inputValue()).toBe('300')
    expect(await section.getByRole('combobox', { name: 'Entry position', exact: true }).inputValue()).toBe('header')
    await setEnabled(true)
    await nextPaint(page)
    expect(observedPages.size).toBe(1)
    expect(context.pages()).toHaveLength(1)

    for (const position of ['sidebar', 'floating', 'header'] as const) {
      await setPosition(position)
      await closeSettings()
      await page.locator('[data-floating-entry="' + position + '"]').waitFor()
      expect(await page.locator('[data-floating-entry]').count()).toBe(1)
      await openSettings()
    }
    await setDimension('Window width', 'floatDefaultWidth', 600)
    await setDimension('Window height', 'floatDefaultHeight', 400)
    await capture('settings', SECTION)
    const observation = observedPages.get(page)
    if (observation === undefined) throw new Error('Main page console observer is missing')
    const warningStart = observation.warnings.length
    await page.reload({ waitUntil: 'load' })
    await waitForApplicationFrame(page)
    acknowledgeReloadConnectionLoss(observation, warningStart)
    await openSeed(page)
    await openSettings()
    expect(await section.getByRole('switch', { name: 'Enable Floating Workspace', exact: true }).getAttribute('aria-checked')).toBe('true')
    expect(await section.getByRole('spinbutton', { name: 'Window width', exact: true }).inputValue()).toBe('600')
    expect(await section.getByRole('spinbutton', { name: 'Window height', exact: true }).inputValue()).toBe('400')
    expect(await section.getByRole('combobox', { name: 'Entry position', exact: true }).inputValue()).toBe('header')
    expect(observedPages.size).toBe(1)

    const open = section.getByRole('button', { name: 'Open workspace window', exact: true })
    const child = await openChild(() => open.click())
    const sourceUrl = new URL(page.url())
    const childUrl = new URL(child.url())
    expect(childUrl.origin).toBe(sourceUrl.origin)
    expect(childUrl.pathname).toBe(sourceUrl.pathname)
    expect(childUrl.username).toBe('')
    expect(childUrl.password).toBe('')
    expect(childUrl.hash).toBe('')
    expect([...childUrl.searchParams.keys()].sort()).toEqual(['dsh-floating-owner', 'dsh-floating-session', 'dsh-floating-workspace'])
    expect(childUrl.searchParams.get('dsh-floating-workspace')).toBe('1')
    expect(childUrl.searchParams.get('dsh-floating-session')).toBe(SESSION_ID)
    const owner = childUrl.searchParams.get('dsh-floating-owner')
    if (owner === null) throw new Error('Floating URL owner is missing')
    expect(owner).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u)
    expect(await child.evaluate(() => window.name)).toBe('dsh-floating-workspace-' + owner)
    expect(await child.opener()).toBe(page)
    expect(await dimensions(child)).toEqual({ width: 600, height: 400 })
    expect(await child.locator('[data-floating-entry]').count()).toBe(0)
    await child.keyboard.press('Control+Shift+Space')
    await nextPaint(child)
    expect(context.pages()).toHaveLength(2)
    expect(child.isClosed()).toBe(false)
    await capture('popup-control', '[data-floating-child-control]', child)
    await child.setViewportSize({ width: 320, height: 400 })
    await nextPaint(child)
    await assertClearControls(child, child.locator('[data-floating-child-control]'), 'child-close-320')
    await child.screenshot({ path: join(artifactDir, 'popup-narrow.png') })
    await child.setViewportSize({ width: 600, height: 400 })
    await nextPaint(child)

    await setDimension('Window width', 'floatDefaultWidth', 720)
    await setDimension('Window height', 'floatDefaultHeight', 500)
    expect(await dimensions(child)).toEqual({ width: 600, height: 400 })
    const positionControl = section.getByRole('combobox', { name: 'Entry position', exact: true })
    await positionControl.focus()
    expect(await positionControl.evaluate(element => element === document.activeElement)).toBe(true)
    await closeChild(child)
    await expect.poll(() => open.evaluate(element => element === document.activeElement)).toBe(true)

    const reopened = await openChild(() => open.click())
    expect(await dimensions(reopened)).toEqual({ width: 720, height: 500 })
    await Promise.all([reopened.waitForEvent('close'), setEnabled(false)])
    await expect.poll(() => context.pages().length).toBe(1)
    await closeSettings()
    expect(await page.locator('[data-floating-entry]').count()).toBe(0)
    const knownPages = observedPages.size
    await page.keyboard.press('Control+Shift+Space')
    await nextPaint(page)
    expect(observedPages.size).toBe(knownPages)
  })

  it('keeps narrow controls usable and dispatches the saved keyboard override', async () => {
    await openSettings()
    await setEnabled(true)
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 844 })
      const settings = page.locator('[data-dsh-settings-page]')
      await expect.poll(() => settings.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await page.locator(SECTION).getByRole('spinbutton', { name: 'Window height', exact: true }).scrollIntoViewIfNeeded()
      expect(await page.locator(SECTION).getByRole('spinbutton', { name: 'Window height', exact: true }).isVisible()).toBe(true)
    }
    await capture('narrow', SECTION)
    await page.setViewportSize({ width: 1280, height: 900 })
    await openSettings('Keybindings')
    const command = page.locator(COMMAND_ROW)
    await command.getByText('Toggle Floating Workspace', { exact: true }).waitFor()
    await capture('keybinding', COMMAND_ROW)
    await command.getByRole('button', { name: 'Record: Toggle Floating Workspace', exact: true }).click()
    await page.keyboard.press('Control+Shift+F8')
    await expect.poll(() => overrides('keybindings')).toMatchObject({ overrides: [{
      commandId: 'floatingWorkspace.toggle', binding: { key: 'F8', modifiers: { mod: true, ctrl: false, meta: false, alt: false, shift: true } },
    }] })
    await expect.poll(() => command.getByRole('button', { name: 'Reset: Toggle Floating Workspace', exact: true }).isEnabled()).toBe(true)
    await closeSettings()
    await page.keyboard.press('Control+Shift+Space')
    await nextPaint(page)
    expect(context.pages()).toHaveLength(1)
    const child = await openChild(() => page.keyboard.press('Control+Shift+F8'))
    await closeChild(child)
    await openSettings('Keybindings')
    await command.getByRole('button', { name: 'Reset: Toggle Floating Workspace', exact: true }).click()
    await expect.poll(() => overrides('keybindings')).not.toHaveProperty('overrides')
    await closeSettings()
    const resetChild = await openChild(() => page.keyboard.press('Control+Shift+Space'))
    await closeChild(resetChild)
  })

  it('reports a browser-blocked open and retries with the actual native browser API', async () => {
    await openSettings()
    await setEnabled(true)
    await closeSettings()
    const entry = page.locator('[data-floating-entry="header"]').getByRole('button', { name: 'Toggle Floating Workspace', exact: true })
    const savedOpen = await page.evaluateHandle(() => window.open)
    try {
      // The sole replacement is the documented browser popup-refusal result; Remote stays real.
      await page.evaluate(() => { window.open = () => null })
      await entry.click()
      const feedback = page.locator('[data-floating-feedback]')
      await feedback.waitFor()
      expect(await feedback.textContent()).toBe('The browser blocked the workspace window. Allow pop-ups for this app, then try Open again.')
      expect(context.pages()).toHaveLength(1)
      expect(observedPages.size).toBe(1)
      for (const width of [600, 320]) {
        await page.setViewportSize({ width, height: 400 })
        await nextPaint(page)
        await assertClearControls(page, feedback, 'blocked-' + String(width))
        await page.screenshot({ path: join(artifactDir, 'blocked-' + String(width) + '.png') })
      }
      await page.setViewportSize({ width: 1280, height: 900 })
      await nextPaint(page)
      await assertClearControls(page, feedback, 'blocked-wide')
      await capture('blocked', '[data-floating-feedback]')
    } finally {
      try {
        await page.evaluate((original) => { window.open = original }, savedOpen)
      } finally {
        await savedOpen.dispose()
      }
    }
    const child = await openChild(() => entry.click())
    expect(await page.locator('[data-floating-feedback]').count()).toBe(0)
    await closeChild(child)
  })

})

it('web e2e: keeps the floating expected-output inventory closed', async () => {
  await assertFixtureInventory(EXPECTED, GOLDENS)
})
