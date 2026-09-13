/** Real Web Work Items Remote and native GitHub provider; only external HTTP is stubbed. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { WorkItemView } from '@deepseek-ai/dsh-api-work-items-controller/types'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as yaml from 'js-yaml'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/cinlan-work-items/cordis.patch.yml', import.meta.url))
const anchor = fileURLToPath(new URL('../../../packages/bundle/cinlan-work-items/package.json', import.meta.url))
const fixtureOrigin = 'https://api.github.com'
const issue = { number: 7, title: 'Native Work Items fixture', body: 'Local association fixture.', state: 'open',
  html_url: 'https://github.com/native-fixture/repository/issues/7', labels: [{ name: 'bug' }], assignees: [],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }

describe('Web optional native Work Items', () => {
  let root: string
  let overlay: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let workspaceId: WorkItemView['associations'][number]['workspaceId']
  const requests: string[] = []
  const signal = new AbortController().signal

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-native-work-items-web-'))
    const fetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin !== fixtureOrigin) return fetch(input, init)
      if ((init?.method ?? 'GET') !== 'GET') throw new Error('fixture forbids external writes')
      if (!url.pathname.startsWith('/repos/native-fixture/repository/issues')) throw new Error('unexpected GitHub request')
      requests.push(url.pathname + url.search)
      return new Response(JSON.stringify(url.pathname.endsWith('/7') ? issue : [issue]), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    })
    overlay = join(root, 'work-items.patch.yml')
    await writeFile(overlay, await readFile(bundle, 'utf8') + yaml.dump([
      { id: 'work-items-github', config: { owner: 'native-fixture', repository: 'repository', allowWrites: false,
        credentialRef: 'WORK_ITEMS_FIXTURE' } },
    ]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'), storageRoot: join(root, 'storage'), extraInstallAnchors: [anchor] })
    await scaffold.ctx.credentials.set(credentialRef('WORK_ITEMS_FIXTURE'), 'not-a-real-credential')
    const directory = join(root, 'workspace')
    await mkdir(directory)
    const workspace = await scaffold.ctx.workspaceRegistry.create(directory)
    workspaceId = workspace.id
    await workspace.setTitle('Work Items fixture workspace')
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  }, 120_000)

  afterAll(async () => {
    const outcomes = await Promise.allSettled([browser?.close(), scaffold?.close()])
    vi.restoreAllMocks()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
    const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason as unknown)
    if (errors.length > 0) throw new AggregateError(errors, 'Work Items Web teardown failed')
  })

  async function openSection(): Promise<void> {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '工作项', exact: true }).click()
    await page.getByRole('button', { name: /Native Work Items fixture/ }).waitFor()
  }

  it('reads through generated Remote, refuses writes, and persists explicit associations across Host restart', async () => {
    const consoleWatch = watchConsole(page)
    await openSection()
    const section = page.locator('section[aria-labelledby="work-items-title"]')
    await section.getByRole('combobox', { name: '工作区范围' }).selectOption(workspaceId)
    await section.getByRole('button', { name: /Native Work Items fixture/ }).click()
    await section.getByRole('heading', { name: 'Native Work Items fixture', exact: true }).waitFor()
    await section.getByRole('button', { name: '关联', exact: true }).click()
    await section.getByRole('button', { name: '取消关联', exact: true }).waitFor()
    const item = await scaffold.ctx.workItemsController.get({ id: 'github:native-fixture/repository#7' as WorkItemView['id'] }, signal)
    expect(item.associations).toEqual([{ workspaceId, workspaceTitle: 'Work Items fixture workspace' }])
    await section.getByText('修改外部工单', { exact: true }).click()
    await section.getByRole('textbox', { name: '工单标题', exact: true }).fill('Must not be sent')
    const requestCount = requests.length
    await section.getByRole('button', { name: '预览外部修改', exact: true }).click()
    await section.getByRole('alert').waitFor()
    expect(requests).toHaveLength(requestCount)
    expect(await section.getByRole('button', { name: '确认执行外部修改', exact: true }).count()).toBe(0)
    await section.getByText('修改外部工单', { exact: true }).click()
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/work-items/linked.expected.md', import.meta.url)),
      await captureStableAria(page, 'section[aria-labelledby="work-items-title"]', scaffold.workspaceCwd), webSnapshotMode())
    for (const width of [1680, 1000, 600]) {
      await page.setViewportSize({ width, height: 1000 })
      const dimensions = await section.evaluate(node => ({ scroll: node.scrollWidth, client: node.clientWidth }))
      expect(dimensions.scroll, `Work Items overflow at viewport ${String(width)}: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.client + 1)
      const control = section.getByRole('button', { name: '取消关联', exact: true })
      await control.scrollIntoViewIfNeeded()
      await expect.poll(() => control.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      })).toBe(true)
    }
    expect(consoleWatch.pageErrors).toEqual([])
    const tool = await scaffold.ctx.tools.execute({ callId: ToolCallId('work-items-native-list'), name: 'work_items_list',
      arguments: { source: 'github', limit: 1 }, signal })
    expect(tool.isError).toBe(false)
    expect(tool.value).toMatchObject({ items: [{ title: issue.title }] })
    await scaffold.close()
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'), storageRoot: join(root, 'storage'), extraInstallAnchors: [anchor] })
    expect((await scaffold.ctx.workItemsController.get({ id: item.id }, signal)).associations).toEqual(item.associations)
    await page.close()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    await page.setViewportSize({ width: 1680, height: 1000 })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openSection()
    await page.getByRole('button', { name: /Native Work Items fixture/ }).click()
    await page.getByRole('button', { name: '取消关联', exact: true }).click()
    await page.getByText('尚无关联', { exact: true }).waitFor()
    expect((await scaffold.ctx.workItemsController.get({ id: item.id }, signal)).associations).toEqual([])
  }, 120_000)

  it('does not mount the optional UI, provider or tools in the ordinary Web profile', async () => {
    await scaffold.close()
    scaffold = await launchWebScaffold({ harnessHome: join(root, 'home'), storageRoot: join(root, 'storage') })
    await page.close()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    expect(await page.getByRole('button', { name: '工作项', exact: true }).count()).toBe(0)
    expect(scaffold.ctx.get('workItems')).toBeUndefined()
    expect(scaffold.ctx.tools.get('work_items_list')).toBeUndefined()
  })
})
