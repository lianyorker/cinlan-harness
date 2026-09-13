// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type {
  WorkspaceIsolationLeaseId, WorkspaceIsolationLeaseView,
} from '@deepseek-ai/dsh-api-workspace-isolation-controller/types'
import {
  WorkspaceIsolationSection,
  type WorkspaceIsolationSectionProps,
} from '../src/client/WorkspaceIsolationSection.tsx'
import { en, type WorkspaceIsolationKey } from '../src/client/locales.ts'

afterEach(cleanup)

const css = readFileSync(
  resolve('packages/client/ui-workspace-isolation/src/client/WorkspaceIsolationSection.module.css'),
  'utf8',
)

function translate(
  key: WorkspaceIsolationKey,
  params: Record<string, string | number> = {},
): string {
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll('{' + name + '}', String(value)),
    en[key],
  )
}

function lease(
  id: string,
  phase: WorkspaceIsolationLeaseView['phase'],
  updatedAt: string,
): WorkspaceIsolationLeaseView {
  return {
    leaseId: id as WorkspaceIsolationLeaseId,
    sessionId: ('session-' + id) as WorkspaceIsolationLeaseView['sessionId'],
    sourcePath: '/source/' + id,
    checkoutPath: '/managed/' + id,
    branch: 'dsh/session/' + id,
    phase,
    reviewState: 'none',
    baseBranch: 'main',
    baseHead: 'base-' + id,
    head: 'head-' + id,
    createdAt: '2026-09-03T00:00:00.000Z',
    updatedAt,
  }
}

function props(overrides: Partial<WorkspaceIsolationSectionProps> = {}): WorkspaceIsolationSectionProps {
  const fallback = lease('fallback', 'active', '2026-09-03T00:01:00.000Z')
  return {
    close: vi.fn(),
    list: vi.fn(async () => []),
    activate: vi.fn(async () => {}),
    hibernate: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({
      lease: fallback,
      checkoutState: 'clean',
      branchHead: fallback.head,
      workingTreeChanges: [],
      hasUntrackedFiles: false,
    })),
    compare: vi.fn(async () => ({
      lease: fallback,
      targetHead: fallback.baseHead,
      branchHead: fallback.head,
      ahead: 0,
      behind: 0,
      commits: [],
      changedFiles: [],
      patch: '',
      patchTruncated: false,
      includesWorkingTree: true,
      hasUntrackedFiles: false,
    })),
    merge: vi.fn(async () => ({ lease: fallback, targetBranch: 'main', targetHead: fallback.head })),
    cherryPick: vi.fn(async () => ({ lease: fallback, targetBranch: 'main', targetHead: fallback.head })),
    exportPatch: vi.fn(async () => ({
      leaseId: fallback.leaseId,
      fileName: 'workspace-fallback.patch',
      content: '',
      includesWorkingTree: true,
      hasUntrackedFiles: false,
    })),
    teardown: vi.fn(async () => ({ status: 'removed', leaseId: fallback.leaseId })),
    prune: vi.fn(async () => 0),
    t: translate,
    ...overrides,
  } as unknown as WorkspaceIsolationSectionProps
}

