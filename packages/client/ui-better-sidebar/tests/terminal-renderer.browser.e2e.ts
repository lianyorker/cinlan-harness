/** Source renderer coverage; external callbacks replace the terminal service, never xterm or browser APIs. */
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createViteServer } from 'vitest/node'
import tsconfigPaths from 'vite-tsconfig-paths'
// Reuse the browser lane's installed dependencies without launching an application or building artifacts.
import { chromium, type Browser, type Page } from '../../../../apps/web/node_modules/playwright/index.js'
import type {} from './browser-terminal/types.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('./browser-terminal/', import.meta.url))
const terminalSelector = '[data-dsh-terminal-tab="terminal:browser-fixture"]'

// The same case/hook budgets as vitest.web.config.ts cover cold source transforms and Chromium startup.
describe('TerminalView in real Chromium', { timeout: 180_000 }, () => {
  let artifacts: string
  let server: Awaited<ReturnType<typeof createViteServer>> | undefined
  let browser: Browser | undefined
  let origin: string

  beforeAll(async () => {
    artifacts = await mkdtemp(join(tmpdir(), 'dsh-terminal-browser-'))
    console.log('TerminalView browser artifacts: ' + artifacts)
    server = await createViteServer({
      configFile: false,
      root: fixtureRoot,
      cacheDir: join(artifacts, 'vite-cache'),
      plugins: [tsconfigPaths({ projects: [join(repository, 'tsconfig.base.json')] })],
      oxc: { jsx: { runtime: 'automatic' } },
      resolve: { dedupe: ['react', 'react-dom'] },
      optimizeDeps: { include: ['react', 'react-dom/client', '@xterm/xterm', '@xterm/addon-fit'] },
      server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
    })
    // Vite's listen() treats zero as the default port; the owned HTTP server allocates it atomically.
    const httpServer = server.httpServer!
    const listening = once(httpServer, 'listening')
    httpServer.listen(0, '127.0.0.1')
    await listening
    const address = httpServer.address()
    if (address === null || typeof address === 'string') throw new Error('Vite did not bind a loopback TCP listener')
    origin = 'http://127.0.0.1:' + String(address.port)
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch({ headless: true, ...(executablePath === undefined ? {} : { executablePath }) })
  }, 120_000)

  afterAll(async () => {
    try {
      await browser?.close()
    } finally {
      try {
        await server?.close()
        expect(server?.httpServer?.listening).not.toBe(true)
      } finally {
        if (artifacts !== undefined) await rm(join(artifacts, 'vite-cache'), { recursive: true, force: true })
      }
    }
  }, 120_000)

  async function withRenderer(name: string, locale: string, run: (page: Page) => Promise<void>): Promise<void> {
    const context = await browser!.newContext({ viewport: { width: 1050, height: 680 }, locale, colorScheme: 'dark' })
    try {
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      const consoleMessages: { type: string; text: string }[] = []
      const pageErrors: string[] = []
      page.on('console', message => consoleMessages.push({ type: message.type(), text: message.text() }))
      page.on('pageerror', error => pageErrors.push(error.stack ?? error.message))
      let passed = false
      try {
        await page.goto(origin, { waitUntil: 'load' })
        await page.waitForFunction(() => window.terminalRenderer?.requests.length === 1)
        await page.locator(terminalSelector + ' .xterm-rows').waitFor({ state: 'visible' })
        await run(page)
        expect(pageErrors).toEqual([])
        expect(consoleMessages.filter(message => message.type === 'error' || message.type === 'warning')).toEqual([])
        passed = true
      } finally {
        try {
          if (!passed && !page.isClosed()) await page.screenshot({ path: join(artifacts, name + '-failure.png'), fullPage: true })
        } finally {
          await writeFile(join(artifacts, name + '-browser.json'), JSON.stringify({ consoleMessages, pageErrors }, null, 2) + '\n')
        }
      }
    } finally {
      await context.close()
    }
  }

  it('acknowledges parsed output, delivers keyboard input, resizes and closes the removed tab once', async () => {
    await withRenderer('output-input-resize-close', 'en-US', async (page) => {
      const opening = await page.evaluate(() => window.terminalRenderer.requests.at(0)!)
      expect(opening.target).toEqual({
        kind: 'ui', sessionId: 'terminal-browser-session', tabId: 'terminal:browser-fixture',
        floating: { windowId: '00112233-4455-4677-8899-aabbccddeeff', directory: 'missing-folder/用户输入' },
      })
      await page.evaluate(() => window.terminalRenderer.ready())
      await page.waitForFunction(() => window.terminalRenderer.resizes.length > 0)
      const before = await page.evaluate(() => window.terminalRenderer.resizes.at(-1)!)
      expect(before[1]).toBeGreaterThan(0)
      expect(before[2]).toBeGreaterThan(0)

      // DSR is answered by xterm's parser. The answer must exist when the data sink resolves.
      const completion = await page.evaluate(() => window.terminalRenderer.write(
        '\x1b[2J\x1b[H\x1b[32mREAL XTERM OUTPUT\x1b[0m\r\nsecond frame line\r\n\x1b[6n',
      ))
      expect(completion).toEqual({ sequence: 1, inputsAtCompletion: '\x1b[3;1R' })
      const rendered = page.locator(terminalSelector + ' .xterm-rows')
      await expect.poll(() => rendered.textContent(), { timeout: 30_000 }).toContain('REAL XTERM OUTPUT')
      expect(await rendered.textContent()).toContain('second frame line')
      const inputStart = await page.evaluate(() => window.terminalRenderer.inputs.length)
      const input = page.locator(terminalSelector + ' textarea.xterm-helper-textarea')
      await input.focus()
      expect(await input.evaluate(element => element === document.activeElement)).toBe(true)
      await page.keyboard.type('echo browser')
      await page.keyboard.press('Enter')
      await expect.poll(() => page.evaluate(start => window.terminalRenderer.inputs.slice(start).map(([, data]) => data).join(''), inputStart))
        .toBe('echo browser\r')
      expect(await page.evaluate(() => window.terminalRenderer.inputs.every(([id]) => id === 'terminal-browser-attachment'))).toBe(true)
      await page.evaluate(() => window.terminalRenderer.write('echo browser\r\nbrowser input reached callback\r\n'))
      await expect.poll(() => rendered.textContent()).toContain('browser input reached callback')
      await page.screenshot({ path: join(artifacts, 'terminal-output.png'), fullPage: true })

      await page.locator('#terminal-stage').evaluate((element) => {
        element.style.width = '520px'
        element.style.height = '260px'
      })
      await page.waitForFunction((previous) => {
        const next = window.terminalRenderer.resizes.at(-1)!
        return next[1] < previous[1] && next[2] < previous[2]
      }, before)
      const after = await page.evaluate(() => window.terminalRenderer.resizes.at(-1)!)
      expect(after[0]).toBe('terminal-browser-attachment')
      expect(after[1]).toBeGreaterThan(0)
      expect(after[2]).toBeGreaterThan(0)
      const screenWidth = await page.locator(terminalSelector + ' .xterm-screen').evaluate(element => element.getBoundingClientRect().width)
      expect(screenWidth).toBeLessThanOrEqual(520)
      await expect.poll(() => rendered.locator(':scope > div').count()).toBe(after[2])
      await page.screenshot({ path: join(artifacts, 'terminal-resized.png'), fullPage: true })

      await page.evaluate(() => window.terminalRenderer.unmount('close-tab'))
      expect(await page.locator(terminalSelector).count()).toBe(0)
      expect(await page.locator('.xterm').count()).toBe(0)
      expect(await page.evaluate(() => ({ closes: window.terminalRenderer.closes, closed: window.terminalRenderer.closed })))
        .toEqual({ closes: ['close'], closed: ['close'] })
      const resizeCount = await page.evaluate(() => window.terminalRenderer.resizes.length)
      await page.locator('#terminal-stage').evaluate(async (element) => {
        element.style.width = '700px'
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { resolve() })))
      })
      await page.keyboard.type('after-dispose')
      expect(await page.evaluate(() => window.terminalRenderer.resizes.length)).toBe(resizeCount)
      expect(await page.evaluate(start => window.terminalRenderer.inputs.slice(start).map(([, data]) => data).join(''), inputStart))
        .toBe('echo browser\r')
      expect(await page.evaluate(() => window.terminalRenderer.closes)).toEqual(['close'])
      await writeFile(join(artifacts, 'lifecycle.json'), JSON.stringify({ opening, completion, before, after, close: 'close' }, null, 2) + '\n')
    })
  })

  it.each([
    ['keep-tab', 'disconnect'],
    ['switch-session', 'park'],
  ] as const)('releases a retained terminal once on %s', async (action, mode) => {
    await withRenderer('unmount-' + mode, 'en-US', async (page) => {
      await page.evaluate(() => window.terminalRenderer.ready())
      await page.evaluate(value => window.terminalRenderer.unmount(value), action)
      expect(await page.locator('.xterm').count()).toBe(0)
      expect(await page.evaluate(() => ({ closes: window.terminalRenderer.closes, closed: window.terminalRenderer.closed })))
        .toEqual({ closes: [mode], closed: [mode] })
    })
  })

  it('renders the localized invalid-directory error while retaining the captured directory', async () => {
    await withRenderer('invalid-directory-zh', 'zh-CN', async (page) => {
      await page.evaluate(() => { window.terminalRenderer.invalidDirectory() })
      await page.getByRole('button', { name: '重试', exact: true }).waitFor({ state: 'visible' })
      const banner = page.locator(terminalSelector).locator(':scope > div').first()
      expect(await banner.innerText()).toMatchInlineSnapshot(
        '"终端连接失败: 请选择此会话工作区内已存在的文件夹。在悬浮工作区设置中修改目录后，新建终端；已保存的输入保持不变。\n重试"',
      )
      expect(await page.evaluate(() => window.terminalRenderer.capturedDirectory())).toBe('missing-folder/用户输入')
      await page.screenshot({ path: join(artifacts, 'terminal-invalid-directory-zh.png'), fullPage: true })
      await page.evaluate(() => window.terminalRenderer.unmount('keep-tab'))
    })
  })
})
