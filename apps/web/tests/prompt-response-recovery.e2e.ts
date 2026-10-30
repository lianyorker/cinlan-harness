/** Separates prompt admission from unary-response loss through the real Web composition. */
import { fileURLToPath } from 'node:url'
import { chromium, type WebSocketRoute } from 'playwright'
import { describe, expect, it } from 'vitest'
import { launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/lifecycle-chrome/session.v3.jsonl', import.meta.url))
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe.skipIf(webSnapshotMode() === 'record')('web e2e: held prompt responses', () => {
  it.each(['before-admission', 'after-admission'] as const)(
    'keeps %s distinct from event-stream recovery without replaying the prompt', async (phase) => {
      const scaffold = await launchWebScaffold({ firstUse: true, replayFixture: FIXTURE, compareReplaySession: false, paceMs: 5 })
      const browser = await chromium.launch()
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => { release = resolve })
      let intercepted = false
      let completed = false
      let requests = 0
      try {
        const page = await newEnglishPage(browser)
        const sockets: WebSocketRoute[] = []
        await page.routeWebSocket('**/api/remote.mux', (socket) => {
          sockets.push(socket)
          socket.connectToServer()
        })
        await page.route('**/api/session/prompt', async (route) => {
          requests++
          const response = phase === 'after-admission' ? await route.fetch() : undefined
          intercepted = true
          await gate
          if (response === undefined) await route.continue()
          else await route.fulfill({ response })
        })
        page.on('requestfinished', (request) => {
          if (new URL(request.url()).pathname === '/api/session/prompt') completed = true
        })
        await page.goto(scaffold.authenticatedUrl)
        const input = page.locator('[data-composer-input][contenteditable="true"]').first()
        await input.waitFor()
        await input.fill(PROMPT)
        await input.press('Enter')
        await expect.poll(() => intercepted).toBe(true)
        const users = () => scaffold.ctx.sessions.list().flatMap(session =>
          session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user'))
        await expect.poll(() => users().length).toBe(phase === 'before-admission' ? 0 : 1)
        await expect.poll(() => sockets.length).toBe(1)
        await sockets[0]!.close({ code: 4001, reason: 'prompt response recovery test' })
        await expect.poll(() => sockets.length, { timeout: 15_000 }).toBeGreaterThan(1)
        await page.getByRole('button', { name: 'Reconnecting, reconnect now', exact: true }).waitFor({ state: 'hidden' })
        // A fresh event stream does not settle an independently held HTTP response.
        expect(completed).toBe(false)
        expect(requests).toBe(1)
        const settled = phase === 'before-admission' ? scaffold.whenTurnSettled() : undefined
        release?.()
        await settled
        await expect.poll(() => completed).toBe(true)
        await expect.poll(() => users().length).toBe(1)
        await page.getByText('LIGHTHOUSE', { exact: true }).last().waitFor()
        await page.reload()
        await page.getByText('LIGHTHOUSE', { exact: true }).last().waitFor()
        expect(users()).toHaveLength(1)
        expect(requests).toBe(1)
      } finally {
        release?.()
        await browser.close()
        await scaffold.close()
      }
    }, 60_000,
  )
})