describe('WorkspaceIsolationSection', () => {
  it('renders authoritative phases, summary counts, paths, and newest-first lease order', async () => {
    const active = lease('active', 'active', '2026-09-03T00:01:00.000Z')
    const hibernated = lease('hibernated', 'hibernated', '2026-09-03T00:02:00.000Z')
    render(<WorkspaceIsolationSection {...props({ list: vi.fn(async () => [active, hibernated]) })} />)

    await screen.findByText('session-hibernated')
    const cards = screen.getAllByRole('listitem')
    expect(cards[0]?.textContent).toContain('session-hibernated')
    expect(cards[1]?.textContent).toContain('session-active')
    expect(screen.getByText('/managed/hibernated')).not.toBeNull()
    const summary = screen.getByLabelText(en.total)
    expect(within(summary).getByText('2')).not.toBeNull()
    expect(within(summary).getByText(en.activeCount)).not.toBeNull()
    expect(within(summary).getByText(en.hibernatedCount)).not.toBeNull()
    expect(screen.getByRole('button', { name: en.hibernate })).not.toBeNull()
    expect(screen.getByRole('button', { name: en.activate })).not.toBeNull()
  })

  it('hibernates and activates by opaque id, then reloads the complete lease list', async () => {
    const active = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const hibernated = { ...active, phase: 'hibernated' as const, updatedAt: '2026-09-03T00:02:00.000Z' }
    const list = vi.fn()
      .mockResolvedValueOnce([active])
      .mockResolvedValueOnce([hibernated])
      .mockResolvedValueOnce([active])
    const hibernate = vi.fn(async () => {})
    const activate = vi.fn(async () => {})
    render(<WorkspaceIsolationSection {...props({ list, hibernate, activate })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.hibernate }))
    await screen.findByRole('button', { name: en.activate })
    expect(hibernate).toHaveBeenCalledWith(active.leaseId, expect.any(AbortSignal))
    expect(list).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: en.activate }))
    await screen.findByRole('button', { name: en.hibernate })
    expect(activate).toHaveBeenCalledWith(active.leaseId, expect.any(AbortSignal))
    expect(list).toHaveBeenCalledTimes(3)
    expect(screen.getByText(en.noticeUpdated)).not.toBeNull()
  })

  it('requires acknowledgement before teardown and sends no path or force field', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const list = vi.fn().mockResolvedValueOnce([current]).mockResolvedValueOnce([])
    const teardown = vi.fn(async () => ({ status: 'removed' as const, leaseId: current.leaseId }))
    render(<WorkspaceIsolationSection {...props({ list, teardown })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.teardown }))
    const dialog = screen.getByRole('dialog', { name: en.confirmTeardownTitle })
    const confirm = within(dialog).getByRole('button', { name: en.confirmTeardownAction }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(within(dialog).getByLabelText(en.confirmTeardownAcknowledge))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    await screen.findByText(en.empty)
    expect(teardown).toHaveBeenCalledWith(current.leaseId, expect.any(AbortSignal))
    expect(teardown.mock.calls[0]).toHaveLength(2)
    expect(screen.getByText(en.noticeRemoved)).not.toBeNull()
  })

  it('loads inspection and bounded comparison details before integration', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const inspect = vi.fn(async () => ({
      lease: current,
      checkoutState: 'dirty' as const,
      branchHead: 'branch-head',
      workingTreeChanges: [
        { kind: 'modified' as const, path: 'tracked.txt' },
        { kind: 'untracked' as const, path: 'untracked.txt' },
      ],
      hasUntrackedFiles: true,
    }))
    const compare = vi.fn(async () => ({
      lease: current,
      targetHead: 'target-head',
      branchHead: 'branch-head',
      ahead: 1,
      behind: 2,
      commits: [{ id: '1234567890abcdef', summary: 'Checkpoint' }],
      changedFiles: [{ kind: 'modified' as const, path: 'tracked.txt' }],
      patch: 'diff --git a/tracked.txt b/tracked.txt\n+changed\n',
      patchTruncated: false,
      includesWorkingTree: true,
      hasUntrackedFiles: true,
    }))
    render(<WorkspaceIsolationSection {...props({ list: vi.fn(async () => [current]), inspect, compare })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.details }))
    await screen.findByText(en.checkoutDirty)
    expect(inspect).toHaveBeenCalledWith(current.leaseId, expect.any(AbortSignal))
    expect(screen.getByText('untracked.txt')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.reviewChanges }))
    const patch = await screen.findByLabelText(en.patch)
    expect(patch.textContent).toContain('+changed')
    expect(screen.getByText(en.untrackedOmitted)).not.toBeNull()
    expect(screen.getByText('Checkpoint')).not.toBeNull()
    expect(compare).toHaveBeenCalledWith(current.leaseId, expect.any(AbortSignal))
  })

  it('confirms merge and refreshes the retained hibernated lease', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const integrated = { ...current, phase: 'hibernated' as const }
    const list = vi.fn().mockResolvedValueOnce([current]).mockResolvedValueOnce([integrated])
    const merge = vi.fn(async () => ({ lease: integrated, targetBranch: 'main', targetHead: 'merged-head' }))
    render(<WorkspaceIsolationSection {...props({ list, merge })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.details }))
    await screen.findByText(en.checkoutClean)
    fireEvent.click(screen.getByRole('button', { name: en.merge }))
    const dialog = screen.getByRole('dialog', { name: en.confirmMergeTitle })
    fireEvent.click(within(dialog).getByLabelText(en.confirmMergeAcknowledge))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmMergeAction }))

    await screen.findByText(translate('noticeMerged', { branch: 'main' }))
    expect(merge).toHaveBeenCalledWith(current.leaseId, expect.any(AbortSignal))
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('downloads an exported patch and reports omitted untracked files', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const exportPatch = vi.fn(async () => ({
      leaseId: current.leaseId,
      fileName: 'workspace-lease-1.patch',
      content: 'diff --git a/tracked.txt b/tracked.txt\n',
      includesWorkingTree: true,
      hasUntrackedFiles: true,
    }))
    const createObjectURL = vi.fn(() => 'blob:workspace-patch')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<WorkspaceIsolationSection {...props({ list: vi.fn(async () => [current]), exportPatch })} />)
      fireEvent.click(await screen.findByRole('button', { name: en.details }))
      await screen.findByText(en.checkoutClean)
      fireEvent.click(screen.getByRole('button', { name: en.exportPatch }))

      await screen.findByText(translate('noticePatchExportedWithUntracked', {
        fileName: 'workspace-lease-1.patch',
      }))
      expect(exportPatch).toHaveBeenCalledWith(current.leaseId, expect.any(AbortSignal))
      expect(createObjectURL).toHaveBeenCalledOnce()
      expect(click).toHaveBeenCalledOnce()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:workspace-patch')
    } finally {
      click.mockRestore()
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })

  it('keeps an unmerged branch visible after safe teardown refuses deletion', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const retained = { ...current, phase: 'hibernated' as const, reviewState: 'branch-retained' as const }
    const list = vi.fn().mockResolvedValueOnce([current]).mockResolvedValueOnce([retained])
    const teardown = vi.fn(async () => ({
      status: 'review' as const,
      lease: retained,
      reason: 'unmerged-branch' as const,
    }))
    render(<WorkspaceIsolationSection {...props({ list, teardown })} />)

    fireEvent.click(await screen.findByRole('button', { name: en.teardown }))
    const dialog = screen.getByRole('dialog', { name: en.confirmTeardownTitle })
    fireEvent.click(within(dialog).getByLabelText(en.confirmTeardownAcknowledge))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmTeardownAction }))

    await screen.findByText(translate('noticeBranchRetained', { branch: retained.branch }))
    expect(screen.getByText(en.reviewRequired)).not.toBeNull()
    expect(document.querySelector('[data-review-state="branch-retained"]')).not.toBeNull()
  })

  it('confirms pruning and reports both nonzero and zero results', async () => {
    const current = lease('lease-1', 'hibernated', '2026-09-03T00:01:00.000Z')
    const list = vi.fn(async () => [current])
    const prune = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    render(<WorkspaceIsolationSection {...props({ list, prune })} />)

    const confirmPrune = async (): Promise<void> => {
      fireEvent.click(await screen.findByRole('button', { name: en.prune }))
      const dialog = screen.getByRole('dialog', { name: en.confirmPruneTitle })
      fireEvent.click(within(dialog).getByLabelText(en.confirmPruneAcknowledge))
      fireEvent.click(within(dialog).getByRole('button', { name: en.confirmPruneAction }))
    }

    await confirmPrune()
    await screen.findByText(translate('noticePrunedSome', { n: 2 }))
    await confirmPrune()
    await screen.findByText(en.noticePrunedNone)
    expect(prune).toHaveBeenCalledTimes(2)
  })

  it('offers retry after initial failure and keeps a loaded list visible on an action failure', async () => {
    const current = lease('lease-1', 'active', '2026-09-03T00:01:00.000Z')
    const list = vi.fn().mockRejectedValueOnce(new Error('Host offline')).mockResolvedValue([current])
    const hibernate = vi.fn(async () => { throw 'raw provider failure' })
    render(<WorkspaceIsolationSection {...props({ list, hibernate })} />)

    expect((await screen.findByRole('alert')).textContent).toContain('Host offline')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText('session-lease-1')
    fireEvent.click(screen.getByRole('button', { name: en.hibernate }))
    expect((await screen.findByRole('alert')).textContent).toContain('raw provider failure')
    expect(screen.getByText('session-lease-1')).not.toBeNull()
  })

  it('uses only shared semantic tokens and responsive card layouts', () => {
    expect(css).toContain('var(--dsw-alias-label-primary)')
    expect(css).toContain('var(--dsw-alias-state-error-primary)')
    expect(css).toContain('var(--dsw-alias-state-success-primary)')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(css).toContain('@media (max-width: 760px)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
    expect(css).not.toMatch(/rgba?\(/i)
  })
})
