import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { describe, expect, it } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import GitRuntime, { GitError, GitRepositoryId } from '@deepseek-ai/dsh-git'
import type {
  GitDiff,
  GitDiffRequest,
  GitLogEntry,
  GitLogRequest,
  GitRepository,
  GitResolveRequest,
  GitStatus,
} from '@deepseek-ai/dsh-git'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolGit from '../src/index.ts'

const testToolSignal = new AbortController().signal
let agentCounter = 0

function callingAgent(cwd: string | null = '/workspace'): Agent {
  const id = SessionId(`git-agent-${++agentCounter}`)
  const session = Session.create(id, [], {
    version: 3,
    id,
    createdAt: 0,
    isSeeded: false,
    ...cwd === null ? {} : { cwd },
  })
  return { id, session } as unknown as Agent
}

const repository: GitRepository = {
  id: GitRepositoryId('repo-1'),
  root: '/repo',
  head: 'a'.repeat(40),
}

class StubGitRuntime extends GitRuntime {
  readonly resolutions: GitResolveRequest[] = []
  readonly statuses: Array<{ repository: GitRepository; signal?: AbortSignal }> = []
  readonly diffs: GitDiffRequest[] = []
  readonly logs: GitLogRequest[] = []
  statusResult: GitStatus = {
    branch: 'main',
    ahead: 2,
    behind: 1,
    staged: 3,
    unstaged: 4,
    untracked: 5,
    conflicted: 6,
    clean: false,
  }
  diffResult: GitDiff = { text: 'diff --git a/a.ts b/a.ts\n', truncated: true }
  logResult: readonly GitLogEntry[] = [{
    hash: 'b'.repeat(40),
    authorName: 'A\tB',
    committedAt: '2026-08-16T00:00:00Z',
    subject: 'subject\twith separator',
  }]
  failure: Error | undefined

  async resolveRepository(request: GitResolveRequest): Promise<GitRepository> {
    this.resolutions.push(request)
    if (this.failure !== undefined) throw this.failure
    return repository
  }

  async status(value: GitRepository, signal?: AbortSignal): Promise<GitStatus> {
    this.statuses.push({ repository: value, ...signal === undefined ? {} : { signal } })
    return this.statusResult
  }

  async diff(request: GitDiffRequest): Promise<GitDiff> {
    this.diffs.push(request)
    return this.diffResult
  }

  async log(request: GitLogRequest): Promise<readonly GitLogEntry[]> {
    this.logs.push(request)
    return this.logResult
  }
}

async function setup(): Promise<{ ctx: Context; git: StubGitRuntime; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(StubGitRuntime)
  await ctx.plugin(ToolGit)
  const agent = callingAgent()
  ctx.agents.register(agent)
  return { ctx, git: ctx.git as StubGitRuntime, agent }
}

