import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence'
import WorkspaceRegistry, { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { WorktreeTaskId } from '@cinlan/worktree-task'
import type { WorktreeTask, WorktreeTaskChange } from '@cinlan/worktree-task'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorktreeTaskWorkspaces from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const header = (id: string, cwd: string): SessionHeader => ({
  version: SESSION_FORMAT_VERSION, id: SessionId(id), createdAt: 0, isSeeded: false, cwd,
})

async function harness(options: { tasks?: WorktreeTask[]; pool?: MemoryMediaPool; root?: string } = {}) {
  const root = options.root ?? await realpath(await mkdtemp(join(tmpdir(), 'dsh-task-workspace-')))
  if (options.root === undefined) roots.push(root)
  const source = join(root, 'repo')
  const checkout = join(root, 'managed', 'task-1')
  await mkdir(source, { recursive: true })
  await mkdir(checkout, { recursive: true })
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(options.pool ?? new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  let headers: SessionHeader[] = []
  ctx.provide('sessionPersistence', {
    list: async () => headers.map(h => ({ header: h, revision: SessionPersistenceRevision('rev-' + h.id) })),
  } as never)
  if (options.tasks !== undefined) ctx.provide('worktreeTask', { list: () => options.tasks } as never)
  await ctx.plugin(WorkspaceRegistry)
  const sourceWorkspace = await ctx.workspaceRegistry.create(source)
  await ctx.plugin(WorktreeTaskWorkspaces)
  const task = (patch: Partial<WorktreeTask> = {}): WorktreeTask => ({
    id: WorktreeTaskId('task-1'), name: 'fix-login', workspaceId: sourceWorkspace.id, sourcePath: source,
    baseRef: 'HEAD', branch: 'dsh/task/fix-login', checkoutPath: checkout, status: 'active',
    sessionIds: [], createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', ...patch,
  })
  const emit = async (change: WorktreeTaskChange) => {
    ctx.emit('worktree-task/changed', change)
    await ctx.worktreeTaskWorkspaces.settled()
  }
  return {
    ctx, root, source, checkout, sourceWorkspace, task, emit,
    bridge: ctx.worktreeTaskWorkspaces, registry: ctx.workspaceRegistry,
    setHeaders: (next: SessionHeader[]) => { headers = next },
  }
}

describe('WorktreeTaskWorkspaces', () => {
  it('registers a created checkout as a titled Workspace linked to its source', async () => {
    const h = await harness()
    const changed = vi.fn()
    h.ctx.on('worktree-task-workspaces/changed', changed)
    await h.emit({ transition: 'created', task: h.task() })
    const workspace = await h.registry.resolveByPath(h.checkout)
    expect(workspace?.title).toBe('fix-login')
    expect(h.bridge.links()).toEqual([{
      workspaceId: workspace?.id, taskId: 'task-1', parentWorkspaceId: h.sourceWorkspace.id, createdAt: expect.any(String),
    }])
    expect(changed).toHaveBeenCalledTimes(1)
    await h.emit({ transition: 'activated', task: h.task() })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('resolves the parent by source path when the recorded Workspace id is not registered', async () => {
    const h = await harness()
    await h.emit({ transition: 'created', task: h.task({ workspaceId: WorkspaceId('ws-team-root') }) })
    expect(h.bridge.links()[0]?.parentWorkspaceId).toBe(h.sourceWorkspace.id)
  })

  it('omits the parent when no Workspace owns the source path', async () => {
    const h = await harness()
    await h.registry.delete(h.sourceWorkspace.id)
    await h.emit({ transition: 'created', task: h.task() })
    expect(h.bridge.links()[0]).not.toHaveProperty('parentWorkspaceId')
  })

  it('keeps an existing Workspace title at the checkout path', async () => {
    const h = await harness()
    const existing = await h.registry.create(h.checkout)
    await existing.setTitle('mine')
    await h.emit({ transition: 'created', task: h.task() })
    expect(h.registry.get(existing.id)?.title).toBe('mine')
    expect(h.bridge.links()[0]?.workspaceId).toBe(existing.id)
  })

  it('skips a task whose checkout directory is absent', async () => {
    const h = await harness()
    await rm(h.checkout, { recursive: true })
    await h.emit({ transition: 'activated', task: h.task() })
    expect(h.bridge.links()).toEqual([])
  })

  it('backfills sessions whose cwd is the checkout once and attaches bound sessions', async () => {
    const h = await harness()
    h.setHeaders([header('loose', h.checkout), header('elsewhere', h.source), header('bound', h.checkout)])
    await h.emit({ transition: 'created', task: h.task() })
    const workspace = await h.registry.resolveByPath(h.checkout)
    expect(workspace?.sessionIds).toEqual(expect.arrayContaining([SessionId('loose'), SessionId('bound')]))
    expect(workspace?.sessionIds).not.toContain(SessionId('elsewhere'))

    h.setHeaders([header('later', h.checkout)])
    await h.emit({ transition: 'bound', task: h.task({ sessionIds: [SessionId('later')] }), sessionId: SessionId('later') })
    expect(h.registry.get(workspace!.id)?.sessionIds).toContain(SessionId('later'))
  })

  it('logs instead of failing when a bound session has no header yet', async () => {
    const h = await harness()
    await h.emit({ transition: 'bound', task: h.task(), sessionId: SessionId('pending') })
    const workspace = await h.registry.resolveByPath(h.checkout)
    expect(workspace?.sessionIds).toEqual([])
    expect(h.bridge.links()).toHaveLength(1)
  })

  it('keeps the registration and link through hibernation, archival, and deletion', async () => {
    const h = await harness()
    await h.emit({ transition: 'created', task: h.task() })
    for (const transition of ['unbound', 'hibernated', 'archived', 'deleted'] as const) {
      await h.emit({ transition, task: h.task({ status: transition === 'hibernated' ? 'hibernated' : 'archived' }) })
    }
    expect(h.bridge.links()).toHaveLength(1)
  })

  it('drops a link from the projection when the user deletes its Workspace', async () => {
    const h = await harness()
    await h.emit({ transition: 'created', task: h.task() })
    await h.registry.delete(h.bridge.links()[0]!.workspaceId)
    expect(h.bridge.links()).toEqual([])
  })

  it('links active tasks the provider already holds at startup', async () => {
    const pool = new MemoryMediaPool()
    const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-task-workspace-')))
    roots.push(root)
    const checkout = join(root, 'managed', 'task-1')
    const active = { id: WorktreeTaskId('task-1'), name: 'boot', workspaceId: WorkspaceId('x'), sourcePath: join(root, 'repo'),
      baseRef: 'HEAD', branch: 'b', checkoutPath: checkout, status: 'active', sessionIds: [],
      createdAt: '', updatedAt: '' } as WorktreeTask
    const h = await harness({ pool, root, tasks: [active, { ...active, id: WorktreeTaskId('task-2'), status: 'hibernated' }] })
    await h.bridge.settled()
    expect(h.bridge.links().map(link => link.taskId)).toEqual(['task-1'])
  })
})
