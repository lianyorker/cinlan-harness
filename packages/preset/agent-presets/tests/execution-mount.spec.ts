/** Loader admission of execution-scoped consumers without Host provider fallback. */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentPresets, { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
import { afterEach, expect, it } from 'vitest'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fixtureExecution: { read(): string }
  }
}

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function boot(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-execution-preset-'))
  roots.push(root)
  await mkdir(join(root, 'coding'))
  await mkdir(join(root, 'broken'))
  const rows = [
    '- id: bash', '  name: cordis:execution-consumer',
    '  disabled: !!js >-', "    ('executionPlatform' in ctx ? ctx.executionPlatform : process.platform) === 'win32'",
    '  config:', '    tool: bash',
    '- id: pwsh', '  name: cordis:execution-consumer',
    '  disabled: !!js >-', "    ('executionPlatform' in ctx ? ctx.executionPlatform : process.platform) !== 'win32'",
    '  config:', '    tool: pwsh', '',
  ].join('\n')
  await writeFile(join(root, 'coding', 'agent.cordis.yml'), rows)
  await writeFile(join(root, 'broken', 'agent.cordis.yml'), rows + '- id: failure\n  name: cordis:throws\n')
  const config = join(root, 'cordis.yml')
  await writeFile(config, [
    '- name: cordis:llm', '- name: cordis:sessions', '- name: cordis:projections',
    '- name: cordis:prompt', '- name: cordis:tools', '- name: cordis:agents',
    '- name: cordis:loop', '  config:', '    agents: []',
    '- name: cordis:presets', '  config:', '    default: coding',
    '    includeShippedRoot: false', '    includeUserRoot: false',
    '    roots:', '      - path: ' + JSON.stringify(root), '        trust: system', '',
  ].join('\n'))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  Object.assign(ctx.loader.builtins, {
    include: Include, llm: LlmRuntime, sessions: SessionStore,
    projections: SessionProjectionRegistry, prompt: SystemPrompt,
    tools: ToolRuntime, agents: AgentRegistry, loop: AgentLoop, presets: AgentPresets,
    throws: { apply: () => { throw new Error('fixture mount failure') } },
    'execution-consumer': {
      inject: ['tools', 'fixtureExecution'],
      apply: (consumer: Context, options: { tool: string }) => {
        const execution = consumer.fixtureExecution
        consumer.effect(() => consumer.tools.register({
          name: options.tool,
          description: 'Read the selected execution provider',
          parameters: { type: 'object', properties: {} },
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value as string }] },
          execute: async () => execution.read(),
        }))
      },
    },
  })
  ctx.provide('fixtureExecution', { read: () => 'host' })
  await ctx.plugin(Include, { path: pathToFileURL(config).href })
  return ctx
}

async function readTool(ctx: Context, agent: Agent, name: string) {
  return ctx.tools.execute({ callId: ToolCallId('execution-read'), name, arguments: {}, agent, signal: new AbortController().signal })
}

it('keeps remote provider capture and Linux shell selection across children and rejects recompose', async () => {
  const ctx = await boot()
  let available = true
  const handle = await ctx.agents.create({
    sessionId: SessionId('remote-preset'),
    setup: async (agentCtx) => {
      const isolated = Object.create(agentCtx[Context.isolate]) as Record<string, symbol>
      isolated.fixtureExecution = Symbol('remote fixture')
      const executionCtx = agentCtx.extend({ [Context.isolate]: isolated })
      executionCtx.provide('fixtureExecution', { read: () => {
        if (!available) throw new Error('remote execution lost')
        return 'remote'
      } })
      await ctx.agentPresets.mountInExecution(agentCtx, 'coding', executionCtx, 'linux')
    },
  })
  const remote = handle.agent
  expect(ctx.tools.schemas(remote).map(tool => tool.name)).toEqual(['bash'])
  expect(await readTool(ctx, remote, 'bash')).toMatchObject({ value: 'remote' })
  const child = await ctx.agents.create({
    sessionId: SessionId('remote-child'), parentAgent: remote,
    setup: (agentCtx) => { ctx.agentPresets.composeFrom(agentCtx, remote.ctx) },
  })
  expect(await readTool(ctx, child.agent, 'bash')).toMatchObject({ value: 'remote' })
  await expect(ctx.agentPresets.recompose(remote.ctx, 'coding')).rejects.toThrow('remote execution')
  await expect(ctx.agentPresets.recompose(child.agent.ctx, 'coding')).rejects.toThrow('remote execution')
  available = false
  expect(await readTool(ctx, remote, 'bash')).toMatchObject({ isError: true })
  expect(await readTool(ctx, child.agent, 'bash')).toMatchObject({ isError: true })
  await child.dispose()
  await handle.dispose()
  expect(livePresetMounts().filter(mount => mount.presetId === 'coding')).toEqual([])
  const local = await ctx.agents.create({
    sessionId: SessionId('local-preset'),
    setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, 'coding') },
  })
  const localShell = process.platform === 'win32' ? 'pwsh' : 'bash'
  expect(await readTool(ctx, local.agent, localShell)).toMatchObject({ value: 'host' })
})

it('rolls back failed execution composition before publishing the Agent or tools', async () => {
  const ctx = await boot()
  await expect(ctx.agents.create({
    sessionId: SessionId('rejected-execution'),
    setup: async (agentCtx) => { await ctx.agentPresets.mountInExecution(agentCtx, 'broken', agentCtx, 'linux') },
  })).rejects.toThrow('fixture mount failure')
  expect(ctx.agents.get(SessionId('rejected-execution'))).toBeUndefined()
  expect(ctx.sessions.get(SessionId('rejected-execution'))).toBeUndefined()
  expect(ctx.tools.schemas()).toEqual([])
  expect(livePresetMounts().filter(mount => mount.presetId === 'broken')).toEqual([])
})
