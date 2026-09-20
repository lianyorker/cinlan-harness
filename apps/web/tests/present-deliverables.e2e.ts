/** Built Conversation delivery cards preview current source files through the existing Files sidebar. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { basename, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { ToolCallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import {
  launchWebScaffold, readPersistedEvents, renderSeedFixture, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { expandTurnProcesses, newEnglishPage, waitForApplicationFrame } from './support.ts'

const AUDIT = fileURLToPath(new URL('../../../.artifacts/official-016-audit/', import.meta.url))
const SEED_ID = SessionId('present-deliverables-web-e2e')
const CALL_ID = ToolCallId('present-deliverables-call')
const TITLE = 'Explicit delivery preview'
const DONE = 'The release files are ready for review.'
const FILES = [
  { path: 'package.json', description: 'Release package manifest' },
  { path: 'release-notes.md', description: 'Release notes' },
]
const ORIGINAL = '{\n  "name": "delivery-preview-original"\n}\n'
const CURRENT = '{\n  "name": "delivery-preview-current-source",\n  "version": "0.1.6-alpha.2"\n}\n'

/** A closed present-only turn declares source paths without mutation-tool artifacts. */
function presentFixture(): { fixture: string; seq: number } {
  const session = Session.create(SessionId('present-deliverables-source'))
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Present the release files for review.' }], source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: TITLE, messageSeqs: [user.seq], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  const args = JSON.stringify({ files: FILES })
  session.append('assistant/message', {
    turn: 1, step: 1, stream: [],
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: CALL_ID, name: 'present', arguments: args }],
      source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  const call = session.append('tool/call', {
    turn: 1, step: 1, callId: CALL_ID, name: 'present', arguments: args,
  })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({
      callId: CALL_ID, content: [{ type: 'text', text: JSON.stringify({ turn: 1, files: FILES }) }], isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  const delivery = session.append('deliverables/presented', { turn: 1, callId: CALL_ID, files: FILES })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('step/start', { turn: 1, step: 2 })
  session.append('assistant/message', {
    turn: 1, step: 2, stream: [],
    message: createAssistantMessage({
      content: [{ type: 'text', text: DONE }], source: { provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 2 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return {
    seq: delivery.seq,
    fixture: renderSeedFixture(JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0,
      cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0,
    }), session.snapshotEvents()),
  }
}

describe.skipIf(webSnapshotMode() === 'record')('web e2e: explicit present deliveries', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let evidence: string
  let deliverySeq: number
  let tripwire: ReturnType<typeof watchConsole>
  const consoleErrors: string[] = []
  const consoleWarnings: string[] = []
  const forbiddenRequests: string[] = []

  beforeAll(async () => {
    await mkdir(AUDIT, { recursive: true })
    evidence = await mkdtemp(join(AUDIT, 'present-deliverables-'))
    scaffold = await launchWebScaffold()
    await writeFile(join(scaffold.workspaceCwd, 'package.json'), ORIGINAL)
    await writeFile(join(scaffold.workspaceCwd, 'release-notes.md'), '# Release notes\n\nExplicit source-file delivery.\n')
    const seed = presentFixture()
    deliverySeq = seed.seq
    await seedSession(scaffold, seed.fixture, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    tripwire = watchConsole(page)
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
      if (message.type() === 'warning') consoleWarnings.push(message.text())
    })
    // Preview has no native action; abort an unexpected handoff before it can launch an app.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      const native = url.pathname === '/api/present.open'
        || /openWorkspacePath/i.test(url.pathname) || url.searchParams.get('method') === 'open.external'
      if (native || (url.protocol.startsWith('http') && url.origin !== scaffold.baseUrl)) {
        forbiddenRequests.push(url.pathname + url.search)
        await route.abort('blockedbyclient')
      } else {
        await route.continue()
      }
    })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await waitForApplicationFrame(page)
  })

  afterAll(async () => {
    const failures: unknown[] = []
    if (evidence !== undefined) {
      await writeFile(join(evidence, 'console.json'), JSON.stringify({
        errors: consoleErrors, warnings: consoleWarnings, pageErrors: tripwire?.pageErrors ?? [],
        transportWarnings: tripwire?.warnings ?? [], forbiddenRequests,
      }, null, 2) + '\n').catch((error: unknown) => failures.push(error))
    }
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length > 0) throw new AggregateError(failures, 'Present delivery acceptance teardown failed')
  })

  it('renders delivered cards and file icons, then previews the current authorized source in Files', async () => {
    onTestFailed(async () => {
      await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true })
      await writeFile(join(evidence, 'failure.aria.txt'), await page.locator('body').ariaSnapshot())
    })
    const group = page.getByRole('treeitem').first()
    await group.waitFor()
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').filter({ hasText: basename(scaffold.workspaceCwd) }).click()
    const conversation = page.locator('[data-conversation-scroll]').first()
    await conversation.getByText(DONE, { exact: true }).waitFor()
    const cards = conversation.locator('[data-presented-file]')
    await expect.poll(() => cards.count()).toBe(FILES.length)
    const manifest = cards.filter({ hasText: 'package.json' })
    const notes = cards.filter({ hasText: 'release-notes.md' })
    const preview = manifest.getByRole('button', { name: 'Preview package.json in sidebar', exact: true })
    expect(await preview.isEnabled()).toBe(true)
    expect(normalize(await preview.getAttribute('title') ?? '')).toBe(join(scaffold.workspaceCwd, 'package.json'))
    const codeIcon = manifest.locator('svg[width="20"][height="20"][viewBox="0 0 20 20"]')
    expect(await codeIcon.count()).toBe(1)
    expect(await codeIcon.locator('path').count()).toBeGreaterThan(0)
    expect(await notes.locator('svg[width="20"][viewBox="0 0 28 28"] [data-file-type-mark]').count()).toBe(1)
    expect(await conversation.locator('[data-produced-files-row]').count()).toBe(0)

    await expandTurnProcesses(page)
    const tool = conversation.locator('[data-tool="present"][data-state="ok"]')
    await tool.getByText('Present files', { exact: true }).waitFor()
    await tool.getByText('Delivered', { exact: true }).waitFor()
    const persisted = await readPersistedEvents(scaffold, SEED_ID)
    expect(persisted[deliverySeq]).toMatchObject({
      type: 'deliverables/presented', seq: deliverySeq, data: { turn: 1, callId: CALL_ID, files: FILES },
    })
    expect(scaffold.ctx.agents.get(SEED_ID)?.status).toBe('idle')
    await page.screenshot({ path: join(evidence, 'conversation.png'), animations: 'disabled' })
    await writeFile(join(evidence, 'conversation.aria.txt'), await page.locator('body').ariaSnapshot())

    await writeFile(join(scaffold.workspaceCwd, 'package.json'), CURRENT)
    const readResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname === '/api/sidebar.api' && url.searchParams.get('method') === 'fs.read'
    })
    await preview.click()
    const response = await readResponse
    expect(response.status()).toBe(200)
    const request = response.request().postDataJSON() as { sessionId: string; cwd: string; path: string }
    expect(request.sessionId).toBe(SEED_ID)
    expect(normalize(request.cwd)).toBe(scaffold.workspaceCwd)
    expect(normalize(request.path)).toBe(join(scaffold.workspaceCwd, 'package.json'))
    expect(await response.json()).toEqual({ ok: true, value: { kind: 'text', content: CURRENT, truncated: false } })
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    await sidebar.locator('[title="package.json"][draggable="true"]').waitFor()
    await expect.poll(() => sidebar.innerText()).toContain('delivery-preview-current-source')
    expect(await sidebar.innerText()).not.toContain('delivery-preview-original')
    expect(await readFile(join(scaffold.workspaceCwd, 'package.json'), 'utf8')).toBe(CURRENT)
    expect(scaffold.ctx.agents.get(SEED_ID)?.status).toBe('idle')
    expect(await conversation.getByText(DONE, { exact: true }).isVisible()).toBe(true)
    expect(await cards.count()).toBe(FILES.length)
    expect(await manifest.locator('[data-error]').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    expect(consoleErrors).toEqual([])
    expect(consoleWarnings).toEqual([])
    expect(forbiddenRequests).toEqual([])
    await page.screenshot({ path: join(evidence, 'preview.png'), animations: 'disabled' })
    await writeFile(join(evidence, 'preview.aria.txt'), await page.locator('body').ariaSnapshot())
    await writeFile(join(evidence, 'result.json'), JSON.stringify({
      sessionId: SEED_ID, deliverySeq, fileIndex: 0, path: FILES[0]!.path,
      previewRequest: request, currentSource: CURRENT, presentedCards: FILES.length,
      presentToolState: 'ok', codeIcon: { width: 20, viewBox: '0 0 20 20' },
      markdownIcon: { width: 20, viewBox: '0 0 28 28' }, sourceReadStatus: response.status(),
      agentStatus: 'idle', externalActions: forbiddenRequests,
    }, null, 2) + '\n')
    console.log('Present delivery GUI evidence: ' + evidence)
  })
})
