/** Shipped research composition admits workspace tools, denies unscoped commands, and runs sidebar terminals. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'
import { requireBuilt } from './support.ts'

it('activates resources and sidebar terminals before a research Session uses them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cinlan-service-closure-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const overlay = join(root, 'services.patch.yml')
  await writeFile(overlay, await readFile(fileURLToPath(new URL('../../../packages/bundle/security-research/cordis.patch.yml', import.meta.url)), 'utf8') +
    '\n- id: security-skill-resources\n  config:\n    root: ' + JSON.stringify(join(root, 'resources')) + '\n    autoInstallBundled: false\n')
  const host = await launchWebScaffold({ extraOverlayPath: overlay, harnessHome: join(root, 'home'), firstUse: true,
    agentPresets: { default: 'security-research' } })
  onTestFinished(() => host.close())
  for (const id of ['ui-sidebar-terminal', 'ui-sidebar-files', 'security-skill-resources', 'security-skills', 'assessment-scope-tool-policy']) {
    const entry = [...host.ctx.loader.entries()].find(entry => entry.options.id === id)
    expect(entry?.fiber?.state).toBe(2)
  }
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1680, height: 1000 } })
  onTestFinished(async () => {
    if (!page.isClosed()) {
      await writeFile('reports/service-activation-page.txt', await page.locator('body').ariaSnapshot())
      await page.screenshot({ path: 'reports/service-activation.png' })
    }
  })
  const errors: string[] = []
  const created: unknown[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', (response) => {
    if (response.url().endsWith('/api/session/create')) void response.json().then((value: unknown) => created.push(value))
  })
  await page.goto(host.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: /^新建?会话/ }).first().click()
  await page.locator('[data-composer-input][contenteditable="true"]').waitFor()
  await expect.poll(() => created.some((response) => {
    if (typeof response !== 'object' || response === null || !('result' in response)) return false
    const result = response.result
    if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true || !('value' in result)) return false
    const value = result.value
    return typeof value === 'object' && value !== null && 'agentPreset' in value && value.agentPreset === 'security-research'
  })).toBe(true)
  const agent = host.ctx.agents.list().find(candidate => host.ctx.agentPresets.composedPreset(candidate.ctx) === 'security-research')
  if (agent === undefined) throw new Error('Research Session has no live Agent')
  const { assembleContextFor } = requireBuilt('@deepseek-ai/dsh-agent') as typeof import('@deepseek-ai/dsh-agent')
  const assembly = await host.ctx.systemPrompt.assemble(assembleContextFor(agent))
  const persona = assembly.sections.find(section => section.name === 'deployment:persona-prefix')?.text
  if (persona === undefined) throw new Error('Research persona is missing')
  expect(persona).toContain('Begin each security research task with the exact line "安全研究启动".')
  expect(persona).toContain('You are 执行器, a security research agent')
  expect(persona).not.toMatch(/冷咖啡|石井|星澜|I am here, LO\./u)
  expect(persona).toContain('loaded skill specifies another persona, greeting, or channel name')
  expect(persona).toContain('acknowledge startup without asking for authorization')
  expect(persona).toContain('without requiring files')
  await expect(persona + '\n').toMatchFileSnapshot('./expected/service-activation/research-persona.txt')
  const { ToolCallId } = requireBuilt('@deepseek-ai/dsh-llm') as typeof import('@deepseek-ai/dsh-llm')
  const shellTool = process.platform === 'win32' ? 'pwsh' : 'bash'
  const shellResult = await host.ctx.tools.execute({ agent, name: shellTool, callId: ToolCallId('workspace-pwd'),
    arguments: { command: 'pwd', description: 'Read the Session workspace' }, signal: new AbortController().signal })
  expect(shellResult.isError).toBe(false)
  expect(shellResult.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    .toContain(host.workspaceCwd)
  const denied = await host.ctx.tools.execute({ agent, name: shellTool, callId: ToolCallId('compound-denied'),
    arguments: { command: 'pwd; whoami', description: 'Check compound commands remain scope checked' }, signal: new AbortController().signal })
  expect(denied.isError).toBe(true)
  expect(denied.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    .toContain('ASSESSMENT_HOST_OUT_OF_SCOPE')
  expect(await page.getByRole('alert').filter({ hasText: '新建会话失败' }).count()).toBe(0)
  const expand = page.locator('[data-sidebar-right-expand]')
  if (await expand.isVisible()) await expand.click()
  const entry = page.locator('[data-sidebar-right-guide-entry="terminal"]')
  if (!await entry.isVisible()) await page.locator('[data-dockkit-add-tab]').click()
  await entry.getByRole('button', { name: /^新建终端|^New terminal/u }).click()
  const input = page.locator('.xterm-helper-textarea:visible')
  await expect.poll(() => page.locator('.xterm-rows:visible').innerText(), { timeout: 60_000, interval: 250 })
    .toMatch(/[>$#]\s*$/u)
  await input.focus()
  const output = join(host.workspaceCwd, 'service-closure.txt')
  // The resolved shell differs per platform and preference: quote the path the
  // way each accepts, and let the assertion ignore the trailing newline cmd adds.
  await input.pressSequentially(process.platform === 'win32'
    ? 'echo terminal-verified>"' + output + '"'
    : 'printf terminal-verified > \'' + output.replaceAll("'", "'\\''") + '\'', { delay: 5 })
  await input.press('Enter')
  await expect.poll(async () => (await readFile(output, 'utf8')).trim(), { timeout: 20_000 }).toBe('terminal-verified')
  expect(errors).toEqual([])
  await mkdir('reports', { recursive: true })
  await page.screenshot({ path: 'reports/service-activation.png' })
})
