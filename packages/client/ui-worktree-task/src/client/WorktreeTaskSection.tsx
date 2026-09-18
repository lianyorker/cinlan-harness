/** Native settings page for real Worktree Task creation and lifecycle operations. */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { Button, IconPlusOutline16, IconRefreshOutline16, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeTaskView, WorktreeTaskCreateRequest, WorktreeTaskDeleteValue, WorktreeTaskId,
  WorktreeTaskSettings, UpdateWorktreeTaskSettingsRequest, WorktreeTaskReview,
} from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { WorktreeDefaultsForm } from './WorktreeDefaultsForm.tsx'
import { WorktreeReviewPanel } from './WorktreeReviewPanel.tsx'
import css from './WorktreeTaskSection.module.css'

/** Host lifecycle callbacks injected by the registration. */
export interface WorktreeTaskSectionInjected {
  /** Create a new task from an explicit workspace and repository. */
  create: (request: WorktreeTaskCreateRequest, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** List all task records without activating a checkout. */
  list: (signal: AbortSignal) => Promise<readonly WorktreeTaskView[]>
  /** Read defaults for future tasks without running programs. */
  settings: (signal: AbortSignal) => Promise<WorktreeTaskSettings>
  /** Persist revision-checked defaults without modifying existing tasks. */
  updateSettings: (request: UpdateWorktreeTaskSettingsRequest, signal: AbortSignal) => Promise<WorktreeTaskSettings>
  /** Read captured commands, cleanup receipt, and changes without activating the task. */
  review: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskReview>
  /** Restore a hibernated task's checkout. */
  activate: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Checkpoint and reclaim an inactive task's checkout. */
  hibernate: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Retain a task's branch and record for review. */
  archive: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Delete safely, preserving a branch that has not been integrated. */
  delete: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskDeleteValue>
}

/** Props assembled by the settings renderer. */
export type WorktreeTaskSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.worktreeTask'> & InjectFace<WorktreeTaskSectionInjected>

type Operation = 'activate' | 'hibernate' | 'archive' | 'delete'
type Confirmation = { kind: Exclude<Operation, 'activate'>; task: WorktreeTaskView }
type Translate = WorktreeTaskSectionProps['t']
interface WorkspaceChoice { workspaceId: WorkspaceId; title: string; path: string }

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sortedTasks(items: readonly WorktreeTaskView[]): readonly WorktreeTaskView[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.taskId.localeCompare(right.taskId))
}

/**
 * Render local task management and a workspace-bound creation form.
 * @param props - renderer data, localized copy, and generated Remote callbacks.
 * @returns settings rows with stable search destinations.
 */
