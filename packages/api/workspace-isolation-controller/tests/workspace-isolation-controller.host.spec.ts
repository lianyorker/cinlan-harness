import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import WorkspaceIsolation, {
  WorkspaceIsolationError,
  WorkspaceIsolationLeaseId,
} from '@deepseek-ai/dsh-workspace-isolation'
import type {
  EnsureWorkspaceIsolationRequest,
  WorkspaceIsolationComparison,
  WorkspaceIsolationInspection,
  WorkspaceIsolationIntegrationResult,
  WorkspaceIsolationLease,
  WorkspaceIsolationPatch,
  WorkspaceIsolationReservation,
  WorkspaceIsolationTeardownResult,
} from '@deepseek-ai/dsh-workspace-isolation'
import WorkspaceIsolationController from '../src/index.ts'

const roots: Context[] = []

function lease(phase: WorkspaceIsolationLease['phase'] = 'active'): WorkspaceIsolationLease {
  return {
    id: WorkspaceIsolationLeaseId('lease-1'),
    sessionId: SessionId('session-1'),
    sourcePath: 'C:/source/project',
    checkoutPath: 'C:/managed/lease-1/project',
    branch: 'dsh/session/lease-1',
    phase,
    reviewState: 'none',
    baseBranch: 'main',
    baseHead: 'base-head',
    head: 'current-head',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:01:00.000Z',
  }
}

class WorkspaceIsolationProbe extends WorkspaceIsolation {
  current: WorkspaceIsolationLease | undefined = lease()
  failure: unknown
  activationSignal: AbortSignal | undefined
  readonly activated: WorkspaceIsolationLease['id'][] = []
  readonly hibernated: WorkspaceIsolationLease['id'][] = []
  readonly inspected: WorkspaceIsolationLease['id'][] = []
  readonly compared: WorkspaceIsolationLease['id'][] = []
  readonly merged: WorkspaceIsolationLease['id'][] = []
  readonly cherryPicked: WorkspaceIsolationLease['id'][] = []
  readonly exported: WorkspaceIsolationLease['id'][] = []
  readonly tornDown: WorkspaceIsolationLease['id'][] = []
  retainOnTeardown = false

