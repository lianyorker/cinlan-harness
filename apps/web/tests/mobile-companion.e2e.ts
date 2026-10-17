/** Real mobile Host pairing and workspace/session flow through the shipped web scaffold. */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Browser, Page } from 'playwright'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright') as typeof import('playwright')

describe('Cinlan mobile companion', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let overlay: string
  let overlayDir: string
  let desktopName: string

  beforeAll(async () => {
    overlayDir = await mkdtemp(join(tmpdir(), 'cinlan-mobile-e2e-'))
    overlay = join(overlayDir, 'overlay.yml')
    await writeFile(overlay, [
      '- id: cinlan-mobile-host',
      '  config:',
      '    port: 0',
      `    stateFile: ${join(overlayDir, 'host.json').replaceAll('\\', '/')}`,
      '    pairingMs: 30000',
      '',
    ].join('\n'))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, deepSeekMissingCredential: true })
    const workspacePath = join(scaffold.workspaceCwd, 'mobile-project')
    await mkdir(workspacePath)
    await scaffold.ctx.workspaceRegistry.create(workspacePath, 'Mobile E2E')
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const host = scaffold.ctx.remoteTunnel
    desktopName = (await host.admin({ operation: 'state' }) as { settings: { name: string } }).settings.name
    const offer = await host.admin({ operation: 'pair' }) as { pairingUrl: string }
    await page.goto(offer.pairingUrl)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (overlayDir) await rm(overlayDir, { recursive: true, force: true })
  })

  it('pairs, lists the real workspace, and creates a real session', async () => {
    await page.getByRole('heading', { name: '粘贴配对码' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '保存并连接' }).click()
    await page.getByText('暂无已连接桌面').waitFor({ state: 'detached', timeout: 20_000 })
    await page.screenshot({ path: '.artifacts/mobile-validation/mobile-paired.png', fullPage: true })
    await page.getByText(desktopName, { exact: true }).click()
    await page.screenshot({ path: '.artifacts/mobile-validation/mobile-sessions.png', fullPage: true })
    expect(await page.locator('body').innerText()).toContain('MOBILE-PROJECT')
    await page.getByRole('button', { name: '新建会话' }).click()
    await page.getByRole('button', { name: '创建会话' }).click()
    await page.screenshot({ path: '.artifacts/mobile-validation/mobile-create-result.png', fullPage: true })
    expect(await page.locator('body').innerText()).toContain('新任务')
  }, 60_000)
})
