/** Model requests and durable skill results from the managed bundled provider. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { boot } from '@deepseek-ai/dsh-app-boot'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry, { escapeText, renderSkillContent } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as SecuritySkills from '../src/index.ts'
import SecuritySkillResources from '../src/resources.ts'

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const skill = ['cinlan-cyber-security', 'js-reverse'][this.requests.length - 1]
    if (skill !== undefined) {
      const id = ToolCallId('skill-' + String(this.requests.length))
      const args = JSON.stringify({ name: skill })
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'skill', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'skill', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    if (this.requests.length !== 3) throw new Error('Skill fixture script exhausted')
    const text = 'Loaded the security router and JavaScript reverse-engineering instructions.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function dispose(fiber: Fiber): Promise<void> {
  await fiber.dispose()
  while (fiber.inertia !== undefined) await fiber.inertia
}

function text(blocks: readonly ContentBlock[]): string {
  return blocks.filter(block => block.type === 'text').map(block => block.text).join('\n')
}

function results(messages: readonly Message[]): string[] {
  return messages.flatMap(message => message.content.filter(block => block.type === 'tool-result').map((block) => {
    expect(block.isError).not.toBe(true)
    return text(block.content)
  }))
}

it('publishes all managed skills and persists complete official skill results from a real Agent turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-managed-skill-model-'))
  let host: Context | undefined
  const reader = new Context()
  onTestFinished(async () => {
    try {
      if (host !== undefined) await dispose(host.fiber)
      await dispose(reader.fiber)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  const adapter = new ScriptedAdapter()
  const dependencies = {
    name: 'model-fixture-dependencies',
    async apply(ctx: Context) {
      await mountAgentLoopTestDependencies(ctx)
    },
  }
  const persistence = join(root, 'sessions')
  const configFile = join(root, 'cordis.yml')
  const rows = [
    { id: 'dependencies', name: 'cordis:model-dependencies' },
    { id: 'persistence', name: 'cordis:model-persistence', config: { root: persistence, compression: 'none' } },
    { id: 'loop', name: 'cordis:model-loop', config: { agents: [] } },
    { id: 'skills', name: 'cordis:model-skills' },
    { id: 'resources', name: 'cordis:model-resources', config: { root: join(root, 'resources') } },
    { id: 'provider', name: 'cordis:model-provider' },
    { id: 'tool', name: 'cordis:model-tool' },
  ]
  await writeFile(configFile, rows.map(row => '- ' + JSON.stringify(row)).join('\n') + '\n')
  host = await boot('managed-skill-model-test', configFile, [], (ctx) => {
    host = ctx
    Object.assign(ctx.loader.builtins, {
      'model-dependencies': dependencies, 'model-persistence': JsonlSessionPersistence,
      'model-loop': AgentLoop, 'model-skills': SkillRegistry,
      'model-resources': SecuritySkillResources, 'model-provider': SecuritySkills, 'model-tool': ToolSkill,
    })
  })
  const ctx = host
  ctx.llm.registerAdapter(['fixture'], adapter)
  await ctx.securitySkillResources.installBundled()
  await vi.waitFor(async () => {
    const status = await ctx.securitySkillResources.status()
    expect(status.operation).toBeUndefined()
    expect(status.installed?.skillCount).toBe(22)
    expect(status.lastError).toBeUndefined()
    expect(await ctx.skills.list()).toHaveLength(22)
  }, { timeout: 30_000 })
  const id = SessionId('managed-security-skills')
  const agent = await ctx.agentLoop.create(id, { provider: 'fixture', model: 'fixture' }, { cwd: root })
  const idle = new Promise<void>((resolve) => {
    const unlisten = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { unlisten(); resolve() }
    })
  })
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Load the bundled security router and then the JavaScript reverse-engineering skill.' }],
    source: { kind: 'user' },
  }))
  await idle
  expect(adapter.requests).toHaveLength(3)
  const first = adapter.requests[0]!
  expect(first.tools?.map(tool => tool.name)).toContain('skill')
  const catalog = first.messages.find(message => message.source.kind === 'skill-catalog')
  if (catalog?.source.kind !== 'skill-catalog') throw new Error('First model request lacks the official skill catalog')
  const catalogNames = catalog.source.entries.map(entry => entry.name)
  expect(catalogNames).toHaveLength(22)
  expect(catalogNames).toContain('cinlan-cyber-security')
  expect(catalogNames).toContain('js-reverse')
  expect(catalogNames).not.toContain('orca-cli')
  const catalogText = text(catalog.content)
  expect(catalogText).toContain('<available_skills>')
  for (const name of catalogNames) expect(catalogText).toContain(name)
  const rendered = results(adapter.requests[2]!.messages)
  expect(rendered).toHaveLength(2)
  expect(results(adapter.requests[1]!.messages)).toEqual([rendered[0]])
  const bodies = rendered.map((value) => {
    const body = /<skill_instructions>\n([\s\S]*)\n<\/skill_instructions>/.exec(value)?.[1]
    if (body === undefined) throw new Error('Official skill result lacks instructions')
    return body
  })
  const portableResults: string[] = []
  for (const [index, name] of ['cinlan-cyber-security', 'js-reverse'].entries()) {
    const skill = await ctx.skills.get(name)
    if (skill?.resourceBase?.kind !== 'directory') throw new Error('Managed skill lacks a directory')
    expect(rendered[index]).toBe(renderSkillContent(skill))
    expect(bodies[index]).toBe(skill.content)
    portableResults.push(rendered[index]!.replace(escapeText(skill.resourceBase.path), '<SKILL_BASE:' + name + '>'))
  }
  expect(bodies[0]).toContain('22 个 skill 入口')
  expect(bodies[0]).toContain('资源安装不执行附带脚本')
  expect(bodies[1]).toContain('## Harness MCP 配置')
  expect(bodies.join('\n')).not.toMatch(/orca\s+mcp|Orca CLI/iu)
  const events = agent.session.snapshotEvents()
  const toolCalls = events.filter(event => event.type === 'tool/call').map(event => ({
    name: event.data.name, arguments: event.data.arguments,
  }))
  expect(toolCalls).toEqual([
    { name: 'skill', arguments: JSON.stringify({ name: 'cinlan-cyber-security' }) },
    { name: 'skill', arguments: JSON.stringify({ name: 'js-reverse' }) },
  ])
  const logged = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
  expect(results(logged)).toEqual(rendered)
  const final = events.filter(event => event.type === 'assistant/message').at(-1)
  if (final === undefined) throw new Error('Agent did not complete its final message')
  const finalMessage = text(final.data.message.content)
  await dispose(ctx.fiber)
  host = undefined
  await reader.plugin(JsonlSessionPersistence, { root: persistence, compression: 'none' })
  const handle = await reader.sessionPersistence.open(id, 'read')
  let reopenedBodies: string[]
  try {
    const reopened = (await handle.read()).events
    const durableResults = results(reopened.filter(event => event.type === 'tool/result').map(event => event.data.message))
    expect(durableResults).toEqual(rendered)
    reopenedBodies = durableResults.map((value) => {
      const body = /<skill_instructions>\n([\s\S]*)\n<\/skill_instructions>/.exec(value)?.[1]
      if (body === undefined) throw new Error('Reopened skill result lacks instructions')
      return body
    })
    expect(reopenedBodies).toEqual(bodies)
  } finally {
    await handle.close()
  }
  await expect(JSON.stringify({
    catalog: { count: catalogNames.length, names: catalogNames },
    rootSkillBody: bodies[0], jsReverseBody: bodies[1], renderedResults: portableResults,
    toolCalls, finalMessage, reopenedBodies,
  }, null, 2) + '\n').toMatchFileSnapshot('./expected/managed-security-skills.json')
})
