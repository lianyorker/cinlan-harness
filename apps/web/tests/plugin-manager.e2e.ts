/** Browser plugin management through the shipped Web tree and isolated profile files; no model calls. */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { saveFailureShot, waitForApplicationFrame, ZH_BROWSER_LOCALE } from './support.ts'

const PACKAGE_NAME = '@fixture/plugin-manager-bundle'
const ROW_ID = 'plugin-manager-fixture'
const ROUTE = '/__plugin-manager-fixture'
const WEB_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const POLL_OPTIONS = { timeout: 20_000 }

async function launchManager(patchReload?: 'live' | 'startup') {
  const fixtureDir = patchReload === undefined
    ? undefined
    : await realpath(await mkdtemp(join(tmpdir(), 'dsh-web-plugin-manager-')))
  let scaffold: WebScaffold | undefined = undefined
  let browser: Browser | undefined = undefined
  onTestFinished(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        await scaffold?.close()
      } finally {
        if (fixtureDir !== undefined) await rm(fixtureDir, { recursive: true, force: true })
      }
    }
  })
  if (fixtureDir !== undefined) {
    await writeFile(join(fixtureDir, 'package.json'), JSON.stringify({
      name: PACKAGE_NAME, version: '1.0.0', type: 'module',
      description: 'Browser composition fixture.',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }) + '\n')
    await writeFile(join(fixtureDir, 'cordis.patch.yml'), JSON.stringify([
      { insert: [{ id: ROW_ID, name: './plugin.mjs' }] },
    ]) + '\n')
    await writeFile(join(fixtureDir, 'plugin.mjs'), `export const inject = ['webServer']
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '${ROUTE}',
    handler(_request, response) {
      response.setHeader('x-plugin-manager-fixture', 'active')
      response.end('Plugin fixture is active')
    },
  }), 'plugin-manager fixture route')
}
`)
  }
  scaffold = await launchWebScaffold(fixtureDir === undefined ? {} : {
    profile: { ...patchReload === undefined ? {} : { patchReload }, packages: [{ dir: fixtureDir }] },
  })
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  onTestFailed(() => saveFailureShot(page, `web-e2e-plugin-manager-${patchReload ?? 'unavailable'}`))
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await waitForApplicationFrame(page)
  return { scaffold, page, tripwire }
}

async function openManagement(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('region', { name: '设置' })
  await settings.getByRole('button', { name: '插件', exact: true }).click()
  await settings.getByRole('tab', { name: '管理', exact: true }).click()
  const management = settings.getByRole('tabpanel', { name: '管理', exact: true })
  await management.waitFor()
  return { settings, management }
}

async function selectedBundles(scaffold: WebScaffold): Promise<string[]> {
  const text = await readFile(join(scaffold.harnessHome, 'profiles', 'scaffold', 'package.json'), 'utf8')
  return (JSON.parse(text) as { dsh: { profile: { bundles: string[] } } }).dsh.profile.bundles
}

async function activeRoute(scaffold: WebScaffold): Promise<string | null> {
  const response = await scaffold.hostFetch(ROUTE)
  await response.text()
  return response.headers.get('x-plugin-manager-fixture')
}

it('keeps direct Include fixtures usable with localized unavailable management', async () => {
  const { scaffold, page, tripwire } = await launchManager()
  expect(scaffold.ctx.get('profileContext')).toBeUndefined()
  expect(scaffold.ctx.get('pluginManager')).toBeUndefined()
  const { settings, management } = await openManagement(page)
  await management.getByText(
    '当前连接不提供插件管理。桌面端插件由桌面应用管理；其他插件设置仍可在「可配置」标签页中修改。',
    { exact: true },
  ).waitFor()
  expect(await management.getByRole('button', { name: '添加插件', exact: true }).count()).toBe(0)
  await settings.getByRole('tab', { name: '插件配置', exact: true }).click()
  await settings.getByRole('tabpanel', { name: '插件配置', exact: true })
    .getByRole('button', { name: '展开设置: Subagent', exact: true }).waitFor()
  expect(tripwire.pageErrors).toEqual([])
})

