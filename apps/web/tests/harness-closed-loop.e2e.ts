/** Keyless M3 composition: browser input, model tool call, shell result, and durable Session events. */
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { launchWebScaffold, readPersistedEvents } from './scaffold.ts'
import { requireBuilt } from './support.ts'

const { LlmAdapter, ToolCallId } = requireBuilt('@deepseek-ai/dsh-llm') as typeof import('@deepseek-ai/dsh-llm')
const PROVIDER = 'm3-closed-loop-test'
const MODEL = 'workspace-probe'
const REPLY = 'M3 workspace probe completed.'
const PROMPT = 'Read the current workspace directory, then report completion.'
const TOOL = process.platform === 'win32' ? 'pwsh' : 'bash'

/** Deterministic external-model replacement; the real loop executes the shell call. */
class WorkspaceAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override listModels(provider: string) {
    return Promise.resolve([{ provider, id: MODEL, name: 'M3 workspace probe' }])
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('m3-workspace-pwd'),
        name: TOOL, arguments: JSON.stringify({ command: 'pwd', description: 'Read current workspace' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.requests.length !== 2) throw new Error('Unexpected additional M3 model request')
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: REPLY }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: REPLY } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it('submits through the browser and feeds the executed shell result into the next model request', async () => {
  const host = await launchWebScaffold({ firstUse: true })
  onTestFinished(() => host.close())
  const adapter = new WorkspaceAdapter()
  host.ctx.effect(() => host.ctx.llm.registerAdapter([PROVIDER], adapter), 'M3 model adapter')
  await host.ctx.agentDefaultModel.saveSelection({ provider: PROVIDER, model: MODEL })
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ locale: 'zh-CN' })
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto(host.authenticatedUrl)
  await page.getByRole('button', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: /^新建?会话/ }).first().click()
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await input.waitFor()
  const settled = host.whenTurnSettled()
  await input.fill(PROMPT)
  await input.press('Enter')
  const sessionId = await settled
  const agent = host.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('M3 Session has no Agent')
  expect(adapter.requests).toHaveLength(2)
  const first = adapter.requests[0]
  const second = adapter.requests[1]
  if (first === undefined || second === undefined) throw new Error('M3 model requests missing')
  expect(first.tools?.some(tool => tool.name === TOOL)).toBe(true)
  expect(JSON.stringify(first.messages)).toContain(PROMPT)
  const toolMessage = second.messages.find(message => message.role === 'tool')
  expect(toolMessage).toBeDefined()
  expect(JSON.stringify(toolMessage)).toContain('m3-workspace-pwd')
  const events = agent.session.snapshotEvents()
  const result = events.find(event => event.type === 'tool/result' && event.data.message.source.callId === ToolCallId('m3-workspace-pwd'))
  if (result?.type !== 'tool/result') throw new Error('M3 durable tool result missing')
  expect(result.data.message.isError).toBe(false)
  const output = result.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  expect(output).toContain(host.workspaceCwd)
  expect(JSON.stringify(toolMessage)).toContain(host.workspaceCwd.replaceAll('\\', '\\\\'))
  expect(events.some(event => event.type === 'tool/call' && event.data.name === TOOL)).toBe(true)
  expect(events.some(event => event.type === 'turn/end')).toBe(true)
  expect(agent.session.requestHeader()).toBeDefined()
  const persisted = await readPersistedEvents(host, sessionId)
  expect(persisted.some(event => event.type === 'tool/result' && event.data.message.source.callId === ToolCallId('m3-workspace-pwd')
    && !event.data.message.isError)).toBe(true)
  expect(persisted.some(event => event.type === 'turn/end')).toBe(true)
  await page.getByText(REPLY, { exact: true }).waitFor()
  await expect.poll(() => input.getAttribute('contenteditable')).toBe('true')
  expect(pageErrors).toEqual([])
})
