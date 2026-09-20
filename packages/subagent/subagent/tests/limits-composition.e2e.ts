/** Real Loader composition for persisted delegation limits and the model-facing tool. */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as tool from '@deepseek-ai/dsh-tool-subagent'
import SubagentRuntime from '../src/index.ts'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

class GatedAdapter extends LlmAdapter {
  readonly release = Promise.withResolvers<undefined>()
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.release.promise
    yield* textResponse('child completed')
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length > 0) throw new AggregateError(errors, 'composition cleanup failed')
})

async function boot(options: { stored?: string; explicitDepth?: number; withSettings?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-subagent-limits-'))
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const settingsPath = join(root, 'settings.yml')
  await writeFile(settingsPath, options.stored ?? '{}\n')
  const configPath = join(root, 'cordis.yml')
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-subagent', SubagentRuntime],
    ['@deepseek-ai/dsh-subagent-spawn-in-process', spawn],
  ])
  await writeFile(configPath, [
    ...[...modules.keys()].map(name => "- name: '" + name + "'"),
    "- name: '@deepseek-ai/dsh-session-persistence-jsonl'",
    '  config:',
    '    root: ' + JSON.stringify(join(root, 'sessions')),
    ...options.withSettings === false ? [] : [
      "- name: '@deepseek-ai/dsh-settings-file'",
      '  config:',
      '    path: ' + JSON.stringify(settingsPath),
    ],
    "- name: '@deepseek-ai/dsh-tool-subagent'",
    '  config:',
    '    provider: spawn',
    '    backgroundMode: continuable',
    ...options.explicitDepth === undefined ? [] : ['    maxDepth: ' + String(options.explicitDepth)],
    '',
  ].join('\n'))
  modules.set('@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence)
  modules.set('@deepseek-ai/dsh-settings-file', FileSettingsProvider)
  modules.set('@deepseek-ai/dsh-tool-subagent', tool)
  const ctx = new Context()
  const adapter = new GatedAdapter()
  cleanups.push(async () => { adapter.release.resolve(undefined); await ctx.fiber.dispose() })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('unexpected Loader import: ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  ctx.on('agent/pre-step', async ({ agent }, next) => agent === parent ? { kind: 'reject' } : next())
  // Child handles must settle while their projection and persistence services are still live.
  cleanups.push(async () => {
    const drained = ctx.subagents.drainContinuableDescendants([parent])
    adapter.release.resolve(undefined)
    await drained
    await parent.whenIdle()
  })
  let calls = 0
  const delegate = (agent: Agent = parent) => ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('delegation-' + String(++calls)),
    name: 'subagent',
    arguments: { description: 'task', prompt: 'work' },
    agent,
  })
  return { ctx, parent, delegate, adapter, settingsPath }
}

describe('subagent limits through cordis.yml and file settings', () => {
  it('preserves default depth three without a settings provider', async () => {
    const { ctx, delegate } = await boot({ withSettings: false })
    expect(ctx.subagents.resolveMaxDepth()).toBe(3)
    expect(ctx.get('settings')).toBeUndefined()
    expect(await delegate()).not.toHaveProperty('isError', true)
    const child = ctx.agents.list().find(agent => agent.session.header.origin === 'subagent')!
    expect(child.session.header.parentSession).toBe(SessionId('parent'))
    expect(await delegate(child)).not.toHaveProperty('isError', true)
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toHaveLength(2)
  })

  it('reads explicit user limits, applies live edits and persists reset without losing other preferences', async () => {
    const stored = 'subagent:\n  maxDepth: 1\n  maxActiveSubagents: 1\nother-plugin:\n  enabled: true\n'
    const { ctx, delegate, settingsPath } = await boot({ stored })
    await vi.waitFor(() => { expect(ctx.subagents.resolveMaxDepth()).toBe(1) })
    expect(await delegate()).not.toHaveProperty('isError', true)
    const child = ctx.agents.list().find(agent => agent.session.header.origin === 'subagent')!
    const nested = await delegate(child)
    expect(JSON.stringify(nested)).toContain('subagent depth 2 exceeds maxDepth 1')
    const refused = await delegate()
    expect(JSON.stringify(refused)).toContain('subagent limit reached (active child limit: 1)')
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toHaveLength(1)
    await ctx.settings.update('subagent', { maxActiveSubagents: 2 })
    await delegate()
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toHaveLength(2)
    await ctx.settings.replace('subagent', {})
    expect(ctx.subagents.resolveMaxDepth()).toBe(3)
    const persisted = await readFile(settingsPath, 'utf8')
    expect(persisted).toContain('other-plugin:')
    expect(persisted).toContain('enabled: true')
    expect(persisted).not.toContain('maxDepth: 1')
  })

  it('keeps an explicit tool depth above the saved default', async () => {
    const { ctx, delegate } = await boot({ stored: 'subagent:\n  maxDepth: 1\n', explicitDepth: 2 })
    await vi.waitFor(() => { expect(ctx.subagents.resolveMaxDepth()).toBe(1) })
    expect(await delegate()).not.toHaveProperty('isError', true)
    const child = ctx.agents.list().find(agent => agent.session.header.origin === 'subagent')!
    expect(await delegate(child)).not.toHaveProperty('isError', true)
    expect(ctx.agents.list().filter(agent => agent.session.header.origin === 'subagent')).toHaveLength(2)
  })
})