it('persists browser bundle and row switches, disposes their effects, and reloads external profile edits', async () => {
  const { scaffold, page, tripwire } = await launchManager('live')
  const { settings, management } = await openManagement(page)
  const bundle = management.locator(`[data-plugin-package="${PACKAGE_NAME}"]`)
  const toggle = bundle.getByRole('switch', { name: '启用 plugin-manager-bundle', exact: true })
  await toggle.waitFor()
  expect(await toggle.getAttribute('aria-checked')).toBe('false')
  expect(await activeRoute(scaffold)).toBeNull()

  await toggle.click()
  await expect.poll(() => selectedBundles(scaffold), POLL_OPTIONS).toEqual([...WEB_BUNDLES, PACKAGE_NAME])
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBe('active')
  await expect.poll(() => toggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('true')
  await bundle.getByRole('button', { name: '查看 plugin-manager-bundle', exact: true }).click()
  const rowToggle = bundle.getByRole('switch', { name: `启用组件 ${ROW_ID}`, exact: true })
  await expect.poll(() => rowToggle.isEnabled(), POLL_OPTIONS).toBe(true)
  expect((await settings.getByRole('navigation', { name: '设置导航' }).boundingBox())?.width).toBe(280)
  const headerHeight = (await settings.locator('header').boundingBox())?.height
  expect(headerHeight).toBeGreaterThanOrEqual(64)
  expect(headerHeight).toBeLessThanOrEqual(65)
  await saveFailureShot(page, 'web-e2e-plugin-manager-management')
  const patchPath = join(scaffold.harnessHome, 'profiles', 'scaffold', 'cordis.patch.yml')

  await rowToggle.click()
  await expect.poll(() => loadOverlayPatches('plugin manager test', patchPath), POLL_OPTIONS)
    .toContainEqual({ id: ROW_ID, disabled: true })
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBeNull()
  await expect.poll(() => rowToggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('false')
  await rowToggle.click()
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBe('active')
  await expect.poll(() => rowToggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('true')

  await writeFile(patchPath, JSON.stringify([{ id: ROW_ID, disabled: true }]) + '\n')
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBeNull()
  await management.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => rowToggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('false')
  await writeFile(patchPath, '[]\n')
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBe('active')
  await management.getByRole('button', { name: '刷新', exact: true }).click()
  await expect.poll(() => rowToggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('true')

  await toggle.click()
  await expect.poll(() => selectedBundles(scaffold), POLL_OPTIONS).toEqual(WEB_BUNDLES)
  await expect.poll(() => activeRoute(scaffold), POLL_OPTIONS).toBeNull()
  await expect.poll(() => toggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('false')
  expect(tripwire.pageErrors).toEqual([])
})

it('saves startup-only bundle selection with a restart notice and no live activation', async () => {
  const { scaffold, page, tripwire } = await launchManager('startup')
  const { management } = await openManagement(page)
  const bundle = management.locator(`[data-plugin-package="${PACKAGE_NAME}"]`)
  const toggle = bundle.getByRole('switch', { name: '启用 plugin-manager-bundle', exact: true })
  await toggle.waitFor()
  expect(await toggle.getAttribute('aria-checked')).toBe('false')
  expect(await activeRoute(scaffold)).toBeNull()
  await toggle.click()
  await expect.poll(() => selectedBundles(scaffold), POLL_OPTIONS).toEqual([...WEB_BUNDLES, PACKAGE_NAME])
  await expect.poll(() => toggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('true')
  await management.getByText('更改将在下次启动生效', { exact: true }).waitFor()
  expect(await activeRoute(scaffold)).toBeNull()
  await bundle.getByRole('button', { name: '查看 plugin-manager-bundle', exact: true }).click()
  expect(await bundle.getByRole('switch', { name: `启用组件 ${ROW_ID}`, exact: true }).isDisabled()).toBe(true)
  await toggle.click()
  await expect.poll(() => selectedBundles(scaffold), POLL_OPTIONS).toEqual(WEB_BUNDLES)
  await expect.poll(() => toggle.getAttribute('aria-checked'), POLL_OPTIONS).toBe('false')
  expect(await activeRoute(scaffold)).toBeNull()
  expect(tripwire.pageErrors).toEqual([])
})
