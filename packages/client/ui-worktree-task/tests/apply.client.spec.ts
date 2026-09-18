// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WorktreeTaskView,
} from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import type { WorktreeTaskId } from '@deepseek-ai/dsh-worktree-task/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import {
  WorktreeTaskSection,
  type WorktreeTaskSectionInjected,
} from '../src/client/WorktreeTaskSection.tsx'

function task(): WorktreeTaskView {
  return {
    taskId: 'task-1' as WorktreeTaskId,
    name: 'Fix login',
    workspaceId: 'default' as WorkspaceId,
    sourcePath: '/source',
    branch: 'dsh/task/task-1',
    baseRef: 'main',
    checkoutPath: '/managed/task-1',
    status: 'active',
    sessionIds: ['session-1' as WorktreeTaskView['sessionIds'][number]],
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:01:00.000Z',
  }
}

async function bench(isLoopback = true) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  new SettingsMetadataService(ctx)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const current = task()
  const create = vi.fn(async () => ({ ok: true as const, value: { task: current } }))
  const list = vi.fn(async () => ({ ok: true as const, value: { items: [current] } }))
  const activate = vi.fn(async () => ({ ok: true as const, value: { task: current } }))
  const hibernate = vi.fn(async () => ({ ok: true as const, value: { task: { ...current, status: 'hibernated' as const } } }))
  const archive = vi.fn(async () => ({ ok: true as const, value: { task: { ...current, status: 'archived' as const } } }))
  const remove = vi.fn(async () => ({ ok: true as const, value: { status: 'deleted' as const, taskId: current.taskId } }))
  const settingsValue = { revision: 2, managedRoot: '/managed', value: { defaultDirectory: 'team', baseRef: 'main', setup: null, cleanup: null } }
  const settings = vi.fn(async () => ({ ok: true as const, value: settingsValue }))
  const updateSettings = vi.fn(async () => ({ ok: true as const, value: { ...settingsValue, revision: 3 } }))
  const review = vi.fn(async () => ({ ok: true as const, value: { taskId: current.taskId, baseHead: 'a', head: 'b',
    checkoutRoot: '/managed', dirty: false, patch: '', untracked: [], setup: null, cleanup: null } }))
  const remote = { create, list, settings, updateSettings, review, activate, hibernate, archive, delete: remove }
  ctx.provide('remote', { $host: { home: undefined, isLoopback }, worktreeTasks: remote } as never)
  ctx.provide('remote.worktreeTasks', remote as never)
  await ctx.plugin(SlotRegistry).await()
  return {
    ctx, locale, slots: ctx.slots, create, list, settings, settingsValue, updateSettings,
    review, activate, hibernate, archive, remove, current,
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-worktree-task registration', () => {
  it('declares the generated Remote and presentation services it uses', () => {
    expect(inject).toEqual(['settingsMetadata', 'slots', 'locale', 'remote', 'remote.worktreeTasks'])
  })

  it('registers one localized section without eager reads', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const section = b.slots.entries('settings.section')[0]!
    expect(section.component).toBe(WorktreeTaskSection)
    expect(b.ctx.settingsMetadata.getSnapshot().sections).toEqual([{ sectionId: 'worktree-task', groupId: 'development' }])
    expect(section.options).toMatchObject({ id: 'worktree-task', order: 60 })
    expect(section.locale).toBe('settings.worktreeTask')
    expect(resolveSlotLabel(section.options.label)).toBe('工作树任务')
    expect(b.list).not.toHaveBeenCalled()
    expect(b.settings).not.toHaveBeenCalled()
    expect(b.review).not.toHaveBeenCalled()
    const items = b.ctx.settingsMetadata.getSnapshot().items
    expect(items).toHaveLength(11)
    expect(items.find(item => item.id === 'create-workspace')?.title).toBe('工作区')
    expect(JSON.stringify(items)).not.toContain('/source')

    b.locale.setLocale('en')
    expect(resolveSlotLabel(section.options.label)).toBe('Worktree tasks')
    const base = b.ctx.settingsMetadata.getSnapshot().items.find(item => item.id === 'create-base')
    expect(base?.title).toBe('Starting point (optional)')
    hostApply()
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    await b.ctx.fiber.dispose()
  })

  it('routes callbacks through generated Remotes with opaque ids and exact signals', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const callbacks = (b.slots.entries('settings.section')[0]!.inject as unknown as () => WorktreeTaskSectionInjected)()
    const signal = new AbortController().signal

    await expect(callbacks.list(signal)).resolves.toEqual([b.current])
    await expect(callbacks.create({ name: 'x', workspaceId: 'default' as WorkspaceId, sourcePath: '/source' }, signal)).resolves.toEqual(b.current)
    await expect(callbacks.settings(signal)).resolves.toEqual(b.settingsValue)
    await callbacks.updateSettings({ expectedRevision: 2, value: b.settingsValue.value }, signal)
    await callbacks.review(b.current.taskId, signal)
    expect(b.settings).toHaveBeenCalledWith(signal)
    expect(b.updateSettings).toHaveBeenCalledWith({ expectedRevision: 2, value: b.settingsValue.value }, signal)
    expect(b.review).toHaveBeenCalledWith({ taskId: b.current.taskId }, signal)
    await callbacks.activate(b.current.taskId, signal)
    await callbacks.hibernate(b.current.taskId, signal)
    await callbacks.archive(b.current.taskId, signal)
    await expect(callbacks.delete(b.current.taskId, signal)).resolves.toMatchObject({ status: 'deleted' })

    expect(b.list).toHaveBeenCalledWith(signal)
    expect(b.activate).toHaveBeenCalledWith({ taskId: b.current.taskId }, signal)
    expect(b.hibernate).toHaveBeenCalledWith({ taskId: b.current.taskId }, signal)
    expect(b.archive).toHaveBeenCalledWith({ taskId: b.current.taskId }, signal)
    expect(b.remove).toHaveBeenCalledWith({ taskId: b.current.taskId }, signal)
    await b.ctx.fiber.dispose()
  })

  it('maps unavailable, not-found, busy, cancellation, and generic Remote failures', async () => {
    const b = await bench()
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const callbacks = (b.slots.entries('settings.section')[0]!.inject as unknown as () => WorktreeTaskSectionInjected)()
    const signal = new AbortController().signal
    const failures = [
      { method: b.list, call: () => callbacks.list(signal), code: 'worktree-task/unavailable', expected: '当前 Host 未启用工作树任务 Provider。' },
      { method: b.activate, call: () => callbacks.activate(b.current.taskId, signal), code: 'worktree-task/not-found', expected: '未找到该工作树任务。' },
      { method: b.hibernate, call: () => callbacks.hibernate(b.current.taskId, signal), code: 'worktree-task/busy', expected: '该任务仍有绑定的 Session，无法休眠或归档。' },
      { method: b.archive, call: () => callbacks.archive(b.current.taskId, signal), code: 'gateway/cancelled', expected: '操作已取消。' },
      { method: b.remove, call: () => callbacks.delete(b.current.taskId, signal), code: 'gateway/internal', message: 'disk offline', expected: '工作树任务操作失败：disk offline' },
    ] as const

    for (const entry of failures) {
      const message = (entry as { message?: string }).message ?? entry.code
      entry.method.mockResolvedValueOnce({ ok: false as const, error: { code: entry.code, message, details: {} } } as never)
      await expect(entry.call()).rejects.toThrow(entry.expected)
    }
    await b.ctx.fiber.dispose()
  })

  it('withholds the section from a non-loopback Host', async () => {
    const b = await bench(false)
    declare(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
    expect(b.list).not.toHaveBeenCalled()
    await b.ctx.fiber.dispose()
  })

  it('waits for the settings declaration and follows its lifetime', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toEqual([])
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })

    const release = declare(b.slots)
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toHaveLength(1) })
    expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(11)
    release()
    await vi.waitFor(() => { expect(b.slots.entries('settings.section')).toEqual([]) })
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    declare(b.slots)
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(11) })
    await fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    await b.ctx.fiber.dispose()
  })
})
