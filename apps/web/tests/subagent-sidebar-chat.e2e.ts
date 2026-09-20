/** Built GUI acceptance for parallel, addressed Subagent conversations. No model calls. */
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { createMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { launchWebScaffold, realizeSeedFixture, selectedSessionFixture, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/ptc-round/session.v3.jsonl', import.meta.url))
const AUDIT = fileURLToPath(new URL('../../../.artifacts/official-016-audit/', import.meta.url))
const LABEL = 'parallel recorded tool worker'
const PARENT = 'Parent remains selected beside its worker.'
const PARENT_DRAFT = 'Draft owned by the parent only.'
const CHILD_DRAFT = 'Draft owned by the child only.'
const QUEUED = 'Persisted child inbox item.'
const CHILD_ID = SessionId('parallel-sidebar-recorded-child')

/** Persist recorded child history and a pending inbox row without activating an Agent. */
async function persistChild(scaffold: WebScaffold, parentId: SessionId): Promise<void> {
  const source = await readFile(await selectedSessionFixture(FIXTURE), 'utf8')
  const prepared = prepareSessionSnapshotFixtureForComparison(realizeSeedFixture(scaffold, source, CHILD_ID))
  const [, ...lines] = prepared.trimEnd().split('\n')
  const events = lines.map((line, seq) => ({ ...JSON.parse(line) as SessionEvent, seq, time: 1788240622920 + seq }) as SessionEvent)
  events.push({
    type: 'agent/inbox/spliced', seq: events.length, time: 1788240622920 + events.length,
    data: { target: 'next-turn', start: 0, inserted: [createUserMessage({
      content: [{ type: 'text', text: QUEUED }], source: { kind: 'user' },
    })] },
  } as SessionEvent)
  const meta: SessionHeader = {
    version: SESSION_FORMAT_VERSION, id: CHILD_ID, createdAt: 1788240622920, isSeeded: false,
    cwd: scaffold.workspaceCwd, parentSession: parentId, origin: 'subagent', delegationDepth: 1,
    agentPreset: 'agent',
  }
  events.push({
    type: 'subagent/descriptor', seq: events.length, time: meta.createdAt + events.length,
    data: snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: LABEL }),
  } as SessionEvent)
  const handle = await scaffold.ctx.sessionPersistence.create(meta)
  try {
    await handle.append(events)
  } finally {
    await handle.close()
  }
  scaffold.ctx.sessionProjectionCache.coldSnapshot(meta, SessionLogOffset(0), events)
  await vi.waitFor(() => {
    expect(scaffold.ctx.sessionProjectionCache.cachedSnapshot(meta, SessionLogOffset(0))).toBeDefined()
  }, { timeout: 10_000 })
}

