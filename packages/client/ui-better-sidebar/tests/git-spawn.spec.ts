import { describe, expect, it, vi } from 'vitest'
import type { SidebarGit } from '@deepseek-ai/dsh-sidebar-git'
import { SidebarGitError } from '@deepseek-ai/dsh-sidebar-git'
import { buildGitApi } from '../src/git.ts'

/** The HTTP carrier passes no client cwd or unreviewed message to the executor. */
describe('sidebar Git HTTP forwarding', () => {
  it('decodes only Session and operation fields and omits caller cwd', async () => {
    const stage = vi.fn<SidebarGit['stage']>().mockResolvedValue({ ok: true })
    const owner = { stage } as Pick<SidebarGit, 'stage'> as SidebarGit
    const routes = buildGitApi(() => owner)
    await routes['git.stage']?.({ sessionId: 'test', cwd: '/wrong', repositoryRoot: '/repo', path: 'file.txt' })
    expect(stage).toHaveBeenCalledWith({ sessionId: 'test', repositoryRoot: '/repo', path: 'file.txt' })
  })

  it('refuses missing owners, missing provenance, and old commit-with-message requests', async () => {
    await expect(buildGitApi(() => undefined)['git.status']?.({ sessionId: 'test', cwd: '/wrong' }))
      .rejects.toMatchObject({ code: 'unavailable', status: 503 })
    const commit = vi.fn<SidebarGit['commit']>()
    const owner = { commit } as Pick<SidebarGit, 'commit'> as SidebarGit
    const routes = buildGitApi(() => owner)
    await expect(routes['git.commit']?.({ sessionId: 'test', message: 'unreviewed', cwd: '/wrong' }))
      .rejects.toMatchObject({ code: 'bad-request' })
    expect(commit).not.toHaveBeenCalled()
  })

  it('preserves a stable executor failure without starting another Git implementation', async () => {
    const status = vi.fn<SidebarGit['status']>().mockRejectedValue(new SidebarGitError('stale', 'Refresh the repository'))
    const owner = { status } as Pick<SidebarGit, 'status'> as SidebarGit
    await expect(buildGitApi(() => owner)['git.status']?.({ sessionId: 'test' }))
      .rejects.toMatchObject({ code: 'stale', message: 'Refresh the repository', status: 409 })
  })
})
