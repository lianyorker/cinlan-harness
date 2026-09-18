// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeTaskView, WorktreeTaskSettings, WorktreeTaskReview } from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import { WorktreeTaskSection, type WorktreeTaskSectionProps } from '../src/client/WorktreeTaskSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function task(status: WorktreeTaskView['status'] = 'active'): WorktreeTaskView {
  return {
    taskId: 'task-real' as WorktreeTaskView['taskId'], name: 'Real task', workspaceId: 'workspace-real' as WorktreeTaskView['workspaceId'],
    sourcePath: '/projects/real', checkoutPath: '/managed/task-real', branch: 'dsh/task/task-real', baseRef: 'main',
    status, sessionIds: [], createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T01:00:00Z',
  }
}

function settings(): WorktreeTaskSettings {
  return { revision: 3, managedRoot: '/managed', value: { defaultDirectory: 'team', baseRef: 'main', setup: null, cleanup: null } }
}

function review(): WorktreeTaskReview {
  return { taskId: task().taskId, baseHead: 'a'.repeat(40), head: 'b'.repeat(40), checkoutRoot: '/managed/task-real',
    dirty: true, patch: 'diff --git a/file b/file\n+<script>literal</script>\n', untracked: ['notes & todo.txt'],
    setup: { executable: '/bin/node', args: ['with spaces', ''] }, cleanup: null }
}

