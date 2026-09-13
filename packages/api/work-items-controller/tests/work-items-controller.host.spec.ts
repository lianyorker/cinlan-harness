import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkItemsRuntime, { WorkItemsError } from '@deepseek-ai/dsh-work-items'
import type { WorkItem, WorkItemsProvider } from '@deepseek-ai/dsh-work-items'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkItemsController from '../src/index.ts'
import type { WorkItemId } from '../src/types.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const roots: Context[] = []
const tempDirs: string[] = []

const item: WorkItem = {
  id: 'github:acme/repo#1' as WorkItemId,
  source: 'github',
  externalId: '1',
  key: 'acme/repo#1',
  title: 'Fix the harness',
  state: 'open',
  url: 'https://github.com/acme/repo/issues/1',
  repository: 'acme/repo',
  labels: ['bug'],
  assignees: [],
}

async function harness(overrides: Partial<WorkItemsProvider> = {}): Promise<{
  ctx: Context
  controller: WorkItemsController
  root: string
  disposeController: () => Promise<void>
}> {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-work-items-controller-')))
  tempDirs.push(root)
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const domain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', domain)
  ctx.provide('storageDomain', domain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkItemsRuntime)
  const provider: WorkItemsProvider = {
    id: 'github',
    available: () => true,
    list: async () => ({ items: [item], truncated: false }),
    get: async () => item,
    ...overrides,
  }
  ctx.workItems.registerProvider(provider)
  await ctx.plugin(WorkspaceRegistry)
  ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} } } as never)
  const controllerFiber = ctx.plugin(WorkItemsController)
  await controllerFiber.await()
  return { ctx, controller: ctx.workItemsController, root, disposeController: () => controllerFiber.dispose() }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('WorkItemsController', () => {
  it('unlinks without contacting an unavailable provider', async () => {
    let available = true
    const { controller, ctx, root } = await harness({ get: async () => {
      if (!available) throw new WorkItemsError('unavailable', 'Provider offline')
      return item
    } })
    const workspace = await ctx.workspaceRegistry.create(root)
    const request = { id: item.id, workspaceId: workspace.id }
    const signal = new AbortController().signal
    await controller.associate(request, signal)
    available = false
    await expect(controller.get({ id: item.id }, signal)).rejects.toMatchObject({ code: 'work-items/operation-failed' })
    await expect(controller.disassociate(request, signal)).resolves.toEqual({ associations: [] })
    available = true
    expect((await controller.get({ id: item.id }, signal)).associations).toHaveLength(0)
  })

  it('does not commit an association after the caller cancels its provider read', async () => {
    let resolve!: (value: WorkItem) => void
    const pending = new Promise<WorkItem>((done) => { resolve = done })
    const { controller, ctx, root } = await harness({ get: () => pending })
    const workspace = await ctx.workspaceRegistry.create(root)
    const cancel = new AbortController()
    const outcome = controller.associate({ id: item.id, workspaceId: workspace.id }, cancel.signal)
    const rejected = expect(outcome).rejects.toMatchObject({ code: 'work-items/operation-failed', details: { providerCode: 'aborted' } })
    cancel.abort()
    resolve(item)
    await rejected
    expect((await controller.get({ id: item.id }, new AbortController().signal)).associations).toHaveLength(0)
  })

  it('retains idempotent links across controller reload and hides deleted Workspace links', async () => {
    const { ctx, controller, root, disposeController } = await harness()
    const workspace = await ctx.workspaceRegistry.create(root)
    const request = { id: item.id, workspaceId: workspace.id }
    const signal = new AbortController().signal
    await controller.associate(request, signal)
    expect((await controller.associate(request, signal)).associations).toHaveLength(1)
    await disposeController()
    await ctx.plugin(WorkItemsController)
    expect((await ctx.workItemsController.get({ id: item.id }, signal)).associations).toHaveLength(1)
    await ctx.workspaceRegistry.delete(workspace.id)
    expect((await ctx.workItemsController.get({ id: item.id }, signal)).associations).toHaveLength(0)
    const replacement = await ctx.workspaceRegistry.create(root)
    expect(replacement.id).not.toBe(workspace.id)
    expect((await ctx.workItemsController.get({ id: item.id }, signal)).associations).toHaveLength(0)
    await ctx.workItemsController.disassociate(request, signal)
    expect((await ctx.workItemsController.get({ id: item.id }, signal)).associations).toHaveLength(0)
  })

  it('rejects a foreign Session before reading the provider', async () => {
    let reads = 0
    const { controller, ctx, root } = await harness({ get: async () => { reads++; return item } })
    const workspace = await ctx.workspaceRegistry.create(root)
    await expect(controller.associate({ id: item.id, workspaceId: workspace.id, sessionId: SessionId('foreign') }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'work-items/invalid-association' })
    expect(reads).toBe(0)
  })

  it('revalidates Workspace ownership after a provider read completes', async () => {
    let resolve!: (value: WorkItem) => void
    const pending = new Promise<WorkItem>((done) => { resolve = done })
    const { controller, ctx, root } = await harness({ get: () => pending })
    const workspace = await ctx.workspaceRegistry.create(root)
    const association = controller.associate({ id: item.id, workspaceId: workspace.id }, new AbortController().signal)
    const rejected = expect(association).rejects.toMatchObject({ code: 'workspace/not-found' })
    await ctx.workspaceRegistry.delete(workspace.id)
    resolve(item)
    await rejected
    expect((await controller.get({ id: item.id }, new AbortController().signal)).associations).toHaveLength(0)
  })

  it('rejects mismatched details through both read and association Remote methods', async () => {
    const { controller, ctx, root } = await harness({ get: async () => ({ ...item, id: 'github:acme/repo#other' as WorkItemId }) })
    const workspace = await ctx.workspaceRegistry.create(root)
    for (const operation of [
      () => controller.get({ id: item.id }, new AbortController().signal),
      () => controller.associate({ id: item.id, workspaceId: workspace.id }, new AbortController().signal),
    ]) await expect(operation()).rejects.toMatchObject({ code: 'work-items/operation-failed', details: { providerCode: 'invalid-response' } })
  })

  it('projects durable item associations through list and get', async () => {
    const { controller, ctx, root } = await harness()
    const created = await ctx.workspaceRegistry.create(root)
    if (created === undefined) throw new Error('workspace was not registered')
    const session = ctx.sessions.create(SessionId('session-1'), { meta: { cwd: root } })
    await created.attachSession(session.id)
    const association = await controller.associate(
      { id: item.id, workspaceId: created.id, sessionId: session.id }, new AbortController().signal)
    expect(association.associations).toEqual([{
      workspaceId: created.id,
      workspaceTitle: root.split(/[\\/]/).at(-1),
      sessionId: session.id,
    }])
    await expect(controller.get({ id: item.id }, new AbortController().signal)).resolves.toMatchObject({
      id: item.id,
      associations: association.associations,
    })
    await expect(controller.list({ workspaceId: created.id }, new AbortController().signal)).resolves.toMatchObject({
      items: [{ id: item.id, associations: association.associations }],
    })
  })

  it('hides archived Session links and refuses new links without losing Workspace associations', async () => {
    const { controller, ctx, root } = await harness()
    const workspace = await ctx.workspaceRegistry.create(root)
    const session = ctx.sessions.create(SessionId('archived-session'), { meta: { cwd: root } })
    await workspace.attachSession(session.id)
    const signal = new AbortController().signal
    const request = { id: item.id, workspaceId: workspace.id, sessionId: session.id }
    await controller.associate({ id: item.id, workspaceId: workspace.id }, signal)
    await controller.associate(request, signal)
    expect((await controller.get({ id: item.id }, signal)).associations).toHaveLength(2)
    await ctx.workspaceRegistry.archiveSession(session.id)
    expect((await controller.get({ id: item.id }, signal)).associations).toEqual([
      { workspaceId: workspace.id, workspaceTitle: workspace.title },
    ])
    await expect(controller.associate(request, signal)).rejects.toMatchObject({ code: 'work-items/invalid-association' })
    await controller.disassociate(request, signal)
  })

  it('rejects new links for deleted Workspaces and preserves safe Remote errors', async () => {
    const { controller, ctx, root } = await harness()
    const workspace = await ctx.workspaceRegistry.create(root)
    if (workspace === undefined) throw new Error('workspace was not registered')
    await ctx.workspaceRegistry.delete(workspace.id)
    await expect(controller.associate({ id: item.id, workspaceId: workspace.id }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'workspace/not-found' })
  })
})