  async ensure(_request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationLease> {
    if (this.current === undefined) throw new Error('probe lease is absent')
    return { ...this.current, phase: 'active' }
  }

  async acquire(request: EnsureWorkspaceIsolationRequest): Promise<WorkspaceIsolationReservation> {
    return { lease: await this.ensure(request), release() {} }
  }

  async activate(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationLease> {
    this.activationSignal = signal
    signal?.throwIfAborted()
    this.activated.push(id)
    this.throwFailure()
    const current = this.require(id)
    this.current = { ...current, phase: 'active', updatedAt: '2026-09-03T00:02:00.000Z' }
    return this.current
  }

  async hibernate(id: WorkspaceIsolationLease['id']): Promise<WorkspaceIsolationLease> {
    this.hibernated.push(id)
    this.throwFailure()
    const current = this.require(id)
    this.current = { ...current, phase: 'hibernated', updatedAt: '2026-09-03T00:03:00.000Z' }
    return this.current
  }

  async inspect(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationInspection> {
    signal?.throwIfAborted()
    this.inspected.push(id)
    this.throwFailure()
    return {
      lease: this.require(id),
      checkoutState: 'dirty',
      branchHead: 'inspected-head',
      workingTreeChanges: [{ kind: 'modified', path: 'tracked.txt' }],
      hasUntrackedFiles: false,
    }
  }

  async compare(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationComparison> {
    signal?.throwIfAborted()
    this.compared.push(id)
    this.throwFailure()
    return {
      lease: this.require(id),
      targetHead: 'target-head',
      branchHead: 'branch-head',
      ahead: 1,
      behind: 2,
      commits: [{ id: 'commit-1', summary: 'Checkpoint' }],
      changedFiles: [{ kind: 'renamed', path: 'new.txt', previousPath: 'old.txt' }],
      patch: 'diff --git a/old.txt b/new.txt\n',
      patchTruncated: false,
      includesWorkingTree: true,
      hasUntrackedFiles: false,
    }
  }

  async merge(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationIntegrationResult> {
    signal?.throwIfAborted()
    this.merged.push(id)
    this.throwFailure()
    const current = this.require(id)
    this.current = { ...current, phase: 'hibernated', reviewState: 'none' }
    return { lease: this.current, targetBranch: current.baseBranch, targetHead: 'merged-head' }
  }

  async cherryPick(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationIntegrationResult> {
    signal?.throwIfAborted()
    this.cherryPicked.push(id)
    this.throwFailure()
    const current = this.require(id)
    this.current = { ...current, phase: 'hibernated', reviewState: 'none' }
    return { lease: this.current, targetBranch: current.baseBranch, targetHead: 'picked-head' }
  }

  async exportPatch(id: WorkspaceIsolationLease['id'], signal?: AbortSignal): Promise<WorkspaceIsolationPatch> {
    signal?.throwIfAborted()
    this.exported.push(id)
    this.throwFailure()
    this.require(id)
    return {
      leaseId: id,
      fileName: 'workspace-lease-1.patch',
      content: 'diff --git a/tracked.txt b/tracked.txt\n',
      includesWorkingTree: true,
      hasUntrackedFiles: false,
    }
  }

  async teardown(id: WorkspaceIsolationLease['id']): Promise<WorkspaceIsolationTeardownResult> {
    this.tornDown.push(id)
    this.throwFailure()
    const current = this.require(id)
    if (this.retainOnTeardown) {
      this.current = { ...current, phase: 'hibernated', reviewState: 'branch-retained' }
      return { status: 'review', lease: this.current, reason: 'unmerged-branch' }
    }
    this.current = undefined
    return { status: 'removed', leaseId: id }
  }

  async pruneOrphans(): Promise<number> {
    this.throwFailure()
    return 2
  }

  find(sessionId: ReturnType<typeof SessionId>): WorkspaceIsolationLease | undefined {
    return this.current?.sessionId === sessionId ? this.current : undefined
  }

  sourceFor(sessionId: ReturnType<typeof SessionId>, cwd: string): string | undefined {
    return this.current?.sessionId === sessionId && this.current.checkoutPath === cwd
      ? this.current.sourcePath
      : undefined
  }

  list(): readonly WorkspaceIsolationLease[] {
    this.throwFailure()
    return this.current === undefined ? [] : [this.current]
  }

  private require(id: WorkspaceIsolationLease['id']): WorkspaceIsolationLease {
    if (this.current === undefined || this.current.id !== id) {
      throw new WorkspaceIsolationError('LEASE_CONFLICT', 'unknown lease')
    }
    return this.current
  }

  private throwFailure(): void {
    if (this.failure !== undefined) throw this.failure
  }
}

async function harness(withProvider = true): Promise<{
  ctx: Context
  controller: WorkspaceIsolationController
  provider: WorkspaceIsolationProbe | undefined
}> {
  const ctx = new Context()
  roots.push(ctx)
  ctx.provide('typert', {
    lookups: { configure: () => () => {} },
    contexts: { configureHost: () => () => {} },
  } as never)
  let provider: WorkspaceIsolationProbe | undefined
  if (withProvider) {
    const fiber = ctx.plugin(WorkspaceIsolationProbe)
    await fiber.await()
    provider = ctx.workspaceIsolation as WorkspaceIsolationProbe
  }
  const controllerFiber = ctx.plugin(WorkspaceIsolationController)
  await controllerFiber.await()
  return { ctx, controller: ctx.workspaceIsolationController, provider }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('WorkspaceIsolationController', () => {
  it('keeps the namespace mounted and reports provider absence explicitly', async () => {
    const { ctx, controller } = await harness(false)
    expect(ctx.get('workspaceIsolationController') !== undefined).toBe(true)
    await expect(Promise.resolve().then(() => controller.list(new AbortController().signal)))
      .rejects.toMatchObject({ code: 'workspace-isolation/unavailable', details: {} })
    await expect(controller.teardown(
      { leaseId: WorkspaceIsolationLeaseId('lease-1') },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'workspace-isolation/unavailable' })
  })

  it('projects detached lease fields and delegates lifecycle operations by opaque id', async () => {
    const { controller, provider } = await harness()
    if (provider === undefined || provider.current === undefined) throw new Error('provider missing')
    const id = provider.current.id
    const signal = new AbortController().signal

    const listed = controller.list(signal)
    expect(listed).toEqual({ items: [{
      leaseId: id,
      sessionId: provider.current.sessionId,
      sourcePath: 'C:/source/project',
      checkoutPath: 'C:/managed/lease-1/project',
      branch: 'dsh/session/lease-1',
      phase: 'active',
      reviewState: 'none',
      baseBranch: 'main',
      baseHead: 'base-head',
      head: 'current-head',
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:01:00.000Z',
    }] })
    provider.current = { ...provider.current, branch: 'changed-after-list' }
    expect(listed.items[0]?.branch).toBe('dsh/session/lease-1')

    await expect(controller.hibernate({ leaseId: id }, signal))
      .resolves.toMatchObject({ lease: { leaseId: id, phase: 'hibernated' } })
    await expect(controller.activate({ leaseId: id }, signal))
      .resolves.toMatchObject({ lease: { leaseId: id, phase: 'active' } })
    expect(provider.activationSignal).toBe(signal)
    await expect(controller.inspect({ leaseId: id }, signal)).resolves.toEqual({
      inspection: {
        lease: expect.objectContaining({ leaseId: id }),
        checkoutState: 'dirty',
        branchHead: 'inspected-head',
        workingTreeChanges: [{ kind: 'modified', path: 'tracked.txt' }],
        hasUntrackedFiles: false,
      },
    })
    await expect(controller.compare({ leaseId: id }, signal)).resolves.toMatchObject({
      comparison: {
        targetHead: 'target-head',
        branchHead: 'branch-head',
        ahead: 1,
        behind: 2,
        changedFiles: [{ kind: 'renamed', path: 'new.txt', previousPath: 'old.txt' }],
        patchTruncated: false,
      },
    })
    await expect(controller.exportPatch({ leaseId: id }, signal)).resolves.toEqual({
      leaseId: id,
      fileName: 'workspace-lease-1.patch',
      content: 'diff --git a/tracked.txt b/tracked.txt\n',
      includesWorkingTree: true,
      hasUntrackedFiles: false,
    })
    await expect(controller.merge({ leaseId: id }, signal)).resolves.toMatchObject({
      lease: { leaseId: id, phase: 'hibernated' },
      targetBranch: 'main',
      targetHead: 'merged-head',
    })
    await expect(controller.cherryPick({ leaseId: id }, signal)).resolves.toMatchObject({
      targetBranch: 'main',
      targetHead: 'picked-head',
    })
    await expect(controller.prune(signal)).resolves.toEqual({ pruned: 2 })
    await expect(controller.teardown({ leaseId: id }, signal))
      .resolves.toEqual({ status: 'removed', leaseId: id })
    expect(provider.hibernated).toEqual([id])
    expect(provider.activated).toEqual([id])
    expect(provider.inspected).toEqual([id])
    expect(provider.compared).toEqual([id])
    expect(provider.exported).toEqual([id])
    expect(provider.merged).toEqual([id])
    expect(provider.cherryPicked).toEqual([id])
    expect(provider.tornDown).toEqual([id])
  })

  it('projects a safe teardown refusal as retained review state', async () => {
    const { controller, provider } = await harness()
    if (provider === undefined || provider.current === undefined) throw new Error('provider missing')
    provider.retainOnTeardown = true
    const id = provider.current.id

    await expect(controller.teardown({ leaseId: id }, new AbortController().signal)).resolves.toMatchObject({
      status: 'review',
      reason: 'unmerged-branch',
      lease: { leaseId: id, phase: 'hibernated', reviewState: 'branch-retained' },
    })
    expect(provider.current).toMatchObject({ id, reviewState: 'branch-retained' })
  })

  it('maps busy, conflict, unavailable, and other provider failures without parsing messages', async () => {
    const { controller, provider } = await harness()
    if (provider === undefined) throw new Error('provider missing')
    const id = WorkspaceIsolationLeaseId('lease-1')
    const signal = new AbortController().signal

    provider.failure = new WorkspaceIsolationError('LEASE_BUSY', 'session is live')
    await expect(controller.hibernate({ leaseId: id }, signal)).rejects.toMatchObject({
      code: 'workspace-isolation/busy',
      details: { operation: 'hibernate', leaseId: id },
    })
    provider.failure = new WorkspaceIsolationError('LEASE_CONFLICT', 'lease moved')
    await expect(controller.teardown({ leaseId: id }, signal)).rejects.toMatchObject({
      code: 'workspace-isolation/conflict',
      details: { operation: 'teardown', leaseId: id },
    })
    provider.failure = new WorkspaceIsolationError('UNAVAILABLE', 'provider stopped')
    expect(() => controller.list(signal)).toThrow(expect.objectContaining({
      code: 'workspace-isolation/unavailable',
    }))
    provider.failure = new WorkspaceIsolationError('COMMAND_FAILED', 'git failed')
    await expect(controller.prune(signal)).rejects.toMatchObject({
      code: 'workspace-isolation/operation-failed',
      details: { operation: 'prune', providerCode: 'COMMAND_FAILED' },
    })
  })

  it('forwards activation cancellation and checks other signals only before admission', async () => {
    const { controller, provider } = await harness()
    if (provider === undefined) throw new Error('provider missing')
    const id = WorkspaceIsolationLeaseId('lease-1')
    const aborted = AbortSignal.abort(new Error('caller left'))
    await expect(controller.activate({ leaseId: id }, aborted)).rejects.toMatchObject({
      code: 'gateway/cancelled', details: {},
    })
    expect(provider.activated).toEqual([])

    const admitted = new AbortController()
    let rejectHibernate!: (error: unknown) => void
    provider.hibernate = () => new Promise((_resolve, reject) => { rejectHibernate = reject })
    const pending = controller.hibernate({ leaseId: id }, admitted.signal)
    admitted.abort(new Error('late cancellation'))
    rejectHibernate(new WorkspaceIsolationError('LEASE_CONFLICT', 'changed during hibernate'))
    await expect(pending).rejects.toMatchObject({ code: 'workspace-isolation/conflict' })
  })

  it('preserves unexpected implementation faults for gateway/internal classification', async () => {
    const { controller, provider } = await harness()
    if (provider === undefined) throw new Error('provider missing')
    const fault = new TypeError('programmer fault')
    provider.failure = fault
    await expect(controller.prune(new AbortController().signal)).rejects.toBe(fault)
  })
})