const useWorkspaces: WorktreeTaskSectionProps['useWorkspaces'] = select => select({
  items: [{ workspaceId: task().workspaceId, title: 'Registered workspace', path: '/projects/real',
    sessionIds: [], createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' }],
  archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
})

function props(overrides: Partial<WorktreeTaskSectionProps> = {}): WorktreeTaskSectionProps {
  const dictionary: Readonly<Record<string, string>> = en
  return {
    close: vi.fn(), useWorkspaces,
    useSessions: select => select({ ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }),
    useSessionPendingInteraction: select => select(new Map()),
    useResource: () => { throw new Error('Resource hook is not used by this fixture') },
    t: (key, params: Record<string, unknown> = {}) =>
      Object.entries(params).reduce((text, [name, value]) => text.replaceAll('{' + name + '}', String(value)), dictionary[key] ?? key),
    list: vi.fn(async () => []), create: vi.fn(async () => task()),
    settings: vi.fn(async () => settings()),
    updateSettings: vi.fn<WorktreeTaskSectionProps['updateSettings']>(async request => ({ ...settings(), revision: request.expectedRevision + 1, value: request.value })),
    review: vi.fn(async () => review()),
    activate: vi.fn(async () => task()), hibernate: vi.fn(async () => task('hibernated')),
    archive: vi.fn(async () => task('archived')),
    delete: vi.fn<WorktreeTaskSectionProps['delete']>(async () => ({ status: 'deleted', taskId: task().taskId })),
    ...overrides,
  }
}

async function openForm() {
  await waitFor(() => { expect(screen.getByRole('button', { name: en.create })).toHaveProperty('disabled', false) })
  fireEvent.click(screen.getByRole('button', { name: en.create }))
  const form = screen.getByRole('region', { name: en.create })
  fireEvent.change(within(form).getByRole('combobox', { name: en.createWorkspaceId }), { target: { value: 'workspace-real' } })
  fireEvent.change(within(form).getByRole('textbox', { name: en.createTaskName }), { target: { value: 'New task' } })
  return form
}

describe('native worktree task settings', () => {
  it('creates with the selected registered workspace, real path, base and linked issue', async () => {
    const p = props()
    render(<WorktreeTaskSection {...p} />)
    const form = await openForm()
    expect(within(form).getByRole('textbox', { name: en.createSourcePath })).toHaveProperty('value', '/projects/real')
    fireEvent.change(within(form).getByRole('textbox', { name: en.createBaseRef }), { target: { value: ' release ' } })
    fireEvent.change(within(form).getByRole('textbox', { name: en.createLinkedIssue }), { target: { value: ' https://issues.test/17 ' } })
    fireEvent.click(within(form).getByRole('button', { name: en.create }))
    await waitFor(() => { expect(p.create).toHaveBeenCalledWith({ name: 'New task', workspaceId: 'workspace-real',
      sourcePath: '/projects/real', baseRef: 'release', linkedIssue: 'https://issues.test/17' }, expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.queryByRole('region', { name: en.create })).toBeNull() })
    expect(p.list).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeTruthy()
  })

  it('keeps failed creation drafts and omits unset per-task options on retry', async () => {
    const create = vi.fn<WorktreeTaskSectionProps['create']>().mockRejectedValueOnce(new Error('dirty repository')).mockResolvedValue(task())
    render(<WorktreeTaskSection {...props({ create })} />)
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: en.create }))
    expect((await screen.findByRole('alert')).textContent).toBe('dirty repository')
    expect(within(form).getByRole('textbox', { name: en.createTaskName })).toHaveProperty('value', 'New task')
    expect(within(form).getByRole('combobox')).toHaveProperty('value', 'workspace-real')
    fireEvent.click(within(form).getByRole('button', { name: en.create }))
    await waitFor(() => { expect(create).toHaveBeenCalledTimes(2) })
    expect(create.mock.calls[1]?.[0]).toEqual({ name: 'New task', workspaceId: 'workspace-real', sourcePath: '/projects/real' })
  })

  it('reveals search-targeted creation fields and keeps the existing draft across targets', async () => {
    const p = props({ target: { itemId: 'create-base', anchorId: 'worktree-task-create-base' } })
    const rendered = render(<WorktreeTaskSection {...p} />)
    const input = screen.getByRole('textbox', { name: en.createBaseRef })
    fireEvent.change(input, { target: { value: 'release-draft' } })
    rendered.rerender(<WorktreeTaskSection {...p} target={{ itemId: 'create-issue', anchorId: 'worktree-task-create-issue' }} />)
    expect(input).toHaveProperty('value', 'release-draft')
    expect(document.querySelector('[data-settings-anchor="worktree-task-create-issue"]')).not.toBeNull()
    rendered.rerender(<WorktreeTaskSection {...p} target={{ itemId: 'policy', anchorId: 'worktree-task-policy' }} />)
    expect(screen.getByText(en.policyTitle).closest('details')).toHaveProperty('open', true)
    expect(p.create).not.toHaveBeenCalled()
    await waitFor(() => { expect(p.list).toHaveBeenCalledOnce() })
  })

  it('withholds creation without a registered workspace and recovers provider read failures', async () => {
    const list = vi.fn().mockRejectedValueOnce(new Error(en.errorUnavailable)).mockResolvedValue([])
    const p = props({ list, useWorkspaces: select => select({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    }) })
    render(<WorktreeTaskSection {...p} />)
    expect((await screen.findByRole('alert')).textContent).toBe(en.errorUnavailable)
    expect(screen.getByRole('button', { name: en.create })).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByRole('button', { name: en.refresh }))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.create })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: en.create }))
    const form = screen.getByRole('region', { name: en.create })
    expect(within(form).getByText(en.workspaceEmpty)).toBeTruthy()
    expect(within(form).getByRole('button', { name: en.create })).toHaveProperty('disabled', true)
    expect(p.create).not.toHaveBeenCalled()
  })

  it('requires acknowledgement for lifecycle changes and allows archived safe deletion', async () => {
    const current = task('archived')
    const list = vi.fn(async () => [current])
    const remove = vi.fn<WorktreeTaskSectionProps['delete']>(async () => ({
      status: 'retained', taskId: current.taskId, retainedBranch: current.branch,
    }))
    render(<WorktreeTaskSection {...props({ list, delete: remove })} />)
    fireEvent.click(await screen.findByRole('button', { name: en.delete }))
    const dialog = screen.getByRole('dialog', { name: en.confirmDeleteTitle })
    expect(within(dialog).getByRole('button', { name: en.confirmDeleteAction })).toHaveProperty('disabled', true)
    fireEvent.click(within(dialog).getByRole('checkbox', { name: en.confirmAcknowledge }))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmDeleteAction }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith(current.taskId, expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe(en.noticeBranchRetained.replace('{branch}', current.branch)) })
    expect(screen.getByText(current.branch)).toBeTruthy()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('activates, hibernates, and archives through their existing operations', async () => {
    const list = vi.fn().mockResolvedValueOnce([task('hibernated')]).mockResolvedValueOnce([task()])
      .mockResolvedValueOnce([task('hibernated')]).mockResolvedValue([task('archived')])
    const p = props({ list })
    render(<WorktreeTaskSection {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: en.activate }))
    fireEvent.click(await screen.findByRole('button', { name: en.hibernate }))
    let dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmHibernateAction }))
    await waitFor(() => { expect(p.hibernate).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(screen.getByRole('button', { name: en.archive })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: en.archive }))
    dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmArchiveAction }))
    await waitFor(() => { expect(p.archive).toHaveBeenCalledOnce() })
    expect(p.activate).toHaveBeenCalledWith(task().taskId, expect.any(AbortSignal))
    expect(p.hibernate).toHaveBeenCalledWith(task().taskId, expect.any(AbortSignal))
  })

  it('saves Host defaults with exact argv, keeps conflicted drafts, and reloads the observed revision explicitly', async () => {
    const saved = settings()
    const updateSettings = vi.fn<WorktreeTaskSectionProps['updateSettings']>()
      .mockRejectedValueOnce(new Error('Defaults changed; reload before saving'))
      .mockResolvedValue({ ...saved, revision: 5 })
    const read = vi.fn<WorktreeTaskSectionProps['settings']>().mockResolvedValueOnce(saved).mockResolvedValue({ ...saved, revision: 4 })
    const p = props({ settings: read, updateSettings })
    render(<WorktreeTaskSection {...p} />)
    await waitFor(() => { expect(screen.getByLabelText(en.defaultBase)).toHaveProperty('value', 'main') })
    fireEvent.change(screen.getByLabelText(en.defaultDirectory), { target: { value: 'literal folder' } })
    fireEvent.change(screen.getByLabelText(en.defaultBase), { target: { value: 'release' } })
    const setup = screen.getByRole('group', { name: en.setupTitle })
    fireEvent.change(within(setup).getByLabelText(en.hookExecutable), { target: { value: '/program with spaces' } })
    fireEvent.click(within(setup).getByRole('button', { name: en.addArgument }))
    fireEvent.change(within(setup).getByLabelText(en.hookArgument.replace('{index}', '1')), { target: { value: 'literal ; $ "quoted"' } })
    fireEvent.click(within(setup).getByRole('button', { name: en.addArgument }))
    fireEvent.click(screen.getByRole('button', { name: en.defaultsSave }))
    expect((await screen.findByRole('alert')).textContent).toContain('Defaults changed')
    expect(updateSettings).toHaveBeenCalledWith({ expectedRevision: 3, value: {
      defaultDirectory: 'literal folder', baseRef: 'release', setup: { executable: '/program with spaces', args: ['literal ; $ "quoted"', ''] }, cleanup: null,
    } }, expect.any(AbortSignal))
    expect(screen.getByLabelText(en.defaultBase)).toHaveProperty('value', 'release')
    expect(p.create).not.toHaveBeenCalled()
    expect(p.archive).not.toHaveBeenCalled()
    expect(p.review).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.defaultsReload }))
    await waitFor(() => { expect(screen.getByLabelText(en.defaultBase)).toHaveProperty('value', 'main') })
    fireEvent.click(screen.getByRole('button', { name: en.defaultsSave }))
    await screen.findByText(en.defaultsSaved)
    expect(updateSettings.mock.calls[1]?.[0].expectedRevision).toBe(4)
  })

  it('renders literal patches, captured programs, untracked paths, and receipt outcomes without activation', async () => {
    const value = review()
    const read = vi.fn<WorktreeTaskSectionProps['review']>().mockResolvedValueOnce(value)
      .mockResolvedValue({ ...value, cleanupReceipt: { operation: 'archive', hook: value.setup!, startedAt: 'start', status: 'running' } })
    const p = props({ list: vi.fn(async () => [task('hibernated')]), review: read })
    render(<WorktreeTaskSection {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: en.review }))
    const panel = screen.getByRole('region', { name: 'Review: Real task' })
    await waitFor(() => { expect(within(panel).getByLabelText(en.reviewPatch).textContent).toBe(value.patch) })
    expect(panel.querySelector('script')).toBeNull()
    expect(within(panel).getByText('notes & todo.txt')).toBeTruthy()
    expect(within(panel).getByText(JSON.stringify(['/bin/node', 'with spaces', '']))).toBeTruthy()
    expect(within(panel).getByText(en.cleanupNotRun)).toBeTruthy()
    expect(p.activate).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: en.reviewRefresh }))
    await within(panel).findByText(en.cleanupUnsettled)
    expect(read).toHaveBeenCalledWith(task().taskId, expect.any(AbortSignal))
    fireEvent.click(within(panel).getByRole('button', { name: en.close }))
    expect(screen.queryByRole('region', { name: 'Review: Real task' })).toBeNull()
  })

  it('aborts superseded review reads and ignores a late response', async () => {
    let complete!: (value: WorktreeTaskReview) => void
    const pending = new Promise<WorktreeTaskReview>((resolve) => { complete = resolve })
    const read = vi.fn<WorktreeTaskSectionProps['review']>().mockReturnValueOnce(pending)
      .mockResolvedValue({ ...review(), patch: '', untracked: [], dirty: false })
    const p = props({ list: vi.fn(async () => [task()]), review: read })
    const rendered = render(<WorktreeTaskSection {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: en.review }))
    await waitFor(() => { expect(read).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByRole('button', { name: en.reviewRefresh }))
    expect(read.mock.calls[0]![1].aborted).toBe(true)
    await screen.findByText(en.reviewNoPatch)
    await act(async () => { complete(review()); await pending })
    expect(screen.queryByLabelText(en.reviewPatch)).toBeNull()
    rendered.unmount()
    expect(read.mock.calls[1]![1].aborted).toBe(true)
  })

  it('aborts defaults saving on unmount and retains rejected drafts until explicit reload', async () => {
    let complete!: (value: WorktreeTaskSettings) => void
    const pending = new Promise<WorktreeTaskSettings>((resolve) => { complete = resolve })
    const save = vi.fn<WorktreeTaskSectionProps['updateSettings']>(() => pending)
    const p = props({ updateSettings: save })
    const rendered = render(<WorktreeTaskSection {...p} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: en.defaultsSave })).toHaveProperty('disabled', false) })
    fireEvent.click(screen.getByRole('button', { name: en.defaultsSave }))
    expect(screen.getByRole('button', { name: en.create })).toHaveProperty('disabled', true)
    rendered.unmount()
    expect(save.mock.calls[0]![1].aborted).toBe(true)
    await act(async () => { complete(settings()); await pending })
    expect(p.create).not.toHaveBeenCalled()
  })

  it('refreshes the failed cleanup receipt while keeping its task available for review', async () => {
    const p = props({ list: vi.fn(async () => [task()]), archive: vi.fn(async () => { throw new Error('cleanup refused') }) })
    render(<WorktreeTaskSection {...p} />)
    fireEvent.click(await screen.findByRole('button', { name: en.archive }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: en.confirmArchiveAction }))
    await screen.findByText('cleanup refused')
    expect(p.list).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: en.review })).toHaveProperty('disabled', false)
  })

  it('aborts in-flight creation when unmounted and ignores its late success', async () => {
    let resolveCreate!: (value: WorktreeTaskView) => void
    const pending = new Promise<WorktreeTaskView>((resolve) => { resolveCreate = resolve })
    const create = vi.fn<WorktreeTaskSectionProps['create']>(() => pending)
    const p = props({ create })
    const rendered = render(<WorktreeTaskSection {...p} />)
    const form = await openForm()
    fireEvent.click(within(form).getByRole('button', { name: en.create }))
    const signal = create.mock.calls[0]![1]
    rendered.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveCreate(task()); await pending })
    expect(p.list).toHaveBeenCalledOnce()
  })
})
