import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GitRuntime, { GitRepositoryId } from '@deepseek-ai/dsh-git'
import type {
  GitDiff,
  GitDiffRequest,
  GitLogEntry,
  GitLogRequest,
  GitRepository,
  GitResolveRequest,
  GitStatus,
} from '@deepseek-ai/dsh-git'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolGit from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class LoaderGitRuntime extends GitRuntime {
  readonly resolutions: GitResolveRequest[] = []

  async resolveRepository(request: GitResolveRequest): Promise<GitRepository> {
    this.resolutions.push(request)
    return { id: GitRepositoryId('/loader-repo'), root: '/loader-repo', head: 'c'.repeat(40) }
  }

  async status(_repository: GitRepository): Promise<GitStatus> {
    return {
      branch: 'loader-main', ahead: 0, behind: 0, staged: 0,
      unstaged: 1, untracked: 0, conflicted: 0, clean: false,
    }
  }

  async diff(_request: GitDiffRequest): Promise<GitDiff> {
    return { text: 'loader diff\n', truncated: false }
  }

  async log(_request: GitLogRequest): Promise<readonly GitLogEntry[]> {
    return []
  }
}

describe('dsh-tool-git through a real cordis.yml Loader composition', () => {
  it('loads the tool suite and executes a provider-neutral status observation', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-tool-git-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-agent'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-test-git'",
      "- name: '@deepseek-ai/dsh-tool-git'",
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-agent', AgentRegistry],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-test-git', LoaderGitRuntime],
      ['@deepseek-ai/dsh-tool-git', ToolGit],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.tools.schemas().map(schema => schema.name)).toEqual([
      'git_status', 'git_diff', 'git_log',
    ])
    const agentId = SessionId('loader-git-agent')
    const session = Session.create(agentId, [], {
      version: 3,
      id: agentId,
      createdAt: 0,
      isSeeded: false,
      cwd: '/loader-workspace',
    })
    const agent = { id: agentId, session } as unknown as Agent
    context.agents.register(agent)
    const result = await context.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('loader-status'),
      name: 'git_status',
      arguments: {},
      agent,
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected loader-composed git_status success')
    expect(result.value).toMatchObject({
      repository: { root: '/loader-repo', head: 'c'.repeat(40) },
      status: { branch: 'loader-main', unstaged: 1, clean: false },
    })
    const [resolution] = (context.git as LoaderGitRuntime).resolutions
    expect(resolution?.path).toBe('/loader-workspace')
    expect(resolution?.signal).toBeInstanceOf(AbortSignal)
    expect(result.content).toEqual([{ type: 'text', text: [
      'Repository: /loader-repo',
      `HEAD: ${'c'.repeat(40)}`,
      'Branch: loader-main',
      'Clean: no',
      'Changes: staged=0, unstaged=1, untracked=0, conflicted=0',
      'Upstream: ahead=0, behind=0',
    ].join('\n') }])
  })
})