describe('web e2e: parallel Subagent sidebar conversation', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let parentId: SessionId
  let evidence: string
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    await mkdir(AUDIT, { recursive: true })
    evidence = await mkdtemp(join(AUDIT, 'subagent-sidebar-gui-'))
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
    page = await newEnglishPage(browser, 1050)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
    const agent = scaffold.ctx.agents.list()[0]
    if (agent === undefined) throw new Error('workspace did not create the parent Agent')
    parentId = agent.session.id
    agent.session.append('turn/start', { turn: 1 })
    const prompt = agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: PARENT }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    agent.session.append('session/title', { title: PARENT, messageSeqs: [prompt.seq], source: { kind: 'fallback' } })
    agent.session.append('step/start', { turn: 1, step: 1 })
    agent.session.append('assistant/message', {
      turn: 1, step: 1, stream: [], message: createMessage({ role: 'assistant',
        content: [{ type: 'text', text: 'Parent conversation is ready.' }],
        source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      }),
    }, { surfaceOp: 'append' })
    agent.session.append('step/end', { turn: 1, step: 1 })
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await scaffold.ctx.sessions.flush(agent.session)
    await page.getByText('Parent conversation is ready.', { exact: true }).waitFor({ timeout: 15_000 })
    await persistChild(scaffold, parentId)
    await page.reload({ waitUntil: 'load' })
    await page.getByRole('button', { name: '1 subagent', exact: true }).waitFor({ timeout: 20_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('keeps the parent selected while child tools, composer, and durable queue use a parallel tab', async () => {
    onTestFailed(async () => {
      await saveFailureShot(page, 'web-e2e-parallel-subagent-sidebar')
      await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true })
      await writeFile(join(evidence, 'failure.aria.txt'), await page.locator('body').ariaSnapshot())
    })
    const main = page.locator('[data-conversation-scroll]').first()
    const parentEditor = main.locator('[data-composer-input]')
    await parentEditor.fill(PARENT_DRAFT)
    const openAside = async (): Promise<void> => {
      await page.getByRole('button', { name: '1 subagent', exact: true }).hover()
      await page.getByRole('button', { name: 'Open ' + LABEL + ' in sidebar', exact: true }).click()
    }
    await openAside()
    const child = page.locator('[data-subagent-chat]')
    await child.getByText('DONE', { exact: true }).waitFor({ timeout: 20_000 })
    expect(await page.getByRole('navigation', { name: 'Session hierarchy' }).getByRole('button', { name: PARENT, exact: true }).count()).toBe(1)
    expect(await main.getByText('Parent conversation is ready.', { exact: true }).count()).toBe(1)
    expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
    expect(scaffold.ctx.agents.get(CHILD_ID)).toBeUndefined()

    const process = child.locator('[data-turn-process]')
    await expect.poll(() => process.count(), { timeout: 10_000 }).toBeGreaterThan(0)
    for (const control of await process.all()) {
      if (await control.getAttribute('aria-expanded') !== 'true') await control.click()
    }
    await expect.poll(() => child.getByText('CODE_ROUND_OK', { exact: false }).count(), { timeout: 10_000 }).toBeGreaterThan(0)
    const childEditor = child.locator('[data-composer-input][contenteditable="true"]')
    await childEditor.fill(CHILD_DRAFT)
    expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
    expect(await childEditor.textContent()).toBe(CHILD_DRAFT)
    const queue = child.locator('[data-queue-dock]')
    await queue.getByText(QUEUED, { exact: true }).waitFor({ timeout: 10_000 })
    expect(await main.locator('[data-queue-dock]').count()).toBe(0)
    await openAside()
    expect(await child.count()).toBe(1)
    expect(await childEditor.textContent()).toBe(CHILD_DRAFT)

    const panel = page.locator('[data-dsh-panel]').filter({ has: child })
    const dockedBox = await panel.boundingBox()
    const viewport = page.viewportSize()
    const childMount = await child.elementHandle()
    if (dockedBox === null || viewport === null || childMount === null) throw new Error('visible child sidebar has no viewport geometry')
    expect(dockedBox.width).toBeLessThan(viewport.width)
    const fullscreen = page.getByRole('button', { name: 'Show sidebar fullscreen', exact: true })
    const restore = page.getByRole('button', { name: 'Restore sidebar size', exact: true })
    for (const exit of ['button', 'Escape'] as const) {
      await fullscreen.click()
      await expect.poll(() => restore.getAttribute('aria-pressed')).toBe('true')
      await expect.poll(async () => {
        const box = await panel.boundingBox()
        return box !== null && Math.abs(box.x) <= 1 && Math.abs(box.y) <= 1
          && Math.abs(box.width - viewport.width) <= 1 && Math.abs(box.height - viewport.height) <= 1
      }).toBe(true)
      expect(await childMount.evaluate(node => node.isConnected)).toBe(true)
      expect(await childEditor.textContent()).toBe(CHILD_DRAFT)
      expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
      if (exit === 'button') {
        await page.screenshot({ path: join(evidence, 'fullscreen.png'), fullPage: true })
        await restore.click()
      } else {
        await page.keyboard.press('Escape')
      }
      await expect.poll(() => fullscreen.getAttribute('aria-pressed')).toBe('false')
      await expect.poll(async () => {
        const box = await panel.boundingBox()
        return box !== null && Math.abs(box.x - dockedBox.x) <= 1 && Math.abs(box.width - dockedBox.width) <= 1
          && Math.abs(box.y - dockedBox.y) <= 1 && Math.abs(box.height - dockedBox.height) <= 1
      }).toBe(true)
      expect(await childMount.evaluate(node => node.isConnected)).toBe(true)
      expect(await child.count()).toBe(1)
      expect(await childEditor.textContent()).toBe(CHILD_DRAFT)
      expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
      expect(await page.getByRole('navigation', { name: 'Session hierarchy' }).getByRole('button', { name: PARENT, exact: true }).count()).toBe(1)
    }
    await childMount.dispose()
    await page.screenshot({ path: join(evidence, 'parallel.png'), fullPage: true })
    await writeFile(join(evidence, 'parallel.aria.txt'), await page.locator('body').ariaSnapshot())
    const tab = page.locator('[data-dsh-better-sidebar] [draggable="true"]').filter({ hasText: LABEL })
    expect(await tab.count()).toBe(1)
    await tab.getByRole('button', { name: 'Close', exact: true }).click()
    await child.waitFor({ state: 'detached', timeout: 10_000 })
    expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
    await openAside()
    await child.getByText('DONE', { exact: true }).waitFor({ timeout: 20_000 })
    await queue.getByText(QUEUED, { exact: true }).waitFor({ timeout: 10_000 })
    await queue.getByRole('button', { name: 'Edit queued message', exact: true }).click()
    await queue.getByRole('textbox', { name: 'Edit queued message', exact: true }).fill('Edited persisted child inbox item.')
    const mutationResponse = page.waitForResponse(response => response.url().toLowerCase().includes('updatequeue'))
    await queue.getByRole('button', { name: 'Save queued message', exact: true }).click()
    const mutation = await mutationResponse
    const mutationBody = await mutation.text()
    await writeFile(join(evidence, 'queue-mutation.json'), mutationBody)
    console.log('child queue response: ' + mutation.url() + ' ' + mutationBody)
    await queue.getByText('Edited persisted child inbox item.', { exact: true }).waitFor({ timeout: 10_000 })
    expect(scaffold.ctx.agents.get(CHILD_ID)).toBeUndefined()

    await tab.getByRole('button', { name: 'Close', exact: true }).click()
    await child.waitFor({ state: 'detached', timeout: 10_000 })
    await openAside()
    await child.getByText('Edited persisted child inbox item.', { exact: true }).waitFor({ timeout: 10_000 })
    expect(await child.count()).toBe(1)
    expect(await parentEditor.textContent()).toBe(PARENT_DRAFT)
    expect(scaffold.ctx.agents.get(CHILD_ID)).toBeUndefined()
    expect(tripwire.pageErrors).toEqual([])
    await page.screenshot({ path: join(evidence, 'reopened.png'), fullPage: true })
    await writeFile(join(evidence, 'result.json'), JSON.stringify({
      parentId, childId: CHILD_ID, mainSelectionPreserved: true, independentDrafts: true,
      recordedTools: true, coldDurableQueueEdited: true, deduplicated: true, closedAndReopened: true,
      fullscreenRestoredByButtonAndEscape: true, fullscreenMountAndDraftPreserved: true,
      childAgentActivated: false, pageErrors: tripwire.pageErrors,
    }, null, 2) + '\n')
    console.log('parallel Subagent GUI evidence: ' + evidence)
  }, 90_000)
})
