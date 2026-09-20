/** Real Web resource commands against canonical ZIPs and an isolated loopback release server. */
import { once } from 'node:events'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import type {} from '@deepseek-ai/dsh-security-skills/resources'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-skill'
import type { SecuritySkillResourceInstallation } from '@deepseek-ai/dsh-security-skills/types'
import { buildSecuritySkillResource } from '../../../scripts/build-security-skill-resource.ts'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

it('downloads through Settings, retains tasks across navigation, retries, updates, survives a Host restart and removes resources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-security-resources-'))
  const home = join(root, 'home')
  const resourceRoot = join(home, 'resources', 'security-skills')
  const diagnostics = await mkdtemp(join(tmpdir(), 'dsh-security-resources-browser-'))
  const pending = new Map<ServerResponse, Buffer>()
  const archives = new Map<string, Buffer>()
  const requests: string[] = []
  let manifest = ''
  let holdArchives = true
  let failArchive = false
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://fixture').pathname
    requests.push(pathname)
    if (pathname === '/release.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(manifest)
      return
    }
    const bytes = archives.get(pathname)
    if (bytes === undefined) { response.writeHead(404); response.end(); return }
    if (failArchive) { response.writeHead(503); response.end('fixture archive unavailable'); return }
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': bytes.length })
    if (!holdArchives) { response.end(bytes); return }
    response.write(bytes.subarray(0, 64))
    pending.set(response, bytes.subarray(64))
    response.once('close', () => { pending.delete(response) })
  })
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  const agents: AgentHandle[] = []
  const createStandardAgent = async (id: string): Promise<AgentHandle> => {
    const host = scaffold!
    const handle = await host.ctx.agents.create({
      sessionId: SessionId(id), meta: { cwd: host.workspaceCwd, agentPreset: 'standard' },
      setup: agentCtx => host.ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    agents.push(handle)
    return handle
  }
  const catalog = (handle: AgentHandle) => scaffold!.ctx.skills.list({ scope: handle.agent, cwd: scaffold!.workspaceCwd })
  const getSkill = (handle: AgentHandle) => scaffold!.ctx.skills.get('web-resource-fixture', {
    scope: handle.agent, cwd: scaffold!.workspaceCwd,
  })
  const loadSkill = async (handle: AgentHandle, content: string): Promise<string> => {
    await expect.poll(async () => (await catalog(handle)).filter(skill => skill.provider === 'security-skills').map(skill => skill.name))
      .toEqual(['web-resource-fixture'])
    await expect.poll(async () => (await getSkill(handle))?.content).toBe(content)
    const loaded = await getSkill(handle)
    expect(loaded?.provider).toBe('security-skills')
    if (loaded?.resourceBase?.kind !== 'directory') throw new Error('Official skill has no directory resource base')
    const path = join(loaded.resourceBase.path, 'SKILL.md')
    expect(await readFile(path, 'utf8')).toContain(content)
    return path
  }
  const disposeAgents = async (): Promise<void> => { for (const handle of agents.splice(0)) await handle.dispose() }
  const releaseDownloads = (): void => {
    holdArchives = false
    for (const [response, remainder] of pending) response.end(remainder)
    pending.clear()
  }
  const openResources = async (): Promise<void> => {
    await page!.getByRole('button', { name: '设置', exact: true }).click()
    await page!.getByRole('button', { name: '安全研究', exact: true }).click()
    await page!.getByRole('region', { name: '安全研究资源', exact: true }).waitFor()
  }
  const status = () => scaffold!.ctx.securitySkillResources.status()
  type ResourcePointer = { schemaVersion: number; revision: number; installed: SecuritySkillResourceInstallation | null }
  const readPointer = async (): Promise<ResourcePointer> =>
    JSON.parse(await readFile(join(resourceRoot, 'active.json'), 'utf8')) as ResourcePointer
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing release server address')
    const origin = 'http://127.0.0.1:' + String(address.port)
    const sourceRoot = join(root, 'source')
    await mkdir(sourceRoot)
    const licensePath = join(root, 'LICENSE')
    const noticePath = join(root, 'NOTICE')
    const provenancePath = join(root, 'provenance.json')
    await writeFile(licensePath, 'MIT\n')
    await writeFile(noticePath, 'Isolated resource lifecycle fixture.\n')
    await writeFile(provenancePath, JSON.stringify({ source: 'web-resource-fixture', license: { declared: 'MIT' }, audit: { skillCount: 1 } }))
    const releases = []
    for (const version of ['first', 'second']) {
      await writeFile(join(sourceRoot, 'SKILL.md'), [
        '---', 'name: web-resource-fixture', 'description: Controlled resource fixture.', '---', '# ' + version + ' release', '',
      ].join('\n'))
      const archivePath = '/' + version + '.zip'
      const release = await buildSecuritySkillResource({ sourceRoot, licensePath, noticePath, provenancePath,
        outputDirectory: join(root, version), archiveUrl: origin + archivePath })
      archives.set(archivePath, await readFile(release.archivePath))
      releases.push(release.manifest)
    }
    const first = releases[0]!
    const second = releases[1]!
    expect(first.version).not.toBe(second.version)
    manifest = JSON.stringify(first)
    const overlay = join(root, 'resource.patch.yml')
    await writeFile(overlay, yaml.dump([{ id: 'security-skill-resources', config: {
      root: resourceRoot, releaseManifestUrl: origin + '/release.json', downloadTimeoutMs: 60_000,
    } }]))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: home })
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openResources()
    let section = page.getByRole('region', { name: '安全研究资源', exact: true })
    await section.getByText('未安装', { exact: true }).waitFor()
    const standard = await createStandardAgent('resource-standard-before-install')
    expect((await catalog(standard)).filter(skill => skill.provider === 'security-skills')).toEqual([])
    await section.getByRole('button', { name: '下载', exact: true }).click()
    await expect.poll(async () => (await status()).operation?.bytesReceived).toBe(64)
    const operation = (await status()).operation!
    expect(operation.phase).toBe('downloading')
    await expect.poll(() => section.getByRole('progressbar', { name: '资源任务进度' }).getAttribute('value')).toBe('64')
    await page.getByRole('button', { name: '浏览器', exact: true }).click()
    await section.waitFor({ state: 'hidden' })
    expect((await status()).operation?.id).toBe(operation.id)
    await page.getByRole('button', { name: '安全研究', exact: true }).click()
    await section.getByRole('button', { name: '取消任务', exact: true }).waitFor()
    expect((await status()).operation?.id).toBe(operation.id)
    await section.getByRole('button', { name: '取消任务', exact: true }).click()
    await expect.poll(async () => (await status()).operation).toBeUndefined()
    await expect.poll(() => pending.size).toBe(0)
    expect((await status()).installed).toBeUndefined()

    holdArchives = false
    failArchive = true
    await section.getByRole('button', { name: '下载', exact: true }).click()
    await section.getByRole('alert').waitFor()
    expect((await status()).lastError).toBe('The security resource operation failed. The previous installation has been preserved.')
    failArchive = false
    await section.getByRole('button', { name: '重试', exact: true }).click()
    await expect.poll(async () => (await status()).installed?.version).toBe(first.version)
    await section.getByText('已安装', { exact: true }).waitFor()
    const installed = (await readPointer()).installed!
    expect(installed.source).toEqual({ kind: 'download', url: origin + '/first.zip' })
    expect(await readFile(join(resourceRoot, 'generations', installed.generation, 'skills', 'SKILL.md'), 'utf8')).toContain('# first release')

    const firstSkillPath = await loadSkill(standard, '# first release')
    holdArchives = true
    await section.getByRole('button', { name: '重新下载', exact: true }).click()
    await expect.poll(async () => (await status()).operation?.bytesReceived).toBe(64)
    expect((await status()).installed?.generation).toBe(installed.generation)
    releaseDownloads()
    await expect.poll(async () => (await status()).operation).toBeUndefined()
    const reinstalled = (await readPointer()).installed!
    expect(reinstalled.version).toBe(first.version)
    expect(reinstalled.generation).not.toBe(installed.generation)

    manifest = JSON.stringify(second)
    await section.getByRole('button', { name: '检查更新', exact: true }).click()
    await section.getByRole('button', { name: '更新', exact: true }).waitFor()
    expect((await status()).installed?.version).toBe(first.version)
    await section.getByRole('button', { name: '更新', exact: true }).click()
    await expect.poll(async () => (await status()).installed?.version).toBe(second.version)
    await expect.poll(async () => (await status()).operation).toBeUndefined()
    const updated = (await readPointer()).installed!
    expect(updated.generation).not.toBe(reinstalled.generation)
    expect(await readFile(join(resourceRoot, 'generations', updated.generation, 'skills', 'SKILL.md'), 'utf8')).toContain('# second release')
    await loadSkill(standard, '# second release')
    const fresh = await createStandardAgent('resource-standard-after-update')
    await loadSkill(fresh, '# second release')
    expect(await readFile(firstSkillPath, 'utf8')).toContain('# first release')
    await disposeAgents()
    expect(await readFile(firstSkillPath, 'utf8')).toContain('# first release')
    await page.close()
    await scaffold.close()
    await expect(readFile(firstSkillPath)).rejects.toMatchObject({ code: 'ENOENT' })
    scaffold = undefined
    expect((await readPointer()).installed).toEqual(updated)
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: home })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openResources()
    section = page.getByRole('region', { name: '安全研究资源', exact: true })
    await section.getByText(second.version, { exact: true }).waitFor()
    expect((await status()).installed).toEqual(updated)
    const restarted = await createStandardAgent('resource-standard-after-restart')
    const secondSkillPath = await loadSkill(restarted, '# second release')
    await page.screenshot({ path: join(diagnostics, 'installed-after-restart.png'), fullPage: true })
    await writeFile(join(diagnostics, 'installed-after-restart.aria.txt'), await section.ariaSnapshot())
    await section.getByRole('button', { name: '移除资源', exact: true }).click()
    await page.getByRole('dialog', { name: '移除安全研究资源？' }).getByRole('button', { name: '移除资源', exact: true }).click()
    await section.getByText('未安装', { exact: true }).waitFor()
    await expect.poll(readPointer).toEqual({ schemaVersion: 1, revision: 4, installed: null })
    expect(requests.filter(path => path === '/first.zip')).toHaveLength(4)
    expect(requests.filter(path => path === '/second.zip')).toHaveLength(1)
    await expect.poll(async () => (await catalog(restarted)).filter(skill => skill.provider === 'security-skills')).toEqual([])
    expect(await getSkill(restarted)).toBeUndefined()
    const afterRemoval = await createStandardAgent('resource-standard-after-remove')
    expect((await catalog(afterRemoval)).filter(skill => skill.provider === 'security-skills')).toEqual([])
    expect(await getSkill(afterRemoval)).toBeUndefined()
    expect(await readFile(secondSkillPath, 'utf8')).toContain('# second release')
    await page.screenshot({ path: join(diagnostics, 'removed.png'), fullPage: true })
    await disposeAgents()
    expect(await readFile(secondSkillPath, 'utf8')).toContain('# second release')
    await page.close()
    await scaffold.close()
    scaffold = undefined
    await expect(readFile(secondSkillPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(join(diagnostics, 'result.json'), JSON.stringify({
      status: 'passed', firstVersion: first.version, secondVersion: second.version, installed, reinstalled, updated,
      hostBoots: 2, standardAgentRealms: 4, officialProvider: 'security-skills',
      skillContent: ['# first release', '# second release'], retainedUntilHostShutdown: true,
      requests, persistedRemoval: await readPointer(),
    }, undefined, 2))
    console.log('Security resource browser evidence: ' + diagnostics)
  } catch (error) {
    if (page !== undefined && !page.isClosed()) {
      await page.screenshot({ path: join(diagnostics, 'failure.png'), fullPage: true })
        .catch(() => { /* A failed browser launch or teardown can make screenshot capture unavailable. */ })
      await writeFile(join(diagnostics, 'failure.aria.txt'), await page.locator('body').ariaSnapshot())
        .catch(() => { /* Browser disconnect leaves only the original test failure. */ })
    }
    console.error('Security resource browser failure evidence: ' + diagnostics)
    throw error
  } finally {
    for (const response of pending.keys()) response.destroy()
    pending.clear()
    try {
      await browser?.close()
    } finally {
      try {
        try { await disposeAgents() } finally { await scaffold?.close() }
      } finally {
        server.closeAllConnections()
        if (server.listening) await new Promise<undefined>((resolve, reject) => {
          server.close((error) => { if (error) reject(error); else resolve(undefined) })
        })
        await rm(root, { recursive: true, force: true })
      }
    }
  }
}, 180_000)
