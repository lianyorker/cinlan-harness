/** Real Web Settings -> persisted preferences -> local browser tools, without Orca. */
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { createRequire } from 'node:module'
import type * as PlaywrightCore from 'playwright-core'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import * as yaml from 'js-yaml'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/cordis.patch.yml', import.meta.url))

describe('Harness native browser settings and tools', () => {
  let root: string
  let scaffold: WebScaffold
  let ui: Browser
  let page: Page
  let server: Server
  let url: string
  let overlay: string
  let sequence = 0

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-native-browser-web-'))
    const runtime = createRequire(new URL('../../../packages/browser/browser-playwright/package.json', import.meta.url))('playwright-core') as typeof PlaywrightCore
    const launch = runtime.chromium.launchPersistentContext.bind(runtime.chromium)
    vi.spyOn(runtime.chromium, 'launchPersistentContext').mockImplementation(async (directory, options) => {
      const context = await launch(directory, options)
      await context.route('https://www.bing.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Native search fixture</title>Search response' }))
      return context
    })
    overlay = join(root, 'browser.patch.yml')
    await writeFile(overlay, await readFile(bundle, 'utf8') + yaml.dump([
      { id: 'browser-playwright', config: { storageDir: join(root, 'browser-profile'), browserChannel: 'chromium', headless: true } },
      { id: 'browser-permission-policy', config: { observe: 'allow', navigate: 'allow', interact: 'allow' } },
    ]))
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://fixture.test').pathname
      if (path === '/download') {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=fixture.txt' })
        response.end('native-download-bytes'); return
      }
      const title = path === '/cookie-check'
        ? request.headers.cookie?.includes('native_fixture=fixture-value') ? 'Cookie present' : 'Cookie missing'
        : path === '/next' ? 'Native next' : path === '/home' ? 'Native home' : 'Native fixture'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><title>${title}</title><button aria-label="Continue" onclick="document.title='Native clicked'">Continue</button><a href="/next">Next page</a><input type="file" aria-label="Upload fixture" onchange="this.files[0].text().then(value => document.title='Uploaded '+value)"/><a href="/download" download>Download fixture</a>`)
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture listener missing')
    url = `http://127.0.0.1:${String(address.port)}`
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/package.json', import.meta.url))] })
    ui = await chromium.launch()
    page = await ui.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    await ui?.close()
    await scaffold?.close()
    if (server !== undefined) await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    vi.restoreAllMocks()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  async function tool(name: string, args: Record<string, JsonValue>) {
    const result = await scaffold.ctx.tools.execute({ callId: ToolCallId(`native-browser-${String(++sequence)}`), name,
      arguments: args, signal: new AbortController().signal })
    if (result.isError) throw new Error(JSON.stringify(result.content))
    return result
  }

  it('saves localized preferences through the real Settings Remote and keeps them across Host restart', async () => {
    const consoleWatch = watchConsole(page)
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '浏览器', exact: true }).click()
    const section = page.locator('[data-capability="browser"]')
    const preferences = section.locator('form').filter({ has: page.getByRole('combobox', { name: '浏览器引擎', exact: true }) })
    await section.getByRole('combobox', { name: '浏览器引擎' }).waitFor()
    await expect.poll(() => section.getByRole('combobox', { name: '浏览器引擎' }).inputValue()).toBe('chromium')
    await section.getByRole('spinbutton', { name: '视口宽度（px）' }).fill('920')
    await section.getByRole('spinbutton', { name: '视口高度（px）' }).fill('640')
    await section.getByRole('textbox', { name: '主页 URL' }).fill(url + '/home')
    await section.getByRole('textbox', { name: '浏览器配置名' }).fill('research')
    await section.getByRole('combobox', { name: '搜索引擎' }).selectOption('bing')
    await section.getByRole('button', { name: '保存浏览器设置', exact: true }).click()
    await section.getByText('已保存，重启当前 profile 后生效。', { exact: true }).waitFor()
    await section.getByRole('textbox', { name: '主页 URL' }).fill('javascript:void(0)')
    await section.getByRole('button', { name: '保存浏览器设置', exact: true }).click()
    await section.getByRole('alert').filter({ hasText: '保存失败' }).waitFor()
    expect(await section.getByRole('textbox', { name: '主页 URL' }).inputValue()).toBe('javascript:void(0)')
    await preferences.getByRole('button', { name: '放弃草稿', exact: true }).click()
    expect(await section.getByRole('textbox', { name: '主页 URL' }).inputValue()).toBe(url + '/home')
    const stored = yaml.load(await readFile(join(root, 'home', 'settings.yaml'), 'utf8'))
    expect(stored).toMatchObject({ 'browser-playwright': { browserChannel: 'chromium', headless: true, viewportWidth: 920, viewportHeight: 640 } })
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/device-capabilities/native-browser.expected.md', import.meta.url)),
      (await captureStableAria(page, '[data-capability="browser"]', scaffold.workspaceCwd)).replaceAll(url, '{{browserOrigin}}'), webSnapshotMode())
    const screenshots = fileURLToPath(new URL('../../../.artifacts/native-migration-20260913', import.meta.url))
    await mkdir(screenshots, { recursive: true })
    for (const width of [1680, 1000, 600]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      const widthControl = section.getByRole('spinbutton', { name: '视口宽度（px）' })
      await widthControl.scrollIntoViewIfNeeded()
      await expect.poll(() => widthControl.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node
      }), { timeout: 5000 }).toBe(true)
      if (width === 1680 || width === 600) await page.screenshot({ path: join(screenshots, `browser-settings-${String(width)}.png`) })
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(consoleWatch.pageErrors).toEqual([])
    await scaffold.close()
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/package.json', import.meta.url))] })
    const prefs = scaffold.ctx.settings.describe().find(row => row.ns === 'browser-playwright')
    expect(prefs).toMatchObject({ applies: 'restart', value: { viewportWidth: 920, viewportHeight: 640 } })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '浏览器', exact: true }).click()
    await expect.poll(() => page.getByRole('spinbutton', { name: '视口宽度（px）' }).inputValue()).toBe('920')
  })

  it('uses real Chromium through the model-facing tools and preserves screenshot dimensions from Settings', async () => {
    const modules = [...scaffold.ctx.loader.entries()].filter(row => !row.disabled).map(row => row.options.name)
    expect(modules).toContain('@deepseek-ai/dsh-browser-playwright')
    expect(modules).not.toContain('@deepseek-ai/dsh-browser-cinlan')
    const opened = await tool('browser_open', { url })
    const pageId = (opened.value as { page_id: string }).page_id
    const observed = await tool('browser_snapshot', { page_id: pageId })
    const state = observed.value as { observation_id: string; elements: Array<{ element_id: string; name: string }> }
    const button = state.elements.find(row => row.name === 'Continue')
    if (button === undefined) throw new Error('native snapshot has no fixture button')
    await tool('browser_click', { page_id: pageId, observation_id: state.observation_id, element_id: button.element_id })
    expect((await tool('browser_list', {})).content.some(block => block.type === 'text' && block.text.includes('Native clicked'))).toBe(true)
    const shot = await scaffold.ctx.browser.screenshot({ pageId: pageId as never, format: 'png' })
    const bytes = Buffer.from(shot.data)
    expect(bytes.readUInt32BE(16)).toBe(920)
    expect(bytes.readUInt32BE(20)).toBe(640)
    await tool('browser_close', { page_id: pageId })
  })

  it('opens configured home/search pages and exercises native back, forward, history, and network tools', async () => {
    const opened = await tool('browser_home', {})
    const pageId = (opened.value as { page_id: string }).page_id
    expect((await scaffold.ctx.browser.snapshot({ pageId: pageId as never })).title).toBe('Native home')
    await tool('browser_navigate', { page_id: pageId, url: url + '/next?token=not-retained' })
    expect((await tool('browser_back', { page_id: pageId })).value).toMatchObject({ url: url + '/home' })
    expect((await tool('browser_forward', { page_id: pageId })).value).toMatchObject({ title: 'Native next' })
    const history = await tool('browser_history', { page_id: pageId, limit: 20 })
    expect(JSON.stringify(history.value)).toContain('/next')
    expect(JSON.stringify(history.value)).not.toContain('not-retained')
    const network = await tool('browser_network', { page_id: pageId, limit: 20 })
    const entries = (network.value as { entries: Array<{ method: string; status?: number }> }).entries
    expect(entries.some(entry => entry.method === 'GET' && entry.status === 200)).toBe(true)
    expect(JSON.stringify(network.value)).not.toContain('not-retained')
    const searched = await tool('browser_search', { query: 'native fixture' })
    const searchPage = (searched.value as { page_id: string }).page_id
    const searchSnapshot = await scaffold.ctx.browser.snapshot({ pageId: searchPage as never })
    expect(searchSnapshot.url).toContain('www.bing.com/search?q=native+fixture')
    expect(searchSnapshot.title).toBe('Native search fixture')
    await tool('browser_close', { page_id: searchPage })
    await tool('browser_close', { page_id: pageId })
  })

  it('uploads observed file bytes and saves page-owned download bytes through tools and UI', async () => {
    const opened = await tool('browser_open', { url: url + '/transfers' })
    const pageId = (opened.value as { page_id: string }).page_id
    const section = page.locator('[data-capability="browser"]')
    await section.getByRole('button', { name: '连接 / 刷新浏览器', exact: true }).click()
    await section.getByRole('combobox', { name: '浏览器页面', exact: true }).selectOption(pageId)
    const panel = section.locator('details').filter({ has: page.getByText('文件上传与下载', { exact: true }) })
    await panel.locator('summary').click()
    await panel.getByRole('button', { name: '观察文件输入', exact: true }).click()
    await panel.getByRole('combobox', { name: '目标输入框' }).selectOption({ label: 'Upload fixture' })
    await panel.getByLabel('要上传的文件', { exact: true }).setInputFiles({ name: 'ui-upload.txt', mimeType: 'text/plain', buffer: Buffer.from('ui-bytes') })
    await panel.getByRole('button', { name: '上传到选定输入框', exact: true }).click()
    await panel.getByText('文件输入已设置，请在目标页面检查。', { exact: true }).waitFor()
    await expect.poll(async () => (await scaffold.ctx.browser.snapshot({ pageId: pageId as never })).title).toBe('Uploaded ui-bytes')
    const handle = await scaffold.ctx.agents.create({ sessionId: SessionId('browser-transfer-agent'), meta: { cwd: scaffold.workspaceCwd } })
    try {
      await writeFile(join(scaffold.workspaceCwd, 'tool-upload.txt'), 'tool-bytes')
      const observation = await scaffold.ctx.browser.snapshot({ pageId: pageId as never })
      const input = observation.elements.find(element => element.name === 'Upload fixture')!
      const upload = await scaffold.ctx.tools.execute({ name: 'browser_upload', callId: ToolCallId('upload-fixture'),
        arguments: { page_id: pageId, observation_id: observation.observationId, element_id: input.elementId, file_path: 'tool-upload.txt' },
        agent: handle.agent, signal: new AbortController().signal })
      expect(upload.isError).toBe(false)
      await expect.poll(async () => (await scaffold.ctx.browser.snapshot({ pageId: pageId as never })).title).toBe('Uploaded tool-bytes')
    } finally { await handle.dispose() }
    const observation = await scaffold.ctx.browser.snapshot({ pageId: pageId as never })
    const link = observation.elements.find(element => element.name === 'Download fixture')!
    await tool('browser_click', { page_id: pageId, observation_id: observation.observationId, element_id: link.elementId })
    await expect.poll(async () => (await scaffold.ctx.browser.downloads(pageId as never)).items[0]?.status).toBe('complete')
    const downloads = await tool('browser_downloads', { page_id: pageId })
    const downloadId = (downloads.value as { items: Array<{ download_id: string }> }).items[0]!.download_id
    const saved = await tool('browser_save_download', { page_id: pageId, download_id: downloadId })
    const file = saved.value as { attachmentId: string; name: string; bytes: number }
    const chunks: Uint8Array[] = []
    for await (const chunk of scaffold.ctx.attachments.readFileStream({ ...file, attachmentId: AttachmentId(file.attachmentId) })) {
      chunks.push(chunk)
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('native-download-bytes')
    await panel.getByRole('button', { name: '刷新页面下载', exact: true }).click()
    await panel.getByRole('button', { name: '读取下载文件', exact: true }).click()
    const downloading = page.waitForEvent('download')
    await panel.getByRole('link', { name: '保存文件：fixture.txt', exact: true }).click()
    const downloaded = await downloading
    const path = await downloaded.path()
    if (path === null) throw new Error('download file missing')
    expect(await readFile(path, 'utf8')).toBe('native-download-bytes')
    for (const width of [600, 1000, 1680]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      const control = panel.getByLabel('要上传的文件', { exact: true })
      await control.scrollIntoViewIfNeeded()
      await expect.poll(() => control.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node
      })).toBe(true)
    }
    await tool('browser_close', { page_id: pageId })
  }, 120_000)

  it('imports a human-selected cookie file through Remote, persists it, and isolates another profile', async () => {
    const section = page.locator('[data-capability="browser"]')
    await section.getByRole('button', { name: '连接 / 刷新浏览器', exact: true }).click()
    await section.getByText('当前运行的 Browser profile：research', { exact: true }).waitFor()
    await section.getByRole('button', { name: '打开主页', exact: true }).click()
    await section.getByRole('button', { name: '页面访问记录', exact: true }).click()
    await expect.poll(() => section.getByRole('list', { name: '页面访问记录' }).textContent()).toContain('/home')
    await section.getByRole('button', { name: '网络检查', exact: true }).click()
    await expect.poll(() => section.getByRole('list', { name: '网络检查' }).textContent()).toContain('200')
    await section.getByLabel('Cookie JSON 文件（最多 256 KiB）', { exact: true }).setInputFiles({ name: 'fixture-cookies.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ name: 'native_fixture', value: 'fixture-value', domain: '127.0.0.1', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 }])) })
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/browser/importCookies')
    await section.getByRole('button', { name: '导入到当前 Browser profile', exact: true }).click()
    expect(await (await response).json()).toMatchObject({ result: { ok: true, value: { imported: 1, profileName: 'research' } } })
    await section.getByText('已导入 1 个 Cookie；未返回 Cookie 值。', { exact: true }).waitFor()
    expect(await section.textContent()).not.toContain('fixture-value')
    expect(await readFile(join(root, 'home', 'settings.yaml'), 'utf8')).not.toContain('native_fixture')
    const check = async (expected: string): Promise<void> => {
      const opened = await tool('browser_open', { url: url + '/cookie-check' })
      const id = (opened.value as { page_id: string }).page_id
      expect((await scaffold.ctx.browser.snapshot({ pageId: id as never })).title).toBe(expected)
      await tool('browser_close', { page_id: id })
    }
    await check('Cookie present')
    await scaffold.close()
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/package.json', import.meta.url))] })
    await check('Cookie present')
    await scaffold.ctx.settings.update('browser-playwright', { profileName: 'isolated' })
    await scaffold.close()
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/cinlan-browser/package.json', import.meta.url))] })
    expect(scaffold.ctx.browser.currentProfile()).toBe('isolated')
    await check('Cookie missing')
  }, 120_000)

})
