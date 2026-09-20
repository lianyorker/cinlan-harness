/** Optional assessment services coexist with the independent Security Research resource page. */
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
      { id: 'security-skill-resources', config: { root: join(root, 'resources') } },
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

  it('offers an optional research preset and an independent localized resource page', async () => {
    const status = await scaffold.ctx.securityResearchController.describe(new AbortController().signal)
    expect(status.status).toBe('attention')
    expect(status.scope).toMatchObject({ state: 'empty', targetCount: 0, actionCount: 0 })
    expect(status.preset).toMatchObject({ present: true, trust: 'system' })
    expect(status.skillCount).toBe(0)
    const preset = await scaffold.ctx.agentPresets.resolve('security-research')
    expect(preset.trust).toBe('system')
    expect(preset.broken).toBeUndefined()
    await scaffold.ctx.agentPresets.standingKeyFor('security-research')
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: 'Agent 预设', exact: true }).click()
    await page.getByRole('button', { name: '设为默认: 安全研究', exact: true }).waitFor()
    await page.getByRole('button', { name: '安全研究', exact: true }).click()
    const section = page.getByRole('region', { name: '安全研究资源', exact: true })
    await section.getByText('未安装', { exact: true }).waitFor()
    expect(await section.getByRole('button', { name: '安装内置资源', exact: true }).isEnabled()).toBe(true)
    await section.getByRole('button', { name: '刷新状态', exact: true }).click()
    await section.getByText('未安装', { exact: true }).waitFor()
    for (const name of ['保存授权范围', '生成报告', '添加出口', '添加凭证引用']) {
      expect(await section.getByRole('button', { name, exact: true }).count()).toBe(0)
    }
    for (const name of ['活动 Session ID', '目标（每行 id|kind|value）', 'Execution Host IDs（每行一个）']) {
      expect(await section.getByLabel(name, { exact: true }).count()).toBe(0)
    }
    expect(await section.getByRole('heading', { name: '在会话中使用', exact: true }).count()).toBe(1)
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/device-capabilities/security.expected.md', import.meta.url)),
      await captureStableAria(page, 'section[aria-label="安全研究资源"]', scaffold.workspaceCwd), webSnapshotMode())
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

  it('persists assessment access settings and rejects unknown target references through the Host API', async () => {
    const ctx = scaffold.ctx
    const expectedEgress = [{ protocol: 'https', host: 'example.test', port: 443, purpose: 'target-access', targetId: 'local-fixture' }]
    const expectedCredentials = [{ ref: 'FIXTURE_REFERENCE', purpose: 'target-authentication', targetId: 'local-fixture' }]
    await ctx.settings.mutate('assessment-scope', [
      { op: 'set', path: ['root', 'egress'], value: expectedEgress },
      { op: 'set', path: ['root', 'credentials'], value: expectedCredentials },
    ])
    expect(ctx.assessmentScope.rootGrant.egress).toEqual(expectedEgress)
    expect(ctx.assessmentScope.rootGrant.credentials).toEqual(expectedCredentials)
    const persisted = await readFile(ctx.settings.documentPath!, 'utf8')
    expect(persisted).toContain('FIXTURE_REFERENCE')
    expect(persisted).toContain('example.test')
    for (const [field, rows] of [['egress', expectedEgress], ['credentials', expectedCredentials]] as const) {
      await expect(ctx.settings.mutate('assessment-scope', [{
        op: 'set', path: ['root', field], value: rows.map(row => ({ ...row, targetId: 'unknown-target' })),
      }])).rejects.toThrow()
      expect(ctx.assessmentScope.rootGrant.egress).toEqual(expectedEgress)
      expect(ctx.assessmentScope.rootGrant.credentials).toEqual(expectedCredentials)
      expect(await readFile(ctx.settings.documentPath!, 'utf8')).toBe(persisted)
    }
  })

  it('rejects invalid scope settings and exports authorized Session reports through the controller', async () => {
    const ctx = scaffold.ctx
    expect(ctx.assessmentScope.rootGrant.actions).toContain('report-download')
    const persisted = await readFile(ctx.settings.documentPath!, 'utf8')
    await expect(ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'expiresAt'], value: 0 }])).rejects.toThrow()
    expect(await readFile(ctx.settings.documentPath!, 'utf8')).toBe(persisted)
    const handle = await ctx.agents.create({ sessionId: SessionId('security-report-download'), meta: { cwd: scaffold.workspaceCwd } })
    try {
      await ctx.findings.record(handle.agent, {
        ruleId: FindingRuleId('download-fixture'), title: 'Downloaded fixture', summary: 'Verbatim report metadata',
        state: 'observation', severity: 'informational', confidence: 'high',
        targets: [{ id: FindingTargetId('local-fixture'), kind: 'service', displayName: 'Local fixture' }],
        locations: [], reachability: { kind: 'unknown' },
      }, { pluginId: 'web-fixture', pluginVersion: '1', toolName: 'fixture' })
      for (const format of ['json', 'markdown', 'sarif'] as const) {
        const report = await ctx.securityResearchController.exportReport(
          { sessionId: handle.agent.session.id, format }, new AbortController().signal)
        const bytes = Buffer.from(report.base64, 'base64')
        expect(bytes.byteLength).toBe(report.bytes)
        expect(report.findingCount).toBe(1)
        expect(bytes.toString()).toContain('Downloaded fixture')
      }
      expect(handle.agent.session.snapshotEvents().filter(event => event.type === 'assessment/operation-decided')
        .map(event => event.data.decision.operation.action)).toEqual(['report-download', 'report-download', 'report-download'])
      await ctx.settings.mutate('assessment-scope', [{ op: 'set', path: ['root', 'actions'], value: [] }])
      await expect(ctx.securityResearchController.exportReport({ sessionId: handle.agent.session.id, format: 'json' }, new AbortController().signal))
        .rejects.toMatchObject({ code: 'security-research/scope-required' })
    } finally { await handle.dispose() }
    const section = page.getByRole('region', { name: '安全研究资源', exact: true })
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
    await expect(scaffold.ctx.securityResearchController.exportReport(
      { sessionId: SessionId('security-report-download'), format: 'json' }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'security-research/session-not-live' })
    expect(scaffold.ctx.assessmentScope.rootGrant.egress).toEqual([{ protocol: 'https', host: 'example.test', port: 443, purpose: 'target-access', targetId: 'local-fixture' }])
    expect(scaffold.ctx.assessmentScope.rootGrant.credentials).toEqual([{ ref: 'FIXTURE_REFERENCE', purpose: 'target-authentication', targetId: 'local-fixture' }])
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByRole('button', { name: '安全研究', exact: true }).click()
    await page.getByRole('region', { name: '安全研究资源', exact: true }).getByText('未安装', { exact: true }).waitFor()
    expect(await page.getByLabel('目标（每行 id|kind|value）').count()).toBe(0)
  }, 120_000)

  it('clears advanced lists explicitly after restoring them from disk', async () => {
    await scaffold.ctx.settings.mutate('assessment-scope', [
      { op: 'set', path: ['root', 'egress'], value: [] },
      { op: 'set', path: ['root', 'credentials'], value: [] },
    ])
    expect(scaffold.ctx.assessmentScope.rootGrant.egress).toEqual([])
    expect(scaffold.ctx.assessmentScope.rootGrant.credentials).toEqual([])
    const persisted = await readFile(scaffold.ctx.settings.documentPath!, 'utf8')
    expect(persisted).not.toContain('FIXTURE_REFERENCE')
    expect(persisted).not.toContain('example.test')
  })

  it('retains the independent resource page when the optional assessment preset is disposed', async () => {
    const contribution = [...scaffold.ctx.loader.entries()].find(e => e.options.id === 'security-research-presets')
    expect(contribution?.fiber).toBeDefined()
    await contribution!.fiber!.dispose()
    expect((await scaffold.ctx.agentPresets.list()).map(p => p.id)).not.toContain('security-research')
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
    expect(await page.getByRole('button', { name: '安全研究', exact: true }).count()).toBe(1)
    await page.getByRole('region', { name: '安全研究资源', exact: true }).getByText('未安装', { exact: true }).waitFor()
    expect(consoleWatch.pageErrors).toEqual([])
  })
})
