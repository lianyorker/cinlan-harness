/** Git AI owner behavior through a real Loader composition with a stub subagent seam. */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import ExecutionBindings from '@cinlan/execution-binding'
import * as gitSettings from '@cinlan/git-settings'
import { GIT_SETTINGS_NAMESPACE, GitSourceControlSettingsSchema } from '@cinlan/git-settings/settings-schema'
import type { GitSourceControlSettings } from '@cinlan/git-settings/types'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import type { SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import SidebarGit from '@cinlan/sidebar-git'
import GitAiAuthor from '../src/index.ts'

const exec = promisify(execFile)

/** Local bindings without SSH target management, matching the sidebar-git fixture. */
class LocalBindings extends ExecutionBindings { static override inject = ['sessionQuery', 'sessionProjections'] }

/** Stub agents registry: the owner reads the authorizing parent Agent here. */
class StubAgents extends Service {
  static inject: readonly string[] = []
  constructor(ctx: Context) { super(ctx, 'agents') }
  /** @param id - session id whose live agent authorizes generation. */
  get(id: SessionId): { readonly id: SessionId } | undefined { return { id } }
}

/** One recorded activation from the stub subagent seam. */
interface RecordedActivation {
  readonly prompt: string
  readonly preset: string | undefined
  readonly agentOptions: unknown
  readonly delivery: string
  disposed: boolean
}

const contexts: Context[] = []
const roots: string[] = []
const runGit = async (repository: string, ...args: string[]): Promise<string> => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')))
  const result = await exec('git', ['-C', repository, ...args], {
    env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
  })
  return result.stdout
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

/** Boot the real settings, Session, subprocess, sidebar Git, and Git AI owners with a stub subagent seam. */
async function harness(
  preferences: Partial<GitSourceControlSettings> = {},
  model: (prompt: string) => string | Promise<string> = () => 'review draft',
  options: { readonly config?: Record<string, unknown>; readonly stubGit?: boolean } = {},
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-git-ai-')))
  roots.push(root)
  const repository = join(root, 'repository')
  await mkdir(repository)
  await runGit(repository, 'init', '--template=')
  await runGit(repository, 'symbolic-ref', 'HEAD', 'refs/heads/main')
  await runGit(repository, 'config', 'user.name', 'Git AI Test')
  await runGit(repository, 'config', 'user.email', 'gitai@example.invalid')
  await runGit(repository, 'config', 'commit.gpgSign', 'false')
  await writeFile(join(repository, 'tracked.txt'), 'base\n')
  await runGit(repository, 'add', '--all')
  await runGit(repository, 'commit', '--quiet', '-m', 'base')
  await writeFile(join(repository, 'feature.txt'), 'a change\n')
  await runGit(repository, 'add', 'feature.txt')

  let currentPreferences: GitSourceControlSettings = { ...GitSourceControlSettingsSchema(), ...preferences }
  const mockSettings = {
    name: 'test-settings',
    apply(c: Context) {
      c.provide('settings', {
        describe() {
          return [{ ns: GIT_SETTINGS_NAMESPACE, value: GitSourceControlSettingsSchema(currentPreferences) }]
        },
        async update(ns: string, patch: Partial<GitSourceControlSettings>) {
          if (ns === GIT_SETTINGS_NAMESPACE) currentPreferences = { ...currentPreferences, ...patch }
        },
      } as never)
    },
  }

  const activations: RecordedActivation[] = []
  const modelRunner: (prompt: string) => string | Promise<string> = model
  class StubSubagents extends Service {
    static inject = ['agents'] as const
    constructor(ctx: Context) { super(ctx, 'subagents') }
    startActivation(spec: { readonly provider: string; readonly label: string; readonly delivery: string; readonly signal: AbortSignal
      readonly request: { readonly parent: { readonly id: unknown }; readonly agentPreset?: string; readonly agentOptions?: unknown
        readonly prompt: readonly { readonly type: string; readonly text?: string }[] } }): Promise<{
      childId: SessionId; result: Promise<{ stopReason: string; diagnostic?: string; output: readonly { type: string; text?: string }[] }>; dispose(): Promise<void>
    }> {
      const prompt = spec.request.prompt.map(block => block.text ?? '').join('')
      activations.push({
        prompt,
        preset: spec.request.agentPreset,
        agentOptions: spec.request.agentOptions,
        delivery: spec.delivery,
        disposed: false,
      })
      // result 由 modelRunner 异步填充，startActivation 立即返回，与真实 seam 的发布时机一致
      return Promise.resolve({
        childId: SessionId(`child-${activations.length}`),
        result: Promise.resolve(modelRunner(prompt)).then(text => ({ stopReason: 'completed', output: [{ type: 'text', text }] })),
        async dispose() {
          const entry = activations.find(item => item.prompt === prompt && !item.disposed)
          if (entry !== undefined) entry.disposed = true
        },
      })
    }
  }

  const globalConfig = join(root, 'gitconfig')
  await writeFile(globalConfig, '')
  class HermeticSubprocess extends LocalSubprocessRuntime {
    constructor(ctx: Context) { super(ctx) }
    override spawn(spec: SubprocessSpawnSpec) {
      return super.spawn({ ...spec, env: { ...spec.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: globalConfig } })
    }
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'sessions', name: '@deepseek-ai/dsh-session' },
    { id: 'query', name: 'session-query', config: { path: ':memory:', openAt: 'never' } },
    { id: 'projections', name: 'session-projections' },
    { id: 'bindings', name: 'execution-bindings' },
    { id: 'settings', name: 'test-settings' },
    { id: 'git-settings', name: '@cinlan/git-settings' },
    { id: 'subprocess', name: 'test-subprocess' },
    { id: 'sidebar-git', name: '@cinlan/sidebar-git' },
    { id: 'subagents', name: 'test-subagents' },
    { id: 'agents', name: 'test-agents' },
    { id: 'git-ai', name: '@cinlan/git-ai-author', config: options.config ?? {} },
  ]))
  const modules = new Map<string, unknown>([
    ['session-query', SessionQuery], ['session-projections', SessionProjectionRegistry],
    ['execution-bindings', LocalBindings], ['@deepseek-ai/dsh-session', SessionStore],
    ['test-settings', mockSettings], ['@cinlan/git-settings', gitSettings], ['test-subprocess', HermeticSubprocess],
    ['@cinlan/sidebar-git', SidebarGit], ['test-subagents', StubSubagents], ['test-agents', StubAgents], ['@cinlan/git-ai-author', GitAiAuthor],
  ])
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  if (options.stubGit === true) {
    // 固定 Git 读结果的 stub：并发/去重用例只测 owner 语义，不跑真实子进程
    class StubSidebarGit extends Service {
      static inject: readonly string[] = []
      constructor(c: Context) { super(c, 'sidebarGit') }
      /** @param request - Session-owned Git request. */
      async status() {
        return { isRepo: true, entries: [], groupOrder: 'changes-first' as const,
          repository: { root: repository, gitDirectory: join(repository, '.git'), sessionCwd: repository,
            head: 'h0', branch: 'main', indexFingerprint: 'f' } }
      }
      /** @param request - Session, optional path, and staged selection. */
      async diff() { return { diff: 'diff --git a/tracked.txt b/tracked.txt\n+x' } }
      /** @param request - attached Session identity. */
      async compare() {
        return { status: 'ready' as const, repositoryRoot: repository, baseRef: 'main', baseHead: 'b', head: 'h0', usedFallback: false, diff: 'diff --git a/tracked.txt b/tracked.txt\n+x' }
      }
    }
    modules.set('@cinlan/sidebar-git', StubSidebarGit)
  }
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = { version: 'v2', async import(specifier: string) {
    if (!modules.has(specifier)) throw new Error('Unexpected fixture module: ' + specifier)
    return modules.get(specifier)
  } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const session = ctx.sessions.prepare(SessionId('git-ai-fixture'), { meta: { cwd: repository } })
  const detach = ctx.sessions.enter(session)
  ctx.effect(() => detach)
  ctx.sessions.announce(session)
  return {
    ctx, repository, session, owner: ctx.gitAi, activations, preferences: () => currentPreferences,
    /** 当前已发布的 stub activation 数；首个生成真正运行到 model 调用时为 1。 */
    publishedActivations: () => activations.filter(a => !a.disposed).length + activations.filter(a => a.disposed).length,
  }
}

