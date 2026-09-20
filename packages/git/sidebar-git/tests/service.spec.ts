import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitError } from '@deepseek-ai/dsh-git'
import { SessionId } from '@deepseek-ai/dsh-session'
import { GIT_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-git-settings/settings-schema'
import { cleanup, fixtureGit, harness, TEST_GIT_EXECUTABLE } from './fixture.ts'

afterEach(cleanup, 90_000)

describe('sidebar Git through real Loader composition', { timeout: 90_000 }, () => {
  it('bounds the complete response including repository metadata', async () => {
    await expect(harness({}, { config: { maxOutputBytes: 200 } })).rejects.toMatchObject({
      code: 'output-limit', message: 'Git response exceeded the configured byte limit',
    })
  })

  it('discovers a cold local Session without a Git provider through the configured executable', async () => {
    const h = await harness({}, { subdirectory: true, config: { executable: TEST_GIT_EXECUTABLE } })
    expect(h.ctx.get('git')).toBeUndefined()
    expect(h.initial.root.replaceAll('\\', '/')).toBe(h.repository.replaceAll('\\', '/'))
    expect(h.subprocess.specs.some(spec => spec.argv.includes('--show-toplevel'))).toBe(true)
    expect(h.subprocess.specs.some(spec => spec.argv.includes('status'))).toBe(true)
    expect(new Set(h.subprocess.resolutions)).toEqual(new Set([TEST_GIT_EXECUTABLE]))
  })

  it.each([
    ['NOT_REPOSITORY', 'not-repository'], ['INVALID_REQUEST', 'invalid-request'],
    ['OUTPUT_TOO_LARGE', 'output-limit'], ['COMMAND_FAILED', 'git-error'],
  ] as const)('normalizes a raw Git %s failure before transport dispatch', async (providerCode, sidebarCode) => {
    const h = await harness()
    vi.spyOn(h.ctx.executionBindings, 'forSession').mockRejectedValueOnce(new GitError(providerCode, 'provider failure'))
    await expect(h.service.status(h.request)).rejects.toMatchObject({
      name: 'SidebarGitError', code: sidebarCode, message: 'provider failure',
    })
  })

  it('maps cold execution admission loss to unavailable', async () => {
    const h = await harness()
    vi.spyOn(h.ctx.executionBindings, 'forSession').mockRejectedValueOnce(new Error('SSH connection lost'))
    await expect(h.service.status(h.request)).rejects.toMatchObject({
      name: 'SidebarGitError', code: 'unavailable', message: 'SSH connection lost',
    })
  })

  it('maps a lost execution lease separately from caller cancellation', async () => {
    const h = await harness()
    const retained = await h.ctx.executionBindings.forSession(h.session.id)
    const lost = new AbortController()
    lost.abort(new Error('SSH connection lost'))
    const cleanupFailure = new Error('SSH cleanup failed')
    const release = vi.fn(async () => { await retained.release(); throw cleanupFailure })
    vi.spyOn(h.ctx.executionBindings, 'forSession').mockResolvedValueOnce({
      ...retained, signal: lost.signal, assertCurrent: () => { lost.signal.throwIfAborted() }, release,
    })
    await expect(h.service.status(h.request)).rejects.toMatchObject({
      code: 'unavailable', message: 'SSH connection lost',
      cause: { errors: [expect.anything(), cleanupFailure] },
    })
    expect(release).toHaveBeenCalledOnce()

    const cancelled = new AbortController()
    cancelled.abort(new Error('caller cancelled'))
    await expect(h.service.status(h.request, cancelled.signal)).rejects.toMatchObject({
      code: 'cancelled', message: 'Git operation was cancelled',
    })
  })

  it('reports lease cleanup failures without publishing a successful result', async () => {
    const h = await harness()
    const retained = await h.ctx.executionBindings.forSession(h.session.id)
    const cleanupFailure = new Error('lease cleanup failed')
    vi.spyOn(h.ctx.executionBindings, 'forSession').mockResolvedValueOnce({
      ...retained, release: async () => { await retained.release(); throw cleanupFailure },
    })
    await expect(h.service.status(h.request)).rejects.toMatchObject({
      code: 'unavailable', message: 'The captured execution environment could not be released',
      cause: { errors: [cleanupFailure] },
    })
  })

  it('preserves unknown operation and cleanup failures together', async () => {
    const h = await harness()
    const retained = await h.ctx.executionBindings.forSession(h.session.id)
    const operationFailure = new Error('lease assertion failed')
    const cleanupFailure = new Error('lease cleanup failed')
    vi.spyOn(h.ctx.executionBindings, 'forSession').mockResolvedValueOnce({
      ...retained,
      assertCurrent: () => { throw operationFailure },
      release: async () => { await retained.release(); throw cleanupFailure },
    })
    let observed: unknown
    try { await h.service.status(h.request) } catch (error) { observed = error }
    expect(observed).toBeInstanceOf(AggregateError)
    expect((observed as AggregateError).errors).toEqual([operationFailure, cleanupFailure])
  })

  it('keeps a nested Session in its canonical repository and reports every untracked file', async () => {
    const h = await harness({ sourceControlGroupOrder: 'untracked-first' }, { subdirectory: true })
    await mkdir(join(h.repository, 'newdir'))
    await writeFile(join(h.repository, 'newdir', 'a.txt'), 'new\n')
    const status = await h.service.status(h.request)
    expect(status.groupOrder).toBe('untracked-first')
    expect(status.repository?.sessionCwd).toBe(h.session.header.cwd)
    expect(status.repository?.root).toBe(h.initial.root)
    expect(status.entries).toEqual([{ path: 'newdir/a.txt', xy: '??' }])
    await h.service.stage({ ...h.mutation, path: 'newdir/a.txt' })
    expect((await h.service.diff({ ...h.request, path: 'newdir/a.txt', staged: true })).diff).toContain('+new')
  })

  it('stages only a literal selected path and unstages it without changing file contents', async () => {
    const h = await harness()
    await writeFile(join(h.repository, '[a].txt'), 'literal\n')
    await writeFile(join(h.repository, 'a.txt'), 'other\n')
    await h.service.stage({ ...h.mutation, path: '[a].txt' })
    expect(await fixtureGit(h.repository, 'diff', '--cached', '--name-only')).toBe('[a].txt\n')
    await h.service.unstage({ ...h.mutation, path: '[a].txt' })
    expect(await fixtureGit(h.repository, 'diff', '--cached', '--name-only')).toBe('')
    expect(await readFile(join(h.repository, '[a].txt'), 'utf8')).toBe('literal\n')
    await expect(h.service.stage({ ...h.mutation, path: '../outside.txt' })).rejects.toMatchObject({ code: 'invalid-request' })
  })

  it('unstages both paths of a selected rename atomically', async () => {
    const h = await harness()
    await fixtureGit(h.repository, 'mv', 'tracked.txt', 'renamed.txt')
    const row = (await h.service.status(h.request)).entries[0]
    expect(row).toEqual({ path: 'renamed.txt', previousPath: 'tracked.txt', xy: 'R ' })
    await h.service.unstage({ ...h.mutation, path: 'renamed.txt' })
    expect(await fixtureGit(h.repository, 'diff', '--cached', '--name-only')).toBe('')
    expect(await readFile(join(h.repository, 'renamed.txt'), 'utf8')).toBe('base\n')
  })

  it('previews exact attribution and commits staged content without staging worktree edits', async () => {
    const h = await harness({ enableGitHubAttribution: true })
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await h.service.stage({ ...h.mutation, path: 'tracked.txt' })
    await writeFile(join(h.repository, 'tracked.txt'), 'unstaged\n')
    const preview = await h.service.prepareCommit({ ...h.mutation, message: 'User message\n\nSigned-off-by: User <user@example.invalid>' })
    expect(preview.message).toBe('User message\n\nSigned-off-by: User <user@example.invalid>\nCo-authored-by: Cinlan IDE <noreply@cinlan.online>\n')
    expect((await fixtureGit(h.repository, 'rev-parse', 'HEAD')).trim()).toBe(h.initial.head)
    const result = await h.service.commit({ preview })
    expect(result.message).toBe(preview.message)
    expect(await fixtureGit(h.repository, 'log', '-1', '--format=%(trailers:key=Signed-off-by,valueonly)')).toContain('User <user@example.invalid>')
    expect(await fixtureGit(h.repository, 'log', '-1', '--format=%(trailers:key=Co-authored-by,valueonly)')).toContain('Cinlan IDE <noreply@cinlan.online>')
    expect(result.head).not.toBe(h.initial.head)
    expect(await fixtureGit(h.repository, 'show', result.head + ':tracked.txt')).toBe('staged\n')
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('unstaged\n')
    expect(await fixtureGit(h.repository, 'log', '-1', '--format=%an <%ae>')).toBe('Sidebar Test <sidebar@example.invalid>\n')
  })

  it('does not duplicate an existing attribution trailer or add it when disabled', async () => {
    const h = await harness({ enableGitHubAttribution: true })
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await h.service.stage(h.mutation)
    const message = 'Update\n\nCo-authored-by: Cinlan IDE <noreply@cinlan.online>\n'
    expect((await h.service.prepareCommit({ ...h.mutation, message })).message).toBe(message)
    await h.ctx.settings.update(GIT_SETTINGS_NAMESPACE, { enableGitHubAttribution: false })
    expect((await h.service.prepareCommit({ ...h.mutation, message: 'No attribution' })).message).toBe('No attribution\n')
  })

  it.each(['command', 'separators'] as const)('refuses incompatible trailer %s configuration without changing Git state', async (kind) => {
    const h = await harness({ enableGitHubAttribution: true })
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await h.service.stage(h.mutation)
    await fixtureGit(h.repository, 'config', kind === 'command' ? 'trailer.co-authored-by.command' : 'trailer.separators',
      kind === 'command' ? 'echo should-not-run' : '%')
    const index = await fixtureGit(h.repository, 'ls-files', '--stage', '-z')
    await expect(h.service.prepareCommit({ ...h.mutation, message: 'Review' })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await fixtureGit(h.repository, 'ls-files', '--stage', '-z')).toBe(index)
    expect((await fixtureGit(h.repository, 'rev-parse', 'HEAD')).trim()).toBe(h.initial.head)
  })

  it.each(['index', 'head', 'branch'] as const)('refuses a reviewed commit after %s changes', async (changed) => {
    const h = await harness()
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await h.service.stage(h.mutation)
    const preview = await h.service.prepareCommit({ ...h.mutation, message: 'Review' })
    if (changed === 'index') {
      await writeFile(join(h.repository, 'extra.txt'), 'extra\n')
      await fixtureGit(h.repository, 'add', 'extra.txt')
    } else if (changed === 'head') {
      await fixtureGit(h.repository, 'commit', '--allow-empty', '-m', 'external')
    } else {
      await fixtureGit(h.repository, 'checkout', '-b', 'other')
    }
    const head = await fixtureGit(h.repository, 'rev-parse', 'HEAD')
    await expect(h.service.commit({ preview })).rejects.toMatchObject({ code: 'stale' })
    expect(await fixtureGit(h.repository, 'rev-parse', 'HEAD')).toBe(head)
  })

  it('refuses unknown, detached, missing-cwd and rebound Sessions without process-cwd fallback', async () => {
    const h = await harness()
    await expect(h.service.stage({ ...h.mutation, repositoryRoot: join(h.root, 'different') })).rejects.toMatchObject({ code: 'stale' })
    await expect(h.service.status({ sessionId: SessionId('missing') })).rejects.toMatchObject({ code: 'unavailable' })
    const blank = h.ctx.sessions.create(SessionId('blank'))
    await expect(h.service.status({ sessionId: blank.id })).rejects.toMatchObject({ code: 'unavailable' })
    await writeFile(join(h.repository, 'tracked.txt'), 'staged\n')
    await h.service.stage(h.mutation)
    const preview = await h.service.prepareCommit({ ...h.mutation, message: 'Review' })
    h.detach()
    await expect(h.service.commit({ preview })).rejects.toMatchObject({ code: 'unavailable' })
    const differentCwd = join(h.repository, 'newcwd')
    await mkdir(differentCwd)
    h.ctx.sessions.create(h.session.id, { meta: { cwd: differentCwd } })
    await expect(h.service.commit({ preview })).rejects.toMatchObject({ code: 'stale' })
  })

  it('pins committed comparisons to cached refs and reports upstream fallback without changing working data', async () => {
    const h = await harness({ compareAgainstUpstream: true })
    await fixtureGit(h.repository, 'checkout', '-b', 'feature')
    await writeFile(join(h.repository, 'tracked.txt'), 'feature\n')
    await fixtureGit(h.repository, 'commit', '-am', 'feature')
    await writeFile(join(h.repository, 'tracked.txt'), 'working copy\n')
    const fallback = await h.service.compare(h.request)
    expect(fallback).toMatchObject({ status: 'ready', baseRef: 'refs/heads/main', baseHead: h.initial.head, usedFallback: true })
    if (fallback.status !== 'ready') throw new Error('Expected a comparison')
    expect(fallback.diff).toContain('+feature')
    expect(fallback.diff).not.toContain('working copy')
    await fixtureGit(h.repository, 'config', 'branch.feature.remote', '.')
    await fixtureGit(h.repository, 'config', 'branch.feature.merge', 'refs/heads/main')
    expect(await h.service.compare(h.request)).toMatchObject({ status: 'ready', baseRef: 'refs/heads/main', usedFallback: false })
    await h.ctx.settings.update(GIT_SETTINGS_NAMESPACE, { compareAgainstUpstream: false })
    await fixtureGit(h.repository, 'update-ref', 'refs/remotes/origin/default', h.initial.head ?? '')
    await fixtureGit(h.repository, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/default')
    expect(await h.service.compare(h.request)).toMatchObject({ status: 'ready', baseRef: 'refs/remotes/origin/default' })
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('working copy\n')
  })

  it('reports missing comparison prerequisites and permits an initial staged commit', async () => {
    const h = await harness({}, { unborn: true })
    expect(await h.service.compare(h.request)).toEqual({ status: 'unavailable', reason: 'unborn' })
    await h.service.stage(h.mutation)
    const preview = await h.service.prepareCommit({ ...h.mutation, message: 'Initial' })
    expect(preview.head).toBeNull()
    await h.service.commit({ preview })
    await fixtureGit(h.repository, 'branch', '-m', 'topic')
    expect(await h.service.compare(h.request)).toEqual({ status: 'unavailable', reason: 'no-default-branch' })
    await fixtureGit(h.repository, 'checkout', '--detach')
    expect(await h.service.compare(h.request)).toEqual({ status: 'unavailable', reason: 'detached' })
  })

  it('preserves manual history, checkout, discard, revert and cherry-pick semantics', async () => {
    const h = await harness()
    await fixtureGit(h.repository, 'branch', 'other')
    await writeFile(join(h.repository, 'tracked.txt'), 'discard me\n')
    await h.service.discard({ ...h.mutation, head: h.initial.head, path: 'tracked.txt' })
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('base\n')
    await writeFile(join(h.repository, 'tracked.txt'), 'changed\n')
    await h.service.stage(h.mutation)
    const change = await h.service.commit({ preview: await h.service.prepareCommit({ ...h.mutation, message: 'Change' }) })
    expect((await h.service.log({ ...h.request, count: 1 }))[0]?.subject).toBe('Change')
    expect((await h.service.commitDiff({ ...h.request, hash: change.head })).diff).toContain('+changed')
    expect(await h.service.show({ ...h.request, ref: change.head, path: 'tracked.txt' })).toEqual({ content: 'changed\n' })
    expect((await h.service.branches(h.request)).names).toContain('other')
    await h.service.revert({ ...h.mutation, head: change.head, hash: change.head })
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('base\n')
    await h.service.checkout({ ...h.mutation, branch: 'other' })
    await h.service.cherryPick({ ...h.mutation, head: h.initial.head, hash: change.head })
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('changed\n')
    await expect(h.service.discard({ ...h.mutation, head: h.initial.head, path: 'tracked.txt' })).rejects.toMatchObject({ code: 'stale' })
  })
})
