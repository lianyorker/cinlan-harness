/** Security Research is contributed by an optional bundle, not by the Settings package. */
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as yaml from 'js-yaml'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ArtifactProducerId, ArtifactSessionId } from '@deepseek-ai/dsh-artifact'
import type { LocalArtifactStore } from '@deepseek-ai/dsh-artifact-local'
import { FindingRuleId, FindingTargetId } from '@deepseek-ai/dsh-finding'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ArtifactRef } from '@deepseek-ai/dsh-artifact'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-api-security-research-controller'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'

const bundle = fileURLToPath(new URL('../../../packages/bundle/security-research/cordis.patch.yml', import.meta.url))

describe('Web optional Security Research', () => {
  let root: string
  let overlay: string
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let consoleWatch: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-native-security-'))
    overlay = join(root, 'security.patch.yml')
    await writeFile(overlay, await readFile(bundle, 'utf8') + yaml.dump([
      { id: 'artifact-local', config: { root: join(root, 'artifacts') } },
    ]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home') })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'zh-CN' })
    consoleWatch = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).waitFor({ timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('offers a mountable research preset and its localized capability page', async () => {
    const status = await scaffold.ctx.securityResearchController.describe(new AbortController().signal)
    expect(status.status).toBe('not-configured')
    expect(status.scope).toMatchObject({ state: 'empty', targetCount: 0, actionCount: 0 })
    expect(status.preset).toMatchObject({ present: true, trust: 'system' })
    expect(status.skillCount).toBeGreaterThan(0)
    const preset = await scaffold.ctx.agentPresets.resolve('security-research')
    expect(preset.trust).toBe('system')
    expect(preset.broken).toBeUndefined()
    await scaffold.ctx.agentPresets.standingKeyFor('security-research')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: 'Agent 预设', exact: true }).click()
    await page.getByRole('button', { name: '设为默认: 安全研究', exact: true }).waitFor()
    await page.getByRole('button', { name: '安全研究', exact: true }).click()
    const section = page.locator('[data-capability="security"]')
    await expect.poll(() => section.getAttribute('aria-busy')).toBe('false')
    await section.getByText('待配置', { exact: true }).waitFor()
    const refreshed = page.waitForResponse(value => new URL(value.url()).pathname === '/api/securityResearch/describe')
    await section.getByRole('button', { name: '重新检查', exact: true }).click()
    expect(await (await refreshed).json()).toMatchObject({ result: { ok: true, value: { status: 'not-configured' } } })
    await section.getByText('待配置', { exact: true }).waitFor()
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/device-capabilities/security.expected.md', import.meta.url)),
      await captureStableAria(page, '[data-capability="security"]', scaffold.workspaceCwd), webSnapshotMode())
    const dir = fileURLToPath(new URL('../../../.artifacts/device-control', import.meta.url))
    await mkdir(dir, { recursive: true })
    await page.screenshot({ path: join(dir, 'security-settings.png') })
    expect(consoleWatch.pageErrors).toEqual([])
  })

  it('denies shell, network, and Browser effect tools with an empty scope', async () => {
    const handle = await scaffold.ctx.agents.create({ sessionId: SessionId('security-empty-scope'), meta: { cwd: scaffold.workspaceCwd } })
    try {
      for (const [name, args] of [['bash', { command: 'Write-Output blocked', description: 'blocked' }], ['web_fetch', { url: 'https://example.test/' }], ['browser_open', { url: 'https://example.test/' }]] as const) {
        const result = await scaffold.ctx.tools.execute({ callId: ToolCallId('scope-deny-' + name), name,
          arguments: args, agent: handle.agent, signal: new AbortController().signal })
        expect(result.isError).toBe(true)
        expect(JSON.stringify(result.content)).toMatch(/assessment scope|ASSESSMENT_/i)
      }
    } finally { await handle.dispose() }
  })

  it('persists evidence and reports through the native bundle and enforces Finding transition prerequisites', async () => {
    const ctx = scaffold.ctx
    await ctx.settings.mutate('assessment-scope', [
      { op: 'set', path: ['root', 'executionHostIds'], value: [ctx.executionHost.current().hostId] },
      { op: 'set', path: ['root', 'targets'], value: [{ id: 'local-fixture', kind: 'service', value: 'fixture' }] },
      { op: 'set', path: ['root', 'actions'], value: ['report-download'] },
      { op: 'set', path: ['root', 'evidence', 'minimumRedaction'], value: 'none' },
    ])
    const handle = await ctx.agents.create({
      sessionId: SessionId('security-native-findings'), meta: { cwd: scaffold.workspaceCwd },
    })
    try {
      const agent = handle.agent
      const authorization = { sessionId: ArtifactSessionId(agent.session.id) }
      const evidence = await ctx.artifacts.publish({
        data: new TextEncoder().encode('Local fixture evidence; no external assessment'),
        kind: 'evidence', mediaType: 'text/plain', retention: 'session', redaction: 'none',
        provenance: { ...authorization, producerId: ArtifactProducerId('native-fixture') }, authorization,
      })
      const source = { pluginId: 'native-fixture', pluginVersion: '1', toolName: 'fixture' }
      const base = { ruleId: FindingRuleId('native-fixture'), title: 'Native fixture', summary: 'Local lifecycle evidence',
        state: 'observation' as const, severity: 'informational' as const, confidence: 'high' as const,
        targets: [{ id: FindingTargetId('local-fixture'), kind: 'repository' as const, displayName: 'Fixture' }],
        locations: [], reachability: { kind: 'unknown' as const },
      }
      const observed = await ctx.findings.record(agent, base, source)
      const hypothesis = await ctx.findings.transition(agent, observed, { to: 'hypothesis' }, source)
      await expect(ctx.findings.transition(agent, hypothesis, { to: 'reproduced-vulnerability' }, source)).rejects.toThrow()
      const reproduced = await ctx.findings.transition(agent, hypothesis,
        { to: 'reproduced-vulnerability', evidence: [{ role: 'reproduction', artifact: evidence }] }, source)
      await expect(ctx.findings.transition(agent, reproduced, { to: 'remediation', fixGuidance: 'Fixture correction' }, source)).rejects.toThrow()
      const remediated = await ctx.findings.transition(agent, reproduced,
        { to: 'remediation', fixGuidance: 'Fixture correction', evidence: [{ role: 'remediation-validation', artifact: evidence }] }, source)
      expect(remediated.state).toBe('remediation')
      const pending = await ctx.findings.record(agent, { ...base, ruleId: FindingRuleId('native-unresolved') }, source)
      await ctx.findings.transition(agent, pending, { to: 'unresolved' }, source)
      const reports: ArtifactRef[] = []
      for (const format of ['json', 'markdown', 'sarif']) {
        const result = await ctx.tools.execute({ callId: ToolCallId('native-export-' + format),
          name: 'finding_export', arguments: { format }, agent, signal: new AbortController().signal })
        if (result.isError) throw new Error(JSON.stringify(result.content))
        const value = result.value as { artifact: unknown; findingCount: number }
        expect(value.findingCount).toBe(2)
        reports.push(value.artifact as ArtifactRef)
      }
      const storedStates = agent.session.snapshotEvents().filter(event => event.type === 'finding/change').map(event => event.data.finding.state)
      expect(storedStates).toEqual(['observation', 'hypothesis', 'reproduced-vulnerability', 'remediation', 'observation', 'unresolved'])
      const entry = [...ctx.loader.entries()].find(row => row.options.id === 'artifact-local')
      if (entry === undefined) throw new Error('local Artifact provider row missing')
      await entry.fiber?.dispose()
      await ctx.loader.create({ name: '@deepseek-ai/dsh-artifact-local', config: { root: join(root, 'artifacts') } })
      await ctx.loader.await()
      const store = ctx.artifacts as LocalArtifactStore
      for (const ref of [evidence, ...reports]) {
        expect(await store.describe({ artifactId: ref.artifactId, authorization })).toEqual(ref)
        const result = await store.read({ artifactId: ref.artifactId, authorization, maxBytes: 100_000 })
        expect(result.data.byteLength).toBe(ref.bytes)
        await expect(store.read({ artifactId: ref.artifactId, authorization: {}, maxBytes: 100_000 })).rejects.toMatchObject({ code: 'ARTIFACT_FORBIDDEN' })
      }
    } finally { await handle.dispose() }
  })

  it('saves scope drafts, refuses invalid settings, and downloads exact report bytes', async () => {
    const section = page.locator('[data-capability="security"]')
    const ctx = scaffold.ctx
    await section.getByLabel('Execution Host IDs（每行一个）').fill(ctx.executionHost.current().hostId)
    await section.getByLabel('目标（每行 id|kind|value）').fill('local-fixture|service|fixture')
    await section.getByRole('group', { name: '允许的操作', exact: true }).getByLabel('report-download', { exact: true }).check()
    await section.getByRole('combobox', { name: '最低脱敏', exact: true }).selectOption('none')
    await section.getByRole('button', { name: '保存授权范围', exact: true }).click()
    await section.getByText('授权范围已保存。', { exact: true }).waitFor()
    expect(ctx.assessmentScope.rootGrant.actions).toContain('report-download')
    const persisted = await readFile(ctx.settings.documentPath!, 'utf8')
    expect(persisted).toContain('report-download')
    await section.getByLabel('过期时间（Unix ms）').fill('0')
    await section.getByRole('button', { name: '保存授权范围', exact: true }).click()
    await section.getByRole('alert').waitFor()
    expect(await section.getByLabel('过期时间（Unix ms）').inputValue()).toBe('0')
    expect(ctx.assessmentScope.rootGrant.expiresAt).toBeGreaterThan(0)
    await section.getByRole('button', { name: '放弃范围草稿', exact: true }).click()
    const handle = await ctx.agents.create({ sessionId: SessionId('security-report-download'), meta: { cwd: scaffold.workspaceCwd } })
    try {
      await ctx.findings.record(handle.agent, {
        ruleId: FindingRuleId('download-fixture'), title: 'Downloaded fixture', summary: 'Verbatim report metadata',
        state: 'observation', severity: 'informational', confidence: 'high',
        targets: [{ id: FindingTargetId('local-fixture'), kind: 'service', displayName: 'Local fixture' }],
        locations: [], reachability: { kind: 'unknown' },
      }, { pluginId: 'web-fixture', pluginVersion: '1', toolName: 'fixture' })
      await section.getByLabel('活动 Session ID').fill(handle.agent.session.id)
      for (const format of ['json', 'markdown', 'sarif']) {
        await section.getByRole('combobox', { name: '报告格式', exact: true }).selectOption(format)
        const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/securityResearch/exportReport')
        await section.getByRole('button', { name: '生成报告', exact: true }).click()
        const reply = await (await response).json() as { result: { ok: boolean; value?: { base64: string; bytes: number } } }
        expect(reply.result.ok).toBe(true)
        const downloadEvent = page.waitForEvent('download')
        await section.getByRole('link', { name: /^保存报告：/ }).click()
        const download = await downloadEvent
        const savedPath = await download.path()
        if (savedPath === null || reply.result.value === undefined) throw new Error('Report download is unavailable')
        const bytes = await readFile(savedPath)
        expect(bytes).toEqual(Buffer.from(reply.result.value.base64, 'base64'))
        expect(bytes.byteLength).toBe(reply.result.value.bytes)
        expect(bytes.toString()).toContain('Downloaded fixture')
      }
      expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'assessment/operation-decided')
        .map(event => event.data.decision.operation.action)).toEqual(['report-download', 'report-download', 'report-download'])
      await ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'actions'], value: [] }])
      await section.getByRole('button', { name: '生成报告', exact: true }).click()
      await section.getByText('报告生成失败。Session 可能已不可用，或导出授权被拒绝。', { exact: true }).waitFor()
      expect(await section.getByRole('link', { name: /^保存报告：/ }).count()).toBe(0)
    } finally { await handle.dispose() }
    for (const width of [1680, 1000, 600]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    }
    await page.setViewportSize({ width: 1680, height: 1000 })
    expect(consoleWatch.pageErrors).toEqual([])
  }, 120_000)

  it('restores the saved scope after Host restart without reusing an old Session grant', async () => {
    await scaffold.close()
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home') })
    expect(scaffold.ctx.assessmentScope.rootGrant.targets).toEqual([{ id: 'local-fixture', kind: 'service', value: 'fixture' }])
    expect(scaffold.ctx.assessmentScope.rootGrant.actions).toEqual([])
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '安全研究', exact: true }).click()
    await expect.poll(() => page.getByLabel('目标（每行 id|kind|value）').inputValue()).toBe('local-fixture|service|fixture')
  }, 120_000)

  it('withdraws the settings page when its bundle-owned preset root is disposed', async () => {
    const contribution = [...scaffold.ctx.loader.entries()].find(e => e.options.id === 'security-research-presets')
    expect(contribution?.fiber).toBeDefined()
    await contribution!.fiber!.dispose()
    expect((await scaffold.ctx.agentPresets.list()).map(p => p.id)).not.toContain('security-research')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
    await expect.poll(() => page.getByRole('button', { name: '安全研究', exact: true }).count()).toBe(0)
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