describe('Git AI owner through real Loader composition', { timeout: 90_000 }, () => {
  it('generates a staged diff review through the fresh no-tool child', async () => {
    const h = await harness()
    const draft = await h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    expect(draft.text).toBe('review draft')
    expect(draft.childSessionId).toMatch(/^child-/)
    expect(draft.repository.branch).toBe('main')
    expect(h.activations).toHaveLength(1)
    expect(h.activations[0]?.delivery).toBe('caller')
    expect(h.activations[0]?.preset).toBe('git-ai-draft')
    expect(h.activations[0]?.prompt).toContain('a change')
  })

  it('rejects pr-description outside the committed comparison selection', async () => {
    const h = await harness()
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'pr-description', selection: 'staged' }))
      .rejects.toMatchObject({ name: 'GitAiError', code: 'invalid-request' })
    expect(h.activations).toHaveLength(0)
  })

  it('refuses generation when the AI toggle or the recipe is disabled', async () => {
    const h = await harness({ sourceControlAi: { ...GitSourceControlSettingsSchema().sourceControlAi!, enabled: false } })
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'ai-disabled' })
    const h2 = await harness({ sourceControlAi: {
      ...GitSourceControlSettingsSchema().sourceControlAi!,
      recipes: { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes,
        'diff-review': { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes['diff-review'], enabled: false } },
    } })
    await expect(h2.owner.generate({ sessionId: h2.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'recipe-disabled' })
    expect(h2.activations).toHaveLength(0)
  })

  it('filters sensitive files out of the model input and reports them', async () => {
    const prompts: string[] = []
    const h = await harness({}, (prompt: string) => { prompts.push(prompt); return 'ok' })
    await writeFile(join(h.repository, '.env'), 'SECRET=1\n')
    await runGit(h.repository, 'add', '.env')
    const draft = await h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    expect(draft.omittedFiles).toContain('.env')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).not.toContain('SECRET=')
  })

  it('reports empty and all-filtered change sets without calling the model', async () => {
    const h = await harness()
    await runGit(h.repository, 'reset')
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'empty-diff' })
    expect(h.activations).toHaveLength(0)
  })

  it('reports an unavailable comparison instead of substituting a staged diff', async () => {
    const h = await harness()
    await runGit(h.repository, 'commit', '--quiet', '-m', 'feature')
    // comparison 需要一个与默认分支分叉的 head：建 feature 分支后再提交一笔
    await runGit(h.repository, 'checkout', '--quiet', '-b', 'feature-branch')
    await writeFile(join(h.repository, 'feature.txt'), 'a change\nmore\n')
    await runGit(h.repository, 'add', 'feature.txt')
    await runGit(h.repository, 'commit', '--quiet', '-m', 'diverge')
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'comparison' }))
      .resolves.toMatchObject({ selection: 'comparison' })
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'pr-description', selection: 'comparison' }))
      .resolves.toMatchObject({ action: 'pr-description' })
    expect(h.activations).toHaveLength(2)
    expect(h.activations[1]?.prompt).not.toContain('staged')
  })

  it('rejects a non-empty agentArgs recipe instead of silently ignoring it', async () => {
    const h = await harness({ sourceControlAi: {
      ...GitSourceControlSettingsSchema().sourceControlAi!,
      recipes: { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes,
        'diff-review': { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes['diff-review'], agentArgs: '--fast' } },
    } })
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'invalid-request' })
    expect(h.activations).toHaveLength(0)
  })

  it('translates a provider/model override into child agent options', async () => {
    const h = await harness({ sourceControlAi: {
      ...GitSourceControlSettingsSchema().sourceControlAi!,
      recipes: { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes,
        'diff-review': { ...GitSourceControlSettingsSchema().sourceControlAi!.recipes['diff-review'], modelOverride: 'deepseek/chat' } },
    } })
    await h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    expect(h.activations[0]?.agentOptions).toEqual({ provider: 'deepseek', model: 'chat' })
  })

  it('enforces the configured concurrency limit', async () => {
    // 挂起 model + stub Git 读：第一个请求发布 activation 后仍占用 running 额度，
    // 第二个同 Session 不同 selection 的请求必须收到 busy。
    let calls = 0
    const h = await harness({}, () => { calls += 1; return new Promise<string>(() => {}) },
      { stubGit: true, config: { maxConcurrent: 1 } })
    const first = h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    await vi.waitFor(() => { if (h.publishedActivations() !== 1) throw new Error('not running') }, { timeout: 10_000 })
    let code: string | undefined
    const second = h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'worktree' })
    second.then(() => { code = 'resolved' }, (error) => { code = (error as { code?: string }).code })
    await vi.waitFor(() => { if (code === undefined) throw new Error('no settle') }, { timeout: 5_000 })
    expect(code).toBe('busy')
    expect(calls).toBe(1)
    // first 永不落定（挂起 model）；清理交给 afterEach 的 fiber dispose。
    void first
  }, 30_000)

  it('deduplicates one in-flight generation for the same key', async () => {
    const h = await harness({}, () => new Promise<string>((resolve) => { setTimeout(() => resolve('shared draft'), 30) }))
    const a = h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    const b = h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    expect(await a).toBe(await b)
    expect(h.activations).toHaveLength(1)
  })

  it('marks the child disposed after settlement and surfaces a failed model run', async () => {
    const h = await harness({}, () => { throw new Error('model exploded') })
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'model-failed' })
  })

  it('maps caller cancellation to the cancelled code', async () => {
    const h = await harness()
    const cancelled = new AbortController()
    cancelled.abort(new Error('user cancelled'))
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }, cancelled.signal))
      .rejects.toMatchObject({ code: 'cancelled' })
  })

  it('enforces the configured generation timeout', async () => {
    const h = await harness({}, () => new Promise<string>(() => {}), { config: { timeoutMs: 20 } })
    await expect(h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'timeout' })
  }, 20_000)

  it('reports a session outside a repository', async () => {
    const h = await harness()
    const outside = await mkdtemp(join(tmpdir(), 'dsh-git-ai-outside-'))
    roots.push(outside)
    const session = h.ctx.sessions.prepare(SessionId('outside'), { meta: { cwd: outside } })
    const detach = h.ctx.sessions.enter(session)
    h.ctx.effect(() => detach)
    h.ctx.sessions.announce(session)
    await expect(h.owner.generate({ sessionId: session.id, action: 'diff-review', selection: 'staged' }))
      .rejects.toMatchObject({ code: 'not-repository' })
  })

  it('bounds the complete emitted prompt under the configured budget', async () => {
    const seen: string[] = []
    const h = await harness({}, (prompt) => { seen.push(prompt); return 'ok' }, { config: { maxPromptBytes: 2048 } })
    await writeFile(join(h.repository, 'large.txt'), `${'x'.repeat(2048)}\n`)
    await runGit(h.repository, 'add', 'large.txt')
    await h.owner.generate({ sessionId: h.session.id, action: 'diff-review', selection: 'staged' })
    expect(Buffer.byteLength(seen[0] ?? '', 'utf8')).toBeLessThanOrEqual(2048)
  })
})
