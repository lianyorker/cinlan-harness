/**
 * Model-facing read-only Git tools over `ctx.git`.
 *
 * @module @deepseek-ai/dsh-tool-git
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GitRepository } from '@deepseek-ai/dsh-git'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'tool-git'

/** Services required by the read-only Git tools. */
export const inject = ['agents', 'tools', 'git']

interface RepositoryOutput {
  readonly root: string
  readonly head: string | null
}

const repositoryOutputSchema = {
  type: 'object',
  required: true,
  additionalProperties: false,
  properties: {
    root: { type: 'string', required: true },
    head: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
  },
} as const

/** Project provider-owned repository identity into model-safe observation fields. */
function projectRepository(repository: GitRepository): RepositoryOutput {
  return {
    root: repository.root,
    head: repository.head ?? null,
  }
}

/** Render the repository fields shared by every result. */
function renderRepository(repository: RepositoryOutput): string {
  return `Repository: ${repository.root}\nHEAD: ${repository.head ?? '(unborn)'}`
}

/** Require the exact live calling Agent's execution-world workspace path. */
function workspacePath(ctx: Context, agent: Agent | undefined): string {
  if (agent === undefined || ctx.agents.get(agent.id) !== agent) {
    throw new Error('Git tools require an exact live calling agent')
  }
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.length === 0) {
    throw new Error('Git tools require the calling agent session to have a workspace cwd')
  }
  return cwd
}

/** Resolve the sole repository authorized for one tool execution. */
function resolveWorkspaceRepository(
  ctx: Context,
  exec: { readonly agent?: Agent; readonly signal: AbortSignal },
): Promise<GitRepository> {
  return ctx.git.resolveRepository({ path: workspacePath(ctx, exec.agent), signal: exec.signal })
}

/** Register `git_status`, `git_diff`, and `git_log`. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'git_status',
    description: 'Read structured branch, divergence, and working-tree counts for the calling agent workspace repository. This tool never changes the repository.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repository: repositoryOutputSchema,
          status: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              branch: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              ahead: { type: 'integer', required: true },
              behind: { type: 'integer', required: true },
              staged: { type: 'integer', required: true },
              unstaged: { type: 'integer', required: true },
              untracked: { type: 'integer', required: true },
              conflicted: { type: 'integer', required: true },
              clean: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          renderRepository(value.repository),
          `Branch: ${value.status.branch ?? '(detached)'}`,
          `Clean: ${value.status.clean ? 'yes' : 'no'}`,
          `Changes: staged=${value.status.staged}, unstaged=${value.status.unstaged}, untracked=${value.status.untracked}, conflicted=${value.status.conflicted}`,
          `Upstream: ahead=${value.status.ahead}, behind=${value.status.behind}`,
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      void args
      const repository = await resolveWorkspaceRepository(ctx, exec)
      const status = await ctx.git.status(repository, exec.signal)
      return {
        repository: projectRepository(repository),
        status: {
          branch: status.branch ?? null,
          ahead: status.ahead,
          behind: status.behind,
          staged: status.staged,
          unstaged: status.unstaged,
          untracked: status.untracked,
          conflicted: status.conflicted,
          clean: status.clean,
        },
      }
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Git status',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'git_diff',
    description: 'Read the bounded diff observation for the calling agent workspace repository. This tool never changes the repository.',
    parameters: {
      max_bytes: {
        type: 'integer',
        description: 'Optional positive byte cap within the configured provider limit.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repository: repositoryOutputSchema,
          diff: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              text: { type: 'string', required: true },
              truncated: { type: 'boolean', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          renderRepository(value.repository),
          `Truncated: ${value.diff.truncated ? 'yes' : 'no'}`,
          '',
          value.diff.text.length === 0 ? '(no diff)' : value.diff.text,
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const repository = await resolveWorkspaceRepository(ctx, exec)
      const diff = await ctx.git.diff({
        repository,
        signal: exec.signal,
        ...args.max_bytes === undefined ? {} : { maxBytes: args.max_bytes },
      })
      return { repository: projectRepository(repository), diff }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Git diff',
      kind: 'read',
      ...args.max_bytes === undefined ? {} : { rawInput: { max_bytes: args.max_bytes } },
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'git_log',
    description: 'Read recent commits from the calling agent workspace repository as bounded structured entries. This tool never changes the repository.',
    parameters: {
      limit: {
        type: 'integer',
        description: 'Optional positive entry limit within the configured provider limit.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repository: repositoryOutputSchema,
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                authorName: { type: 'string', required: true },
                committedAt: { type: 'string', required: true },
                subject: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          renderRepository(value.repository),
          '',
          value.entries.length === 0
            ? '(no commits)'
            : value.entries.map(entry => [
              entry.hash,
              entry.committedAt,
              JSON.stringify(entry.authorName),
              JSON.stringify(entry.subject),
            ].join('\t')).join('\n'),
        ].join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const repository = await resolveWorkspaceRepository(ctx, exec)
      const entries = await ctx.git.log({
        repository,
        signal: exec.signal,
        ...args.limit === undefined ? {} : { limit: args.limit },
      })
      return {
        repository: projectRepository(repository),
        entries: entries.map(entry => ({
          hash: entry.hash,
          authorName: entry.authorName,
          committedAt: entry.committedAt,
          subject: entry.subject,
        })),
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Git log',
      kind: 'read',
      ...args.limit === undefined ? {} : { rawInput: { limit: args.limit } },
    }),
  }))
}