export function WorktreeTaskSection(props: WorktreeTaskSectionProps) {
  const { list, t } = props
  const workspaces = props.useWorkspaces(state => state.items)
  const workspacePhase = props.useWorkspaces(state => state.phase)
  const [tasks, setTasks] = useState<readonly WorktreeTaskView[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<Operation | 'create' | 'settings' | null>(null)
  const [reviewTask, setReviewTask] = useState<WorktreeTaskView | null>(null)
  const [reviewVersion, setReviewVersion] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const loadAbort = useRef<AbortController | null>(null)
  const operationAbort = useRef<AbortController | null>(null)
  const policy = useRef<HTMLDetailsElement>(null)

  useLayoutEffect(() => {
    if (props.target?.anchorId.startsWith('worktree-task-create-')) setShowCreate(true)
    if (props.target?.anchorId === 'worktree-task-policy' && policy.current !== null) policy.current.open = true
  }, [props.target])

  const refresh = useCallback(async () => {
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setError(null)
    try {
      const items = await list(controller.signal)
      if (!controller.signal.aborted) setTasks(sortedTasks(items))
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [list])

  useEffect(() => {
    void refresh()
    return () => { loadAbort.current?.abort(); operationAbort.current?.abort() }
  }, [refresh])

  async function operate(kind: Operation, task: WorktreeTaskView): Promise<void> {
    if (busy !== null || operationAbort.current !== null) return
    const controller = new AbortController()
    operationAbort.current = controller
    setBusy(kind)
    setError(null)
    setNotice(null)
    try {
      if (kind === 'delete') {
        const result = await props.delete(task.taskId, controller.signal)
        if (controller.signal.aborted) return
        setNotice(result.status === 'deleted' ? t('noticeDeleted') : t('noticeBranchRetained', { branch: result.retainedBranch }))
      } else {
        await props[kind](task.taskId, controller.signal)
        if (controller.signal.aborted) return
        setNotice(t(kind === 'activate' ? 'noticeActivated' : kind === 'hibernate' ? 'noticeHibernated' : 'noticeArchived'))
      }
      if (kind === 'delete') setReviewTask(null)
      setReviewVersion(version => version + 1)
      await refresh()
    } catch (reason: unknown) {
      if (!controller.signal.aborted) {
        await refresh()
        if (!controller.signal.aborted) {
          setReviewVersion(version => version + 1)
          setError(failureMessage(reason))
        }
      }
    } finally {
      if (!controller.signal.aborted) setBusy(null)
      if (operationAbort.current === controller) operationAbort.current = null
    }
  }

  const items = tasks ?? []
  const confirmKind = confirmation?.kind
  const confirmTitle = confirmKind === 'hibernate' ? t('confirmHibernateTitle')
    : confirmKind === 'archive' ? t('confirmArchiveTitle') : t('confirmDeleteTitle')
  const confirmDescription = confirmKind === 'hibernate' ? t('confirmHibernateDescription')
    : confirmKind === 'archive' ? t('confirmArchiveDescription')
      : t('confirmDeleteDescription', { branch: confirmation?.task.branch ?? '' })
  const confirmAction = confirmKind === 'hibernate' ? t('confirmHibernateAction')
    : confirmKind === 'archive' ? t('confirmArchiveAction') : t('confirmDeleteAction')

  return <div className={css.section} aria-busy={loading || busy !== null}>
    <header className={css.header}>
      <div><h1>{t('title')}</h1><p className={css.description}>{t('description')}</p></div>
      <div className={css.toolbar}>
        <span className={css.help}>{t('hostOnly')}</span>
        <Button variant="outline" icon={<IconRefreshOutline16 />} disabled={loading || busy !== null}
          onClick={() => { void refresh() }}>{t(loading ? 'refreshing' : 'refresh')}</Button>
        <Button variant="primary" icon={<IconPlusOutline16 />} disabled={busy !== null || loading || tasks === null}
          onClick={() => { setShowCreate(true) }}>{t('create')}</Button>
      </div>
    </header>
    {error !== null && <p className={css.errorBanner} role="alert">{error}</p>}
    {notice !== null && <p className={css.noticeBanner} role="status">{notice}</p>}
    <details className={css.policy} ref={policy}>
      <summary>{t('policyTitle')}</summary>
      <p className={css.help} data-settings-anchor="worktree-task-policy">{t('policyHelp')}</p>
    </details>
    <WorktreeDefaultsForm t={t} settings={props.settings} updateSettings={props.updateSettings}
      disabled={busy !== null && busy !== 'settings'} onBusy={(value) => { setBusy(value ? 'settings' : null) }} />
    {showCreate && <CreateForm t={t} workspaces={workspaces} workspaceReady={workspacePhase === 'ready'}
      disabled={tasks === null || (busy !== null && busy !== 'create')}
      create={props.create} onBusy={(value) => { setBusy(value ? 'create' : null) }}
      onClose={() => { setShowCreate(false) }}
      onCreated={(task) => { setShowCreate(false); setNotice(t('noticeCreated', { name: task.name })); void refresh() }} />}
    <section data-settings-anchor="worktree-task-records">
      <h2 className={css.sectionTitle}>{t('recordsTitle')}</h2>
      <p className={css.help}>{t('recordsHelp')}</p>
      {tasks !== null && <div className={css.stats} aria-label={t('total')}>
        <span>{t('total')}: <strong>{items.length}</strong></span>
        <span>{t('activeCount')}: <strong>{items.filter(task => task.status === 'active').length}</strong></span>
        <span>{t('hibernatedCount')}: <strong>{items.filter(task => task.status === 'hibernated').length}</strong></span>
        <span>{t('archivedCount')}: <strong>{items.filter(task => task.status === 'archived').length}</strong></span>
      </div>}
      {loading && <p className={css.help} role="status">{t('loading')}</p>}
      {!loading && tasks !== null && items.length === 0 && <p className={css.empty}>{t('empty')}</p>}
      {items.length > 0 && <ul className={css.taskList}>
        {items.map(task => <li key={task.taskId} className={css.taskCard}>
          <div className={css.taskCardHeader}>
            <h3 className={css.taskName}>{task.name}</h3>
            <span className={css.statusBadge}>{t(task.status === 'active' ? 'statusActive'
              : task.status === 'hibernated' ? 'statusHibernated' : 'statusArchived')}</span>
          </div>
          <dl className={css.taskMeta}>
            <div><dt>{t('branch')}</dt><dd>{task.branch}</dd></div>
            <div><dt>{t('sourcePath')}</dt><dd>{task.sourcePath}</dd></div>
            <div><dt>{t('checkoutPath')}</dt><dd>{task.checkoutPath}</dd></div>
            <div><dt>{t('createBaseRef')}</dt><dd>{task.baseRef}</dd></div>
            <div><dt>{t('sessions')}</dt><dd>{task.sessionIds.length > 0 ? task.sessionIds.join(', ') : t('noSessions')}</dd></div>
            {task.linkedIssue !== undefined && <div><dt>{t('createLinkedIssue')}</dt><dd>{task.linkedIssue}</dd></div>}
            <div><dt>{t('updatedAt')}</dt><dd>{task.updatedAt}</dd></div>
          </dl>
          <div className={css.taskActions}>
            <Button variant="outline" disabled={busy !== null}
              onClick={() => { setReviewTask(task); setReviewVersion(version => version + 1) }}>{t('review')}</Button>
            {task.status === 'hibernated' && <Button variant="outline" disabled={busy !== null}
              onClick={() => { void operate('activate', task) }}>{t('activate')}</Button>}
            {(['hibernate', 'archive', 'delete'] as const).filter(kind => kind === 'delete'
              || (kind === 'hibernate' ? task.status === 'active' : task.status !== 'archived')).map(kind => (
              <Button key={kind} variant="outline" disabled={busy !== null}
                onClick={() => { setAcknowledged(false); setConfirmation({ kind, task }) }}>{t(kind)}</Button>
            ))}
          </div>
        </li>)}
      </ul>}
    </section>
    {reviewTask !== null && <WorktreeReviewPanel key={reviewTask.taskId + ':' + reviewVersion}
      t={t} task={reviewTask} review={props.review} onClose={() => { setReviewTask(null) }} />}
    <RiskConfirmation open={confirmation !== null} title={confirmTitle} description={confirmDescription}
      acknowledgeLabel={t('confirmAcknowledge')} cancelLabel={t('cancel')} closeLabel={t('close')}
      confirmLabel={confirmAction} acknowledged={acknowledged} disabled={busy !== null}
      onAcknowledgedChange={setAcknowledged} onCancel={() => { setConfirmation(null); setAcknowledged(false) }}
      onConfirm={() => {
        const target = confirmation
        if (target === null) return
        setConfirmation(null)
        setAcknowledged(false)
        void operate(target.kind, target.task)
      }} />
  </div>
}

interface CreateFormProps {
  t: Translate
  workspaces: readonly WorkspaceChoice[]
  workspaceReady: boolean
  disabled: boolean
  create: WorktreeTaskSectionInjected['create']
  onBusy: (busy: boolean) => void
  onClose: () => void
  onCreated: (task: WorktreeTaskView) => void
}

function CreateForm({ t, workspaces, workspaceReady, disabled, create, onBusy, onClose, onCreated }: CreateFormProps) {
  const prefix = useId()
  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState<WorkspaceId | undefined>()
  const [sourcePath, setSourcePath] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [linkedIssue, setLinkedIssue] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const selected = workspaces.find(workspace => workspace.workspaceId === workspaceId)
  useEffect(() => () => abort.current?.abort(), [])

  async function submit(): Promise<void> {
    if (creating || disabled || !workspaceReady || selected === undefined || !name.trim() || !sourcePath.trim()) return
    const controller = new AbortController()
    abort.current = controller
    setCreating(true)
    onBusy(true)
    setError(null)
    try {
      const task = await create({
        name: name.trim(), workspaceId: selected.workspaceId, sourcePath: sourcePath.trim(),
        ...baseRef.trim() === '' ? {} : { baseRef: baseRef.trim() },
        ...linkedIssue.trim() === '' ? {} : { linkedIssue: linkedIssue.trim() },
      }, controller.signal)
      if (!controller.signal.aborted) { onBusy(false); onCreated(task) }
    } catch (reason: unknown) {
      if (!controller.signal.aborted) setError(failureMessage(reason))
    } finally {
      if (!controller.signal.aborted) { setCreating(false); onBusy(false) }
    }
  }

  return <section className={css.createForm} aria-label={t('create')}>
    <h2 className={css.sectionTitle}>{t('create')}</h2>
    {error !== null && <p className={css.errorBanner} role="alert">{error}</p>}
    <div className={css.formRow} data-settings-anchor="worktree-task-create-workspace">
      <div><label htmlFor={prefix + '-workspace'}>{t('createWorkspaceId')}</label>
        <p className={css.help}>{t(workspaceReady && workspaces.length === 0 ? 'workspaceEmpty' : 'workspaceHelp')}</p></div>
      <select id={prefix + '-workspace'} value={workspaceId ?? ''} disabled={creating || disabled || !workspaceReady}
        onChange={(event) => {
          const next = workspaces.find(workspace => workspace.workspaceId === event.target.value)
          setWorkspaceId(next?.workspaceId)
          setSourcePath(next?.path ?? '')
        }}>
        <option value="">{t(workspaceReady ? 'selectWorkspace' : 'workspaceLoading')}</option>
        {workspaces.map(workspace => <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>)}
      </select>
    </div>
    {([
      ['name', 'createTaskName', 'createTaskNamePlaceholder', 'createNameHelp', name, setName],
      ['source', 'createSourcePath', 'createSourcePathPlaceholder', 'createSourceHelp', sourcePath, setSourcePath],
      ['base', 'createBaseRef', 'createBaseRefPlaceholder', 'createBaseHelp', baseRef, setBaseRef],
      ['issue', 'createLinkedIssue', 'createLinkedIssuePlaceholder', 'createIssueHelp', linkedIssue, setLinkedIssue],
    ] as const).map(([id, label, placeholder, help, text, update]) => <div key={id} className={css.formRow}
      data-settings-anchor={'worktree-task-create-' + id}>
      <div><label htmlFor={prefix + '-' + id}>{t(label)}</label><p className={css.help}>{t(help)}</p></div>
      <input id={prefix + '-' + id} value={text} placeholder={t(placeholder)} disabled={creating || disabled}
        onChange={(event) => { update(event.target.value) }} />
    </div>)}
    <div className={css.formActions}>
      <Button disabled={creating} onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" disabled={creating || disabled || !workspaceReady || selected === undefined || !name.trim() || !sourcePath.trim()}
        onClick={() => { void submit() }}>{t(creating ? 'creating' : 'create')}</Button>
    </div>
  </section>
}
