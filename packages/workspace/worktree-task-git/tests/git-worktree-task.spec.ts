import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { WorktreeTaskError } from '@deepseek-ai/dsh-worktree-task'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import GitWorktreeTask from '../src/index.ts'

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
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-task-git-')))
  roots.push(root)
  const repository = join(root, 'repository')
  const managed = join(root, 'managed')
  await mkdir(repository)
  await git(repository, 'init')
  await git(repository, 'config', 'user.name', 'Worktree Task Test')
  await git(repository, 'config', 'user.email', 'worktree-task-test@localhost')
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
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(GitWorktreeTask, {
    root: paths.managed,
    maxActiveCheckouts: options.maxActiveCheckouts ?? 4,
    commandTimeoutMs: 30_000,
  })
  return { ...paths, ctx, pool, service: ctx.worktreeTask }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0).reverse()) await rm(root, { recursive: true, force: true })
})

describe('GitWorktreeTask', () => {
  it('creates a task with a branch and worktree from a clean source', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-1')
    const task = await h.service.create({
      name: 'task-1',
      workspaceId,
      sourcePath: h.repository,
    })
    expect(task.status).toBe('active')
    expect(task.name).toBe('task-1')
    expect(task.workspaceId).toBe(workspaceId)
    expect(task.sourcePath).toBe(h.repository)
    expect(task.branch).toMatch(/^dsh\/task\//)
    expect(await readFile(join(task.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(await stat(task.checkoutPath)).toMatchObject({})
  }, 30_000)

  it('lists created tasks', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-list')
    await h.service.create({ name: 'task-a', workspaceId, sourcePath: h.repository })
    await h.service.create({ name: 'task-b', workspaceId, sourcePath: h.repository })
    const tasks = h.service.list()
    expect(tasks).toHaveLength(2)
    expect(tasks.map(t => t.name).sort()).toEqual(['task-a', 'task-b'])
  }, 30_000)

  it('gets a task by id', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-get')
    const created = await h.service.create({ name: 'task-get', workspaceId, sourcePath: h.repository })
    const found = h.service.get(created.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(() => h.service.get(WorktreeTaskIdLike('nonexistent'))).toThrow(WorktreeTaskError)
  }, 30_000)

  it('refuses to create from a dirty source', async () => {
    const h = await harness()
    await writeFile(join(h.repository, 'untracked.txt'), 'local\n')
    await expect(h.service.create({
      name: 'dirty',
      workspaceId: WorkspaceId('ws-dirty'),
      sourcePath: h.repository,
    })).rejects.toMatchObject({ code: 'git-failed' } satisfies Partial<WorktreeTaskError>)
  }, 30_000)

  it('binds and unbinds sessions', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-bind')
    const task = await h.service.create({ name: 'task-bind', workspaceId, sourcePath: h.repository })
    const sessionId = SessionId('session-1')
    const result = await h.service.bindSession({ taskId: task.id, sessionId })
    expect(result.task.sessionIds).toContain(sessionId)
    expect(result.checkoutPath).toBe(task.checkoutPath)
    expect(h.service.findForSession(sessionId)?.id).toBe(task.id)

    const after = await h.service.unbindSession(task.id, sessionId)
    expect(after!.sessionIds).not.toContain(sessionId)
    expect(h.service.findForSession(sessionId)).toBeUndefined()
  }, 30_000)

  it('hibernates and reactivates a task checkout', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-hibernate')
    const task = await h.service.create({ name: 'task-hib', workspaceId, sourcePath: h.repository })
    const hibernated = await h.service.hibernate({ taskId: task.id })
    expect(hibernated.status).toBe('hibernated')
    await expect(stat(task.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const reactivated = await h.service.activate({ taskId: task.id })
    expect(reactivated.status).toBe('active')
    expect(await readFile(join(reactivated.checkoutPath, 'tracked.txt'), 'utf8')).toBe('base\n')
  }, 30_000)

  it('refuses to hibernate a task with bound sessions', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-busy')
    const task = await h.service.create({ name: 'task-busy', workspaceId, sourcePath: h.repository })
    await h.service.bindSession({ taskId: task.id, sessionId: SessionId('session-busy') })
    await expect(h.service.hibernate({ taskId: task.id }))
      .rejects.toMatchObject({ code: 'busy' } satisfies Partial<WorktreeTaskError>)
  }, 30_000)

  it('archives a task after hibernating', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-archive')
    const task = await h.service.create({ name: 'task-arch', workspaceId, sourcePath: h.repository })
    const archived = await h.service.archive({ taskId: task.id })
    expect(archived.status).toBe('archived')
    await expect(stat(task.checkoutPath)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)

  it('deletes a task whose branch is merged into the base branch', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-delete')
    const task = await h.service.create({ name: 'task-del', workspaceId, sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'new.txt'), 'new\n')
    await git(task.checkoutPath, 'add', '--all')
    await git(task.checkoutPath, 'commit', '-m', 'task work')
    await git(h.repository, 'merge', '--no-ff', '-m', 'merge task', task.branch)
    const result = await h.service.delete({ taskId: task.id })
    expect(result.deleted).toBe(true)
    expect(() => h.service.get(task.id)).toThrow(WorktreeTaskError)
  }, 30_000)

  it('retains an unmerged branch on delete', async () => {
    const h = await harness()
    const workspaceId = WorkspaceId('ws-retain')
    const task = await h.service.create({ name: 'task-retain', workspaceId, sourcePath: h.repository })
    await writeFile(join(task.checkoutPath, 'new.txt'), 'new\n')
    await git(task.checkoutPath, 'add', '--all')
    await git(task.checkoutPath, 'commit', '-m', 'unmerged work')
    const result = await h.service.delete({ taskId: task.id })
    expect(result.deleted).toBe(false)
    expect(result.retainedBranch).toBe(task.branch)
  }, 30_000)

  it('enforces max active checkouts', async () => {
    const h = await harness({ maxActiveCheckouts: 1 })
    const workspaceId = WorkspaceId('ws-cap')
    const first = await h.service.create({ name: 'task-cap-1', workspaceId, sourcePath: h.repository })
    await h.service.bindSession({ taskId: first.id, sessionId: SessionId('session-cap') })
    await expect(h.service.create({ name: 'task-cap-2', workspaceId, sourcePath: h.repository }))
      .rejects.toMatchObject({ code: 'operation-failed' } satisfies Partial<WorktreeTaskError>)
    await h.service.unbindSession(first.id, SessionId('session-cap'))
    await h.service.hibernate({ taskId: first.id })
    const second = await h.service.create({ name: 'task-cap-2', workspaceId, sourcePath: h.repository })
    expect(second.status).toBe('active')
  }, 30_000)
})

function WorktreeTaskIdLike(value: string) {
  return value as unknown as ReturnType<typeof import('@deepseek-ai/dsh-worktree-task').WorktreeTaskId>
}
