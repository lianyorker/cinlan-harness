import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { SidebarGitError } from '@deepseek-ai/dsh-sidebar-git'
import SidebarGitController from '../src/index.ts'
import { cleanup, fixtureGit, harness } from '../../../git/sidebar-git/tests/fixture.ts'

afterEach(cleanup, 90_000)

const extra = [
  { name: '@deepseek-ai/dsh-typert-registry', module: TypertRegistry },
  { name: '@deepseek-ai/dsh-api-sidebar-git-controller', module: SidebarGitController },
]

describe('sidebar Git controller through real Loader composition', { timeout: 90_000 }, () => {
  it('forwards exact prepared intent and reports the message actually recorded by a user hook', async () => {
    const h = await harness({ enableGitHubAttribution: true }, { extra })
    const controller = h.ctx.sidebarGitController
    const signal = new AbortController().signal
    expect((await controller.status(h.request, signal)).repository?.root).toBe(h.initial.root)
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await controller.stage({ ...h.mutation, path: 'tracked.txt' }, signal)
    const preview = await controller.prepareCommit({ ...h.mutation, message: 'Reviewed message' }, signal)
    await mkdir(join(h.repository, '.git', 'hooks'), { recursive: true })
    const hook = join(h.repository, '.git', 'hooks', 'commit-msg')
    await writeFile(hook, '#!/bin/sh\nprintf "\\nHook note\\n" >> "$1"\n')
    await chmod(hook, 0o755)
    const result = await controller.commit({ preview }, signal)
    expect(result.message).toContain(preview.message)
    expect(result.message).toContain('Hook note')
    expect(await fixtureGit(h.repository, 'log', '-1', '--format=format:%B')).toBe(result.message)
    expect((await controller.log({ ...h.request, count: 1 }, signal))[0]?.hashFull).toBe(result.head)
    await h.ctx.fiber.dispose()
    expect(h.ctx.get('sidebarGit')).toBeUndefined()
    expect(h.ctx.get('sidebarGitController')).toBeUndefined()
  })

  it('maps an actual changed index to the exact typed stale failure', async () => {
    const h = await harness({}, { extra })
    const controller = h.ctx.sidebarGitController
    const signal = new AbortController().signal
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await controller.stage(h.mutation, signal)
    const preview = await controller.prepareCommit({ ...h.mutation, message: 'Review' }, signal)
    await writeFile(join(h.repository, 'other.txt'), 'other\n')
    await fixtureGit(h.repository, 'add', 'other.txt')
    await expect(controller.commit({ preview }, signal)).rejects.toMatchObject({
      code: 'sidebar-git/stale', details: { operation: 'commit' }, isDSHRemoteError: true,
    })
    expect((await fixtureGit(h.repository, 'rev-parse', 'HEAD')).trim()).toBe(h.initial.head)
    const abort = new AbortController()
    abort.abort()
    await expect(controller.status(h.request, abort.signal)).rejects.toMatchObject({
      code: 'sidebar-git/cancelled', details: { operation: 'status' },
    })
  })

  it('carries normalized owner failures and gives explicit caller cancellation precedence', async () => {
    const h = await harness({}, { extra })
    const controller = h.ctx.sidebarGitController
    vi.spyOn(h.service, 'status').mockRejectedValueOnce(new SidebarGitError('output-limit', 'provider limit'))
    await expect(controller.status(h.request, new AbortController().signal)).rejects.toMatchObject({
      code: 'sidebar-git/output-limit', message: 'provider limit', details: { operation: 'status' },
    })

    const caller = new AbortController()
    vi.spyOn(h.service, 'status').mockImplementationOnce(async () => {
      caller.abort(new Error('client cancelled'))
      throw new SidebarGitError('unavailable', 'execution disconnected')
    })
    await expect(controller.status(h.request, caller.signal)).rejects.toMatchObject({
      code: 'sidebar-git/cancelled', details: { operation: 'status' },
    })
  })

  it('reports an unavailable owner instead of falling back to a process working directory', async () => {
    const ctx = new Context()
    try {
      const controller = new SidebarGitController(ctx)
      const h = await harness()
      await expect(controller.status(h.request, new AbortController().signal)).rejects.toMatchObject({
        code: 'sidebar-git/unavailable', details: { operation: 'status' },
      })
    } finally { await ctx.fiber.dispose() }
  })
})