function execute(ctx: Context, name: string, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`call-${name}`),
    name,
    arguments: args,
    ...agent === undefined ? {} : { agent },
  })
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('dsh-tool-git', () => {
  it('registers the three read-only tools with operation-specific schemas', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'git_status',
      'git_diff',
      'git_log',
    ])
    const schemas = new Map(ctx.tools.schemas().map(schema => [schema.name, schema]))
    expect(Object.keys((schemas.get('git_status')!.parameters as { properties: object }).properties)).toEqual([])
    expect(Object.keys((schemas.get('git_diff')!.parameters as { properties: object }).properties)).toEqual(['max_bytes'])
    expect(Object.keys((schemas.get('git_log')!.parameters as { properties: object }).properties)).toEqual(['limit'])
  })

  it('resolves the repository and returns structured status with the same signal', async () => {
    const { ctx, git, agent } = await setup()
    const result = await execute(ctx, 'git_status', {}, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected git_status success')
    expect(result.value).toEqual({
      repository: { root: '/repo', head: 'a'.repeat(40) },
      status: git.statusResult,
    })
    expect(git.resolutions).toEqual([{ path: '/workspace', signal: testToolSignal }])
    expect(git.statuses).toEqual([{ repository, signal: testToolSignal }])
    expect(text(result)).toContain('Changes: staged=3, unstaged=4, untracked=5, conflicted=6')

    git.statusResult = { ...git.statusResult, clean: true }
    const clean = await execute(ctx, 'git_status', {}, agent)
    expect(text(clean)).toContain('Clean: yes')
  })

  it('maps detached and unborn state to explicit JSON null values', async () => {
    const { ctx, git, agent } = await setup()
    git.statusResult = { ...git.statusResult, branch: undefined }
    const detached = await execute(ctx, 'git_status', {}, agent)
    expect(detached.isError).toBe(false)
    if (detached.isError) throw new Error('expected detached status success')
    expect(detached.value).toMatchObject({ status: { branch: null } })
    expect(text(detached)).toContain('Branch: (detached)')

    class UnbornGitRuntime extends StubGitRuntime {
      override async resolveRepository(request: GitResolveRequest): Promise<GitRepository> {
        this.resolutions.push(request)
        return { ...repository, head: undefined }
      }
    }
    const unbornCtx = new Context()
    await unbornCtx.plugin(AgentRegistry)
    await unbornCtx.plugin(SystemPrompt)
    await unbornCtx.plugin(ToolRuntime)
    await unbornCtx.plugin(UnbornGitRuntime)
    await unbornCtx.plugin(ToolGit)
    const unbornAgent = callingAgent()
    unbornCtx.agents.register(unbornAgent)
    const unborn = await execute(unbornCtx, 'git_log', {}, unbornAgent)
    expect(unborn.isError).toBe(false)
    if (unborn.isError) throw new Error('expected unborn log success')
    expect(unborn.value).toMatchObject({ repository: { head: null } })
    expect(text(unborn)).toContain('HEAD: (unborn)')
  })

  it('maps max_bytes to maxBytes and preserves bounded diff truncation', async () => {
    const { ctx, git, agent } = await setup()
    const result = await execute(ctx, 'git_diff', { max_bytes: 4096 }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected git_diff success')
    expect(git.diffs).toEqual([{ repository, maxBytes: 4096, signal: testToolSignal }])
    expect(result.value).toEqual({ repository: { root: '/repo', head: 'a'.repeat(40) }, diff: git.diffResult })
    expect(text(result)).toContain('Truncated: yes\n\ndiff --git')

    git.diffResult = { text: '', truncated: false }
    const empty = await execute(ctx, 'git_diff', {}, agent)
    expect(text(empty)).toContain('Truncated: no\n\n(no diff)')
  })

  it('omits the provider-owned diff default when max_bytes is absent', async () => {
    const { ctx, git, agent } = await setup()
    await execute(ctx, 'git_diff', {}, agent)
    expect(git.diffs).toEqual([{ repository, signal: testToolSignal }])
  })

  it('maps limit exactly and preserves structured log fields', async () => {
    const { ctx, git, agent } = await setup()
    const result = await execute(ctx, 'git_log', { limit: 2 }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected git_log success')
    expect(git.logs).toEqual([{ repository, limit: 2, signal: testToolSignal }])
    expect(result.value).toEqual({
      repository: { root: '/repo', head: 'a'.repeat(40) },
      entries: git.logResult,
    })
    expect(text(result)).toContain('"A\\tB"\t"subject\\twith separator"')

    git.logResult = []
    const empty = await execute(ctx, 'git_log', {}, agent)
    expect(text(empty)).toContain('(no commits)')
  })

  it('rejects fractional bounds before the Git service runs', async () => {
    const { ctx, git, agent } = await setup()
    for (const [name, args] of [
      ['git_diff', { max_bytes: 1.5 }],
      ['git_log', { limit: 1.5 }],
    ] as const) {
      expect((await execute(ctx, name, args, agent)).isError).toBe(true)
    }
    expect(git.resolutions).toEqual([])
  })

  it('rejects agentless calls and sessions without a workspace cwd', async () => {
    const { ctx, git } = await setup()
    const agentless = await execute(ctx, 'git_status', {})
    expect(agentless.isError).toBe(true)
    expect(text(agentless)).toContain('exact live calling agent')
    const unregistered = callingAgent()
    const stale = await execute(ctx, 'git_diff', {}, unregistered)
    expect(stale.isError).toBe(true)
    expect(text(stale)).toContain('exact live calling agent')
    const noWorkspaceAgent = callingAgent(null)
    ctx.agents.register(noWorkspaceAgent)
    const noWorkspace = await execute(ctx, 'git_log', {}, noWorkspaceAgent)
    expect(noWorkspace.isError).toBe(true)
    expect(text(noWorkspace)).toContain('session to have a workspace cwd')
    expect(git.resolutions).toEqual([])
  })

  it('preserves provider failures through the tool executor', async () => {
    const { ctx, git, agent } = await setup()
    git.failure = new GitError('NOT_REPOSITORY', 'not a repository')
    const result = await execute(ctx, 'git_status', {}, agent)
    expect(result).toMatchObject({
      isError: true,
      error: { message: 'not a repository' },
    })
    expect(text(result)).toBe('Error: not a repository')
  })

  it('declares generic read presentation without file locations', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.get('git_status')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Git status', kind: 'read',
    })
    expect(ctx.tools.get('git_diff')?.presentCall?.({ max_bytes: 10 })).toEqual({
      card: 'generic', title: 'Git diff', kind: 'read', rawInput: { max_bytes: 10 },
    })
    expect(ctx.tools.get('git_log')?.presentCall?.({ limit: 3 })).toEqual({
      card: 'generic', title: 'Git log', kind: 'read', rawInput: { limit: 3 },
    })
    expect(ctx.tools.get('git_diff')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Git diff', kind: 'read',
    })
    expect(ctx.tools.get('git_log')?.presentCall?.({})).toEqual({
      card: 'generic', title: 'Git log', kind: 'read',
    })
    for (const name of ['git_status', 'git_diff', 'git_log']) {
      expect(ctx.tools.get(name)?.isConcurrencySafe?.({})).toBe(true)
    }
  })

  it('unregisters all tools when its contributing fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(StubGitRuntime)
    const fiber = await ctx.plugin(ToolGit)
    expect(ctx.tools.schemas()).toHaveLength(3)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })

  it('has the namespace-plugin export shape so Loader keeps name and inject', () => {
    expect('default' in ToolGit).toBe(false)
    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(ToolGit) as Record<string, unknown>
    expect(unwrapped).toBe(ToolGit)
    expect(unwrapped.name).toBe('tool-git')
    expect(unwrapped.inject).toEqual(['agents', 'tools', 'git'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
