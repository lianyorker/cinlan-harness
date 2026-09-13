import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PlaywrightBrowserProvider, resolvePlaywrightBrowserConfig } from '../src/index.ts'

const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function chromeInstalled(): boolean {
  if (process.platform !== 'win32') return false
  return [
    process.env.PROGRAMFILES,
    process.env['PROGRAMFILES(X86)'],
    process.env.LOCALAPPDATA,
  ].some(root => root !== undefined && existsSync(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')))
}

async function fixtureUrl(): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Before</title><button aria-label="Continue" onclick="document.title=\'After\'">Continue</button>')
  })
  servers.push(server)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server did not bind a TCP port')
  return `http://127.0.0.1:${address.port}`
}

describe.runIf(chromeInstalled())('Playwright browser real Chrome', () => {
  it('opens, observes, captures, clicks, screenshots, and closes a local page', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'dsh-browser-playwright-'))
    roots.push(profile)
    const provider = new PlaywrightBrowserProvider(resolvePlaywrightBrowserConfig({
      storageDir: profile,
      browserChannel: 'chrome',
      headless: true,
      actionTimeoutMs: 15_000,
      navigationTimeoutMs: 15_000,
    }))
    try {
      const opened = await provider.openPage({ url: await fixtureUrl() })
      const observation = await provider.snapshot({ pageId: opened.pageId })
      expect(observation.tree).toContain('Continue')
      const element = observation.elements.find(candidate => candidate.name === 'Continue')
      if (element === undefined) throw new Error('button missing from Playwright observation')
      const crop = await provider.captureElement({
        pageId: opened.pageId,
        target: {
          kind: 'observation',
          observationId: observation.observationId,
          elementId: element.elementId,
        },
        format: 'png',
      })
      expect(crop.verified).toBe(true)
      expect(crop.target).toEqual({
        kind: 'observation',
        observationId: observation.observationId,
        elementId: element.elementId,
      })
      expect(crop.rect.width).toBeGreaterThan(0)
      expect(crop.rect.height).toBeGreaterThan(0)
      expect(crop.data.byteLength).toBeGreaterThan(100)
      await provider.click({
        pageId: opened.pageId,
        observationId: observation.observationId,
        elementId: element.elementId,
      })
      await expect(provider.listPages()).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ pageId: opened.pageId, title: 'After' }),
      ]))
      const screenshot = await provider.screenshot({ pageId: opened.pageId, format: 'png' })
      expect(screenshot.data.byteLength).toBeGreaterThan(100)
      await provider.closePage({ pageId: opened.pageId })
    } finally {
      await provider.dispose()
    }
  })
})
