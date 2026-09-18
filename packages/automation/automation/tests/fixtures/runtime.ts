/** Real Loader/AgentLoop composition; only external model and shell execution are test adapters. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader, { type ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets, { COMPOSITION_FILE } from '@deepseek-ai/dsh-agent-presets'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SessionStore, { type SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Approval from '@deepseek-ai/dsh-user-approval'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import AutomationRuntime, { type AutomationDraft, type AutomationId, type AutomationRun, type AutomationRunId } from '../../src/index.ts'
import * as Preset from './preset.ts'

/** One explicitly queued external response. */
export type ModelResponse = (options: GenerateOptions) => AsyncIterable<StreamChunk>

/** Scripted external adapter. Boot and create never enqueue a response implicitly. */
export class FixtureModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly responses: ModelResponse[] = []
  readonly unexpected: Error[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.responses.shift()
    if (response === undefined) {
      const error = new Error('Unexpected model call: no response explicitly queued')
      this.unexpected.push(error)
      throw error
    }
    yield* response(options)
  }
}

/** A shell adapter that makes accidental external process execution fail closed. */
class DisabledShell extends ShellExecutor {
  override get sandboxMode() { return 'read-only' as const }
  resolve(): never { throw new Error('Shell execution is not composed in automation integration tests') }
  run(): never { throw new Error('Shell execution is not composed in automation integration tests') }
  start(): never { throw new Error('Shell execution is not composed in automation integration tests') }
}

/** A deterministic completed model response. @param text - final answer. @returns scripted chunks. */
export async function* answer(text = 'Automation finished.'): AsyncIterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Caller-owned storage and optional additional Loader entries. */
export interface RuntimeFixtureOptions {
  home: string
  profile?: string
  model?: FixtureModel
  entries?: { name: string; config?: unknown }[]
  modules?: ReadonlyMap<string, unknown>
  clockCheckIntervalMs?: number
  maxStartLatenessMs?: number
}

/** Load production services from a real cordis.yml, without creating or running an automation.
 * @param options - caller must exclusively own DSH_HOME and await dispose before removing it.
 * @returns real context, external adapter, saved workspace, draft, and awaited teardown.
 */
