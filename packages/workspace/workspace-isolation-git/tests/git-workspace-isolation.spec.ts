import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { WorkspaceIsolationError } from '@deepseek-ai/dsh-workspace-isolation'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import GitWorkspaceIsolation from '../src/index.ts'

const execFileAsync = promisify(execFile)
const roots: string[] = []
const contexts: Context[] = []

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-c', 'commit.gpgSign=false', ...args], {
    cwd,
    encoding: 'utf8',
  })
  return result.stdout
}

async function createRepository(): Promise<{ root: string; repository: string; managed: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-workspace-isolation-git-')))
  roots.push(root)
  const repository = join(root, 'repository')
  const managed = join(root, 'managed')
  await mkdir(repository)
  await git(repository, 'init')
  await git(repository, 'config', 'user.name', 'Workspace Isolation Test')
  await git(repository, 'config', 'user.email', 'workspace-isolation-test@localhost')
  await writeFile(join(repository, 'tracked.txt'), 'base\n')
  await git(repository, 'add', '--all')
  await git(repository, 'commit', '-m', 'base')
  return { root, repository, managed }
}

async function harness(options: {
  repository?: string
  managed?: string
  pool?: MemoryMediaPool
  maxActiveCheckouts?: number
} = {}) {
  const paths = options.repository === undefined || options.managed === undefined
    ? await createRepository()
    : { root: '', repository: options.repository, managed: options.managed }
  const pool = options.pool ?? new MemoryMediaPool()
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalSubprocessRuntime)
  const fiber = await ctx.plugin(GitWorkspaceIsolation, {
    root: paths.managed,
    maxActiveCheckouts: options.maxActiveCheckouts ?? 4,
    commandTimeoutMs: 30_000,
  })
  return { ...paths, ctx, fiber, pool, isolation: ctx.workspaceIsolation }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('GitWorkspaceIsolation', { timeout: 30_000 }, () => {
  it('protects acquired leases until every consumer releases its reservation', async () => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const request = { sessionId: SessionId('task-without-agent'), sourcePath: h.repository }
    const first = await h.isolation.acquire(request)
    const second = await h.isolation.acquire(request)
    await expect(h.isolation.hibernate(first.lease.id)).rejects.toMatchObject({ code: 'LEASE_BUSY' })
    await expect(h.isolation.teardown(first.lease.id)).rejects.toMatchObject({ code: 'LEASE_BUSY' })
    first.release()
    first.release()
    await expect(h.isolation.ensure({ sessionId: SessionId('next-task'), sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'CAPACITY' })
    expect(await readFile(join(first.lease.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
    second.release()
    await h.isolation.ensure({ sessionId: SessionId('next-task'), sourcePath: h.repository })
    expect(h.isolation.find(request.sessionId)?.phase).toBe('hibernated')
  }, 30_000)

  it('creates one idempotent managed checkout only from a clean source', async () => {
    const h = await harness()
    const sessionId = SessionId('clean')
    const first = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    const second = await h.isolation.ensure({ sessionId, sourcePath: h.repository })

    expect(second).toMatchObject({ id: first.id, checkoutPath: first.checkoutPath, phase: 'active' })
    await expect(stat(first.checkoutPath)).resolves.toMatchObject({})
    expect(await readFile(join(first.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(h.isolation.list()).toHaveLength(1)
  })

  it('refuses staged, unstaged, and untracked source changes before creating a lease', async () => {
    const h = await harness()
    await writeFile(join(h.repository, 'untracked.txt'), 'local\n')

    await expect(h.isolation.ensure({
      sessionId: SessionId('dirty'),
      sourcePath: h.repository,
    })).rejects.toMatchObject({ code: 'SOURCE_DIRTY' } satisfies Partial<WorkspaceIsolationError>)
    expect(h.isolation.list()).toEqual([])
  })

  it('checkpoints changes, removes only the checkout, retains its branch, and reactivates it', async () => {
    const h = await harness()
    const sessionId = SessionId('checkpoint')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'result.txt'), 'retained\n')

    const hibernated = await h.isolation.hibernate(lease.id)
    expect(hibernated.phase).toBe('hibernated')
    await expect(stat(lease.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(git(h.repository, 'show-ref', '--verify', `refs/heads/${lease.branch}`)).resolves.toContain(lease.branch)

    const active = await h.isolation.activate(lease.id)
    expect(active.phase).toBe('active')
    expect(await readFile(join(active.checkoutPath, 'result.txt'), 'utf8')).toBe('retained\n')
  })

  it('captures the source branch and commit when creating a lease', async () => {
    const h = await harness()
    const currentBranch = (await git(h.repository, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()
    const currentHead = (await git(h.repository, 'rev-parse', 'HEAD')).trim()

    const lease = await h.isolation.ensure({
      sessionId: SessionId('test-base-tracking'),
      sourcePath: h.repository,
    })

    expect(lease.baseBranch).toBe(currentBranch)
    expect(lease.baseHead).toBe(currentHead)
    expect(lease.baseHead).toMatch(/^[0-9a-f]{40}$/)
    expect(lease.branch).not.toBe(currentBranch)
    expect(lease.branch).toMatch(/^dsh\/session\//)
  })

  it('reclaims the oldest inactive checkout when the active-checkout limit is reached', async () => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const first = await h.isolation.ensure({ sessionId: SessionId('first'), sourcePath: h.repository })
    const second = await h.isolation.ensure({ sessionId: SessionId('second'), sourcePath: h.repository })

    expect(h.isolation.find(SessionId('first'))?.phase).toBe('hibernated')
    expect(h.isolation.find(SessionId('second'))?.phase).toBe('active')
    await expect(stat(first.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(second.checkoutPath)).resolves.toMatchObject({})
  })

  it('reconciles an active checkout left by an earlier process without losing its branch', async () => {
    const first = await harness()
    const lease = await first.isolation.ensure({
      sessionId: SessionId('restart'),
      sourcePath: first.repository,
    })
    await writeFile(join(lease.checkoutPath, 'restart.txt'), 'checkpoint me\n')
    await first.fiber.dispose()

    const restarted = await harness({
      repository: first.repository,
      managed: first.managed,
      pool: first.pool,
    })
    expect(restarted.isolation.find(SessionId('restart'))?.phase).toBe('hibernated')
    await expect(stat(lease.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(git(first.repository, 'show-ref', '--verify', `refs/heads/${lease.branch}`)).resolves.toContain(lease.branch)

    const active = await restarted.isolation.ensure({
      sessionId: SessionId('restart'),
      sourcePath: first.repository,
    })
    expect(await readFile(join(active.checkoutPath, 'restart.txt'), 'utf8')).toBe('checkpoint me\n')
  })

  it('never removes a foreign worktree occupying a managed lease path', async () => {
    const h = await harness()
    const sessionId = SessionId('foreign')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await h.isolation.hibernate(lease.id)
    await git(h.repository, 'worktree', 'add', '-b', 'foreign-owner', lease.checkoutPath, 'HEAD')
    await writeFile(join(lease.checkoutPath, 'foreign.txt'), 'foreign\n')

    await expect(h.isolation.ensure({ sessionId, sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'LEASE_CONFLICT' } satisfies Partial<WorkspaceIsolationError>)
    expect(await readFile(join(lease.checkoutPath, 'foreign.txt'), 'utf8')).toBe('foreign\n')
    expect((await git(h.repository, 'worktree', 'list', '--porcelain')).replaceAll('\\', '/'))
      .toContain(lease.checkoutPath.replaceAll('\\', '/'))
  })

  it('never removes an unrelated directory occupying a managed lease path', async () => {
    const h = await harness()
    const sessionId = SessionId('occupied')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await h.isolation.hibernate(lease.id)
    await mkdir(lease.checkoutPath, { recursive: true })
    await writeFile(join(lease.checkoutPath, 'sentinel.txt'), 'unrelated\n')

    await expect(h.isolation.ensure({ sessionId, sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'LEASE_CONFLICT' } satisfies Partial<WorkspaceIsolationError>)
    expect(await readFile(join(lease.checkoutPath, 'sentinel.txt'), 'utf8')).toBe('unrelated\n')
  })
  it('hibernates a worktree by committing managed branch changes', async () => {
    const h = await harness()
    const sessionId = SessionId('hibernate-commit')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })

    await writeFile(join(lease.checkoutPath, 'new-file.txt'), 'hibernated content\n')
    await writeFile(join(lease.checkoutPath, 'tracked.txt'), 'modified\n')

    const hibernated = await h.isolation.hibernate(lease.id)
    expect(hibernated.phase).toBe('hibernated')
    await expect(stat(lease.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })

    const branchRef = await git(h.repository, 'show-ref', '--verify', `refs/heads/${lease.branch}`)
    expect(branchRef).toContain(lease.branch)

    const logResult = await git(h.repository, 'log', '--oneline', '-1', lease.branch)
    expect(logResult).toContain(`Checkpoint workspace lease ${lease.id}`)

    expect(h.isolation.find(sessionId)?.phase).toBe('hibernated')
  })

  it('retains an unmerged branch and durable review state instead of force-deleting work', async () => {
    const h = await harness()
    const sessionId = SessionId('teardown')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'must-be-retained.txt'), 'content\n')

    const result = await h.isolation.teardown(lease.id)

    expect(result).toMatchObject({
      status: 'review',
      reason: 'unmerged-branch',
      lease: { id: lease.id, phase: 'hibernated', reviewState: 'branch-retained' },
    })
    await expect(stat(lease.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await git(h.repository, 'branch', '--list', lease.branch)).toContain(lease.branch)
    expect(h.isolation.find(sessionId)).toMatchObject({ reviewState: 'branch-retained' })
  })

  it('merges a checkpoint into the recorded base branch before safe branch deletion', async () => {
    const h = await harness()
    const sessionId = SessionId('merge-and-delete')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'merged.txt'), 'merged content\n')

    const integrated = await h.isolation.merge(lease.id)
    expect(integrated).toMatchObject({
      lease: { id: lease.id, phase: 'hibernated', reviewState: 'none' },
      targetBranch: lease.baseBranch,
    })
    expect(await readFile(join(h.repository, 'merged.txt'), 'utf8')).toBe('merged content\n')

    await expect(h.isolation.teardown(lease.id)).resolves.toEqual({ status: 'removed', leaseId: lease.id })

    expect(await git(h.repository, 'branch', '--list', lease.branch)).toBe('')
    expect(h.isolation.find(sessionId)).toBeUndefined()
    expect(h.isolation.list()).toHaveLength(0)
  })

  it('inspects, compares, and exports active tracked changes while reporting omitted untracked files', async () => {
    const h = await harness()
    const lease = await h.isolation.ensure({ sessionId: SessionId('review'), sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'tracked.txt'), 'active change\n')
    await writeFile(join(lease.checkoutPath, 'untracked.txt'), 'not in patch\n')

    const inspection = await h.isolation.inspect(lease.id)
    expect(inspection).toMatchObject({
      checkoutState: 'dirty',
      hasUntrackedFiles: true,
      workingTreeChanges: expect.arrayContaining([
        { kind: 'modified', path: 'tracked.txt' },
        { kind: 'untracked', path: 'untracked.txt' },
      ]),
    })

    const comparison = await h.isolation.compare(lease.id)
    expect(comparison).toMatchObject({
      ahead: 0,
      behind: 0,
      includesWorkingTree: true,
      hasUntrackedFiles: true,
      patchTruncated: false,
      changedFiles: expect.arrayContaining([
        { kind: 'modified', path: 'tracked.txt' },
        { kind: 'untracked', path: 'untracked.txt' },
      ]),
    })
    expect(comparison.patch).toContain('+active change')
    expect(comparison.patch).not.toContain('not in patch')

    const exported = await h.isolation.exportPatch(lease.id)
    expect(exported).toMatchObject({
      leaseId: lease.id,
      includesWorkingTree: true,
      hasUntrackedFiles: true,
    })
    expect(exported.fileName).toBe(`workspace-${lease.id}.patch`)
    expect(exported.content).toBe(comparison.patch)
  })

  it('compares hibernated checkpoint commits from NUL-framed Git log records', async () => {
    const h = await harness()
    const lease = await h.isolation.ensure({
      sessionId: SessionId('hibernated-review'),
      sourcePath: h.repository,
    })
    await writeFile(join(lease.checkoutPath, 'hibernated.txt'), 'checkpointed content\n')

    const hibernated = await h.isolation.hibernate(lease.id)
    const comparison = await h.isolation.compare(lease.id)

    expect(comparison).toMatchObject({
      lease: { id: lease.id, phase: 'hibernated' },
      branchHead: hibernated.head,
      ahead: 1,
      behind: 0,
      includesWorkingTree: false,
      hasUntrackedFiles: false,
      patchTruncated: false,
      commits: [{
        id: hibernated.head,
        summary: `Checkpoint workspace lease ${lease.id}`,
      }],
      changedFiles: [{ kind: 'added', path: 'hibernated.txt' }],
    })
    expect(comparison.patch).toContain('+checkpointed content')
  })

  it('cherry-picks linear commits but retains their source branch for explicit review', async () => {
    const h = await harness()
    const sessionId = SessionId('cherry-pick')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'picked.txt'), 'picked content\n')

    const integrated = await h.isolation.cherryPick(lease.id)
    expect(integrated).toMatchObject({ targetBranch: lease.baseBranch })
    expect(await readFile(join(h.repository, 'picked.txt'), 'utf8')).toBe('picked content\n')
    const teardown = await h.isolation.teardown(lease.id)
    expect(teardown).toMatchObject({
      status: 'review',
      lease: { id: lease.id, phase: 'hibernated', reviewState: 'branch-retained' },
    })
    expect(await git(h.repository, 'branch', '--list', lease.branch)).toContain(lease.branch)
  })

  it('aborts a conflicting merge and leaves the clean source checkout unchanged', async () => {
    const h = await harness()
    const lease = await h.isolation.ensure({ sessionId: SessionId('merge-conflict'), sourcePath: h.repository })
    await writeFile(join(lease.checkoutPath, 'tracked.txt'), 'lease change\n')
    await writeFile(join(h.repository, 'tracked.txt'), 'source change\n')
    await git(h.repository, 'add', '--all')
    await git(h.repository, 'commit', '-m', 'source change')

    await expect(h.isolation.merge(lease.id)).rejects.toMatchObject({ code: 'COMMAND_FAILED' })
    expect(await readFile(join(h.repository, 'tracked.txt'), 'utf8')).toBe('source change\n')
    expect(await git(h.repository, 'status', '--porcelain=v1')).toBe('')
    expect(h.isolation.find(lease.sessionId)).toMatchObject({ phase: 'hibernated' })
  })

  it('prunes orphaned worktrees without valid lease records', async () => {
    const h = await harness()
    const sessionId = SessionId('orphan')
    const lease = await h.isolation.ensure({ sessionId, sourcePath: h.repository })
    const checkoutPath = lease.checkoutPath

    const worktreesBefore = await git(h.repository, 'worktree', 'list', '--porcelain')
    expect(worktreesBefore.replaceAll('\\', '/')).toContain(checkoutPath.replaceAll('\\', '/'))

    await h.isolation.teardown(lease.id)
    await h.isolation.ensure({ sessionId: SessionId('repository-keeper'), sourcePath: h.repository })

    await git(h.repository, 'worktree', 'add', '-b', lease.branch, checkoutPath, 'HEAD')

    const worktreesWithOrphan = await git(h.repository, 'worktree', 'list', '--porcelain')
    expect(worktreesWithOrphan.replaceAll('\\', '/')).toContain(checkoutPath.replaceAll('\\', '/'))

    const prunedCount = await h.isolation.pruneOrphans()

    expect(prunedCount).toBe(1)

    const worktreesAfter = await git(h.repository, 'worktree', 'list', '--porcelain')
    expect(worktreesAfter.replaceAll('\\', '/')).not.toContain(checkoutPath.replaceAll('\\', '/'))
  })

  it('retains worktrees beside the managed root and foreign branches inside it', async () => {
    const h = await harness()
    await h.isolation.ensure({ sessionId: SessionId('repository-keeper'), sourcePath: h.repository })
    const sibling = h.managed + '-foreign'
    const foreign = join(h.managed, '11111111-1111-4111-8111-111111111111')
    await git(h.repository, 'worktree', 'add', '-b', 'dsh/session/22222222-2222-4222-8222-222222222222', sibling, 'HEAD')
    await git(h.repository, 'worktree', 'add', '-b', 'user-work', foreign, 'HEAD')
    await writeFile(join(sibling, 'unsaved.txt'), 'keep sibling\n')
    await writeFile(join(foreign, 'unsaved.txt'), 'keep foreign\n')

    expect(await h.isolation.pruneOrphans()).toBe(0)
    expect(await readFile(join(sibling, 'unsaved.txt'), 'utf8')).toBe('keep sibling\n')
    expect(await readFile(join(foreign, 'unsaved.txt'), 'utf8')).toBe('keep foreign\n')
  })
})
