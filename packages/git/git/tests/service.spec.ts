import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import GitRuntime, {
  GitError,
  GitRepositoryId,
} from '@deepseek-ai/dsh-git'
import type {
  GitDiff,
  GitDiffRequest,
  GitLogEntry,
  GitLogRequest,
  GitRepository,
  GitResolveRequest,
  GitStatus,
} from '@deepseek-ai/dsh-git'

const repository: GitRepository = {
  id: GitRepositoryId('/repo'),
  root: '/repo',
  head: undefined,
}

class StubGitRuntime extends GitRuntime {
  async resolveRepository(request: GitResolveRequest): Promise<GitRepository> {
    return { ...repository, root: request.path }
  }

  async status(_repository: GitRepository): Promise<GitStatus> {
    return {
      branch: undefined,
      ahead: 0,
      behind: 0,
      staged: 0,
      unstaged: 0,
      untracked: 0,
      conflicted: 0,
      clean: true,
    }
  }

  async diff(_request: GitDiffRequest): Promise<GitDiff> {
    return { text: '', truncated: false }
  }

  async log(_request: GitLogRequest): Promise<readonly GitLogEntry[]> {
    return []
  }
}

describe('GitRuntime seam', () => {
  it('registers one provider and releases it on disposal', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(StubGitRuntime)
    expect(await ctx.git.resolveRepository({ path: '/work' })).toMatchObject({ root: '/work' })
    await expect(ctx.git.status(repository)).resolves.toMatchObject({ clean: true })
    await expect(ctx.git.diff({ repository })).resolves.toEqual({ text: '', truncated: false })
    await expect(ctx.git.log({ repository })).resolves.toEqual([])
    await fiber.dispose()
    expect((ctx as Context & { git?: unknown }).git).toBeUndefined()
  })

  it('rejects duplicate providers and exposes stable errors', async () => {
    const ctx = new Context()
    await ctx.plugin(StubGitRuntime)
    await expect(ctx.plugin(StubGitRuntime)).rejects.toThrow(/service "git" has been registered/)
    const cause = new Error('cause')
    const error = new GitError('COMMAND_FAILED', 'failed', { cause })
    expect(error).toMatchObject({ name: 'GitError', code: 'COMMAND_FAILED', message: 'failed', cause })
    expect(GitRepositoryId('/repo')).toBe('/repo')
  })
})