export async function bootRuntimeFixture(options: RuntimeFixtureOptions) {
  const { home } = options
  if (resolve(resolveDshHome()) !== resolve(home)) throw new Error('Set DSH_HOME to the fixture home before boot')
  const profile = options.profile ?? 'automation-test'
  const model = options.model ?? new FixtureModel()
  const presetRoot = join(home, 'fixture-presets')
  const presetPath = new URL('./preset.ts', import.meta.url).href
  await mkdir(join(presetRoot, 'fixture'), { recursive: true })
  await mkdir(join(home, 'workspace'), { recursive: true })
  await writeFile(join(presetRoot, 'fixture', COMPOSITION_FILE), JSON.stringify([{ name: presetPath }]) + '\n')
  const modules = new Map<string, unknown>([
    ['fixture-identity', { apply(ctx: Context) { ctx.provide('dshProfileName', profile) } }],
    ['fixture-model', { inject: ['llm'], apply(ctx: Context) { ctx.llm.registerAdapter(['fixture'], model) } }],
    ['fixture-shell', DisabledShell],
    ['@deepseek-ai/dsh-storage', Storage],
    ['@deepseek-ai/dsh-storage-json', StorageJson],
    ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjections],
    ['@deepseek-ai/dsh-session-title', SessionTitle],
    ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', Tools],
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-agent-presets', AgentPresets],
    ['@deepseek-ai/dsh-user-approval', Approval],
    ['@deepseek-ai/dsh-permission-presets', PermissionPresets],
    ['@deepseek-ai/dsh-automation', AutomationRuntime],
    [presetPath, Preset],
    ...options.modules ?? [],
  ])
  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { name: 'fixture-identity' },
    { name: '@deepseek-ai/dsh-storage' },
    { name: '@deepseek-ai/dsh-storage-json', config: { root: join(home, 'domains') } },
    { name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json' } },
    { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
    { name: '@deepseek-ai/dsh-session' },
    { name: '@deepseek-ai/dsh-session-projection' },
    { name: '@deepseek-ai/dsh-session-title', config: { fallbackMaxWords: 8, fallbackMaxBytes: 100, maxTitleBytes: 200 } },
    { name: '@deepseek-ai/dsh-workspace' },
    { name: '@deepseek-ai/dsh-system-prompt' },
    { name: '@deepseek-ai/dsh-tools' },
    { name: '@deepseek-ai/dsh-llm' },
    { name: 'fixture-model' },
    { name: '@deepseek-ai/dsh-agent' },
    { name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } },
    { name: '@deepseek-ai/dsh-agent-presets', config: { default: 'fixture', roots: [{ path: presetRoot, trust: 'system' }], includeShippedRoot: false, includeUserRoot: false } },
    { name: 'fixture-shell' },
    { name: '@deepseek-ai/dsh-user-approval', config: { policy: 'ask' } },
    { name: '@deepseek-ai/dsh-permission-presets', config: {
      presets: { initial: { sandbox: 'read-only', approval: 'ask' }, unattended: { sandbox: 'workspace-write', approval: 'never' } },
      defaultPreset: 'initial',
    } },
    { name: '@deepseek-ai/dsh-automation', config: { profile, clockCheckIntervalMs: options.clockCheckIntervalMs ?? 60_000, maxStartLatenessMs: options.maxStartLatenessMs ?? 30_000 } },
    ...options.entries ?? [],
  ], null, 2) + '\n')
  const ctx = new Context()
  try {
    ctx.baseUrl = pathToFileURL(home).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = {
      version: 'v2',
      get loadCache(): never { throw new Error('Fixture imports do not expose the native module cache') },
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error('Unexpected fixture module: ' + specifier)
        return modules.get(specifier)
      },
      register() { throw new Error('Fixture imports do not register native loader hooks') },
      getOrCreateModuleJob() { return Promise.reject(new Error('Fixture imports do not create native module jobs')) },
      resolveSync() { throw new Error('Fixture imports do not resolve native module jobs') },
      load() { return Promise.reject(new Error('Fixture imports do not load native module sources')) },
    } satisfies ModuleLoaderV2
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    const unloaded = [...ctx.loader.entries()].filter(entry => entry.fiber === undefined && !entry.disabled)
    if (unloaded.length) throw new Error('Unloaded fixture entries: ' + unloaded.map(entry => entry.options.name).join(', '))
    if (ctx.automationRuntime.snapshot().status !== 'ready') throw new Error('Automation runtime did not become ready')
    const preset = await ctx.agentPresets.resolve('fixture')
    if (preset.broken !== undefined) throw new Error('Fixture preset is broken: ' + preset.broken)
    const workspace = await ctx.workspaceRegistry.create(join(home, 'workspace'))
    const draft: AutomationDraft = {
      title: 'Scheduled report', prompt: 'Summarize the local workspace without changes.', workspaceId: workspace.id,
      agentPresetId: 'fixture', model: { provider: 'fixture', model: 'deterministic' }, permissionPresetId: 'unattended',
      schedule: { kind: 'hourly', minute: 15 },
    }
    return { ctx, model, workspace, draft, dispose: () => ctx.fiber.dispose() }
  } catch (error: unknown) {
    await ctx.fiber.dispose()
    throw error
  }
}

/** Wait on committed publications, not polling or whole-Agent idle.
 * @param runtime - real runtime owning the journal.
 * @param id - definition identity.
 * @param runId - exact invocation identity.
 * @param predicate - expected durable state.
 * @returns the first matching journal row.
 */
export function waitForRun(
  runtime: AutomationRuntime,
  id: AutomationId,
  runId: AutomationRunId,
  predicate: (run: AutomationRun) => boolean,
): Promise<AutomationRun> {
  return new Promise((resolve, reject) => {
    const inspect = () => {
      try {
        const run = runtime.runs(id, null, 100).runs.find(item => item.id === runId)
        if (run !== undefined && predicate(run)) { dispose(); resolve(run) }
      } catch (error: unknown) {
        dispose()
        reject(error instanceof Error ? error : new Error('Run observation failed', { cause: error }))
      }
    }
    const dispose = runtime.subscribe(inspect)
    inspect()
  })
}

/** Select stable policy/turn evidence while preserving exact model-visible payloads.
 * @param events - persisted session events.
 * @returns evidence without generated identities or timestamps.
 */
export function policyEvidence(events: readonly SessionEvent[]) {
  return events.flatMap((event): unknown[] => {
    switch (event.type) {
      case 'permission/preset': case 'sandbox/mode': case 'approval/policy': case 'turn/start': case 'turn/end':
        return [{ type: event.type, data: event.data }]
      case 'user/message':
        return [{ type: event.type, data: { content: event.data.content, source: event.data.source } }]
      default: return []
    }
  })
}
