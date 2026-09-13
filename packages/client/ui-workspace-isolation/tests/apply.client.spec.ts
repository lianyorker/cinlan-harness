// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorkspaceIsolationLeaseId,
  WorkspaceIsolationLeaseView,
} from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import {
  WorkspaceIsolationSection,
  type WorkspaceIsolationSectionInjected,
} from '../src/client/WorkspaceIsolationSection.tsx'

function lease(): WorkspaceIsolationLeaseView {
  return {
    leaseId: 'lease-1' as WorkspaceIsolationLeaseId,
    sessionId: 'session-1' as WorkspaceIsolationLeaseView['sessionId'],
    sourcePath: '/source',
    checkoutPath: '/managed/lease-1',
    branch: 'dsh/session/lease-1',
    phase: 'active',
    reviewState: 'none',
    baseBranch: 'main',
    baseHead: 'base',
    head: 'head',
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt: '2026-09-03T00:01:00.000Z',
  }
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const current = lease()
  const list = vi.fn(async () => ({ ok: true as const, value: { items: [current] } }))
  const activate = vi.fn(async () => ({ ok: true as const, value: { lease: current } }))
  const hibernate = vi.fn(async () => ({ ok: true as const, value: { lease: { ...current, phase: 'hibernated' as const } } }))
  const inspect = vi.fn(async () => ({ ok: true as const, value: { inspection: {
    lease: current,
    checkoutState: 'clean' as const,
    branchHead: current.head,
    workingTreeChanges: [],
    hasUntrackedFiles: false,
  } } }))
  const compare = vi.fn(async () => ({ ok: true as const, value: { comparison: {
    lease: current,
    targetHead: current.baseHead,
    branchHead: current.head,
    ahead: 0,
    behind: 0,
    commits: [],
    changedFiles: [],
    patch: '',
    patchTruncated: false,
    includesWorkingTree: true,
    hasUntrackedFiles: false,
  } } }))
  const merge = vi.fn(async () => ({ ok: true as const, value: {
    lease: { ...current, phase: 'hibernated' as const },
    targetBranch: current.baseBranch,
    targetHead: current.head,
  } }))
  const cherryPick = vi.fn(async () => ({ ok: true as const, value: {
    lease: { ...current, phase: 'hibernated' as const },
    targetBranch: current.baseBranch,
    targetHead: current.head,
  } }))
  const exportPatch = vi.fn(async () => ({ ok: true as const, value: {
    leaseId: current.leaseId,
    fileName: 'workspace-lease-1.patch',
    content: '',
    includesWorkingTree: true,
    hasUntrackedFiles: false,
  } }))
  const teardown = vi.fn(async () => ({ ok: true as const, value: {
    status: 'removed' as const,
    leaseId: current.leaseId,
  } }))
  const prune = vi.fn(async () => ({ ok: true as const, value: { pruned: 2 } }))
  const remote = { list, activate, hibernate, inspect, compare, merge, cherryPick, exportPatch, teardown, prune }
  ctx.provide('remote', { $host: { home: undefined, isLoopback }, workspaceIsolation: remote } as never)
  ctx.provide('remote.workspaceIsolation', remote as never)
  await ctx.plugin(SlotRegistry).await()
  return {
    ctx, locale, slots: ctx.slots, list, activate, hibernate, inspect, compare,
    merge, cherryPick, exportPatch, teardown, prune, current,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-workspace-isolation registration', () => {
  it('declares the generated Remote and presentation services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.workspaceIsolation'])
  })

  it('registers one localized section without eager reads or a removed icon slot', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(WorkspaceIsolationSection)
    expect(section.options).toMatchObject({ id: 'workspace-isolation', order: 15 })
    expect(section.locale).toBe('settings.workspaceIsolation')
    expect(resolveSlotLabel(section.options.label)).toBe('隔离工作区')
    expect(b.list).not.toHaveBeenCalled()

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Workspace isolation')
    hostApply()
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    await b.ctx.fiber.dispose()
  })

  it('routes callbacks through generated Remotes with opaque ids and exact signals', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('settings.section')[0]!
    const callbacks = (entry.inject as unknown as () => WorkspaceIsolationSectionInjected)()
    const signal = new AbortController().signal

    await expect(callbacks.list(signal)).resolves.toEqual([b.current])
    await callbacks.activate(b.current.leaseId, signal)
    await callbacks.hibernate(b.current.leaseId, signal)
    await expect(callbacks.inspect(b.current.leaseId, signal)).resolves.toMatchObject({ checkoutState: 'clean' })
    await expect(callbacks.compare(b.current.leaseId, signal)).resolves.toMatchObject({ patch: '' })
    await expect(callbacks.merge(b.current.leaseId, signal)).resolves.toMatchObject({ targetBranch: 'main' })
    await expect(callbacks.cherryPick(b.current.leaseId, signal)).resolves.toMatchObject({ targetBranch: 'main' })
    await expect(callbacks.exportPatch(b.current.leaseId, signal)).resolves.toMatchObject({
      fileName: 'workspace-lease-1.patch',
    })
    await expect(callbacks.teardown(b.current.leaseId, signal)).resolves.toMatchObject({ status: 'removed' })
    await expect(callbacks.prune(signal)).resolves.toBe(2)

    expect(b.list).toHaveBeenCalledWith(signal)
    expect(b.activate).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.hibernate).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.inspect).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.compare).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.merge).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.cherryPick).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.exportPatch).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.teardown).toHaveBeenCalledWith({ leaseId: b.current.leaseId }, signal)
    expect(b.prune).toHaveBeenCalledWith(signal)
    await b.ctx.fiber.dispose()
  })

  it('maps unavailable, busy, conflict, cancellation, and generic Remote failures', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const callbacks = (b.slots.entries('settings.section')[0]!.inject as unknown as () => WorkspaceIsolationSectionInjected)()
    const signal = new AbortController().signal
    const failures = [
      { method: b.list, call: () => callbacks.list(signal), error: { code: 'workspace-isolation/unavailable', message: 'missing', details: {} }, expected: '当前 Host 未启用工作区隔离 Provider。' },
      { method: b.hibernate, call: () => callbacks.hibernate(b.current.leaseId, signal), error: { code: 'workspace-isolation/busy', message: 'busy', details: { operation: 'hibernate', leaseId: b.current.leaseId } }, expected: '该 Session 仍处于活动状态，Provider 已拒绝修改其租约。' },
      { method: b.activate, call: () => callbacks.activate(b.current.leaseId, signal), error: { code: 'workspace-isolation/conflict', message: 'gone', details: { operation: 'activate', leaseId: b.current.leaseId } }, expected: '租约或 Git ownership 已经变化，请刷新后重试。' },
      { method: b.teardown, call: () => callbacks.teardown(b.current.leaseId, signal), error: { code: 'gateway/cancelled', message: 'cancelled', details: {} }, expected: '操作已取消。' },
      { method: b.prune, call: () => callbacks.prune(signal), error: { code: 'gateway/internal', message: 'disk offline', details: {} }, expected: '工作区隔离操作失败：disk offline' },
    ] as const

    for (const entry of failures) {
      entry.method.mockResolvedValueOnce({ ok: false as const, error: entry.error } as never)
      await expect(entry.call()).rejects.toThrow(entry.expected)
    }
    await b.ctx.fiber.dispose()
  })

  it('withholds the section from a non-loopback Host', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.list).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('waits for the settings declaration and follows its lifetime', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])

    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    release()
    expect(b.slots.entries('settings.section')).toEqual([])
    declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    await b.ctx.fiber.dispose()
  })
})

