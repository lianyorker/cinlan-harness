/** Worktree Task management page for Web Settings. */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button, IconPlusOutline16, IconRefreshOutline16,
  IconTrashOutline16, IconPauseOutline16, IconPlayOutline16,
  IconArchiveOutline20, RiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeTaskView,
  WorktreeTaskCreateRequest,
  WorktreeTaskDeleteValue,
} from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

function workspaceId(value: string): WorkspaceId {
  return value as WorkspaceId
}
import css from './WorktreeTaskSection.module.css'

/** Host lifecycle callbacks injected by the registration. */
export interface WorktreeTaskSectionInjected {
  /** Create a new worktree task. */
  create: (request: WorktreeTaskCreateRequest, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** List all tasks. */
  list: (signal: AbortSignal) => Promise<readonly WorktreeTaskView[]>
  /** Activate a hibernated task. */
  activate: (taskId: string, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Hibernate an active task. */
  hibernate: (taskId: string, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Archive a task. */
  archive: (taskId: string, signal: AbortSignal) => Promise<WorktreeTaskView>
  /** Delete a task. */
  delete: (taskId: string, signal: AbortSignal) => Promise<WorktreeTaskDeleteValue>
}

/** Props assembled for the Worktree Task settings section. */
export type WorktreeTaskSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.worktreeTask'>
  & InjectFace<WorktreeTaskSectionInjected>

type BusyOperation = 'create' | 'activate' | 'hibernate' | 'archive' | 'delete' | 'list'

type Confirmation =
  | { readonly kind: 'hibernate'; readonly task: WorktreeTaskView }
  | { readonly kind: 'archive'; readonly task: WorktreeTaskView }
  | { readonly kind: 'delete'; readonly task: WorktreeTaskView }

function sortedTasks(items: readonly WorktreeTaskView[]): readonly WorktreeTaskView[] {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt) || left.taskId.localeCompare(right.taskId))
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Settings section for Worktree Task lifecycle management. */
export function WorktreeTaskSection(props: WorktreeTaskSectionProps) {
  const {
    create, list, activate, hibernate, archive, delete: deleteTask, t,
  } = props
  const [tasks, setTasks] = useState<readonly WorktreeTaskView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<BusyOperation | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const items = await list(controller.signal)
      if (!controller.signal.aborted) setTasks(sortedTasks(items))
    } catch (err) {
      if (!controller.signal.aborted) setError(failureMessage(err))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [list])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => () => abortRef.current?.abort(), [])

  const activeCount = tasks.filter(task => task.status === 'active').length
  const hibernatedCount = tasks.filter(task => task.status === 'hibernated').length
  const archivedCount = tasks.filter(task => task.status === 'archived').length

  const handleConfirm = useCallback(async () => {
    if (confirmation === null) return
    const controller = new AbortController()
    setBusy(confirmation.kind)
    setError(null)
    setNotice(null)
    try {
      if (confirmation.kind === 'hibernate') {
        await hibernate(confirmation.task.taskId, controller.signal)
        setNotice(t('noticeHibernated'))
      } else if (confirmation.kind === 'archive') {
        await archive(confirmation.task.taskId, controller.signal)
        setNotice(t('noticeArchived'))
      } else if (confirmation.kind === 'delete') {
        const result = await deleteTask(confirmation.task.taskId, controller.signal)
        if (result.status === 'deleted') setNotice(t('noticeDeleted'))
        else setNotice(t('noticeBranchRetained', { branch: result.retainedBranch }))
      }
      await refresh()
    } catch (err) {
      setError(failureMessage(err))
    } finally {
      setBusy(null)
      setConfirmation(null)
      setAcknowledged(false)
    }
  }, [confirmation, hibernate, archive, deleteTask, refresh, t])

  const confirmTitle = confirmation === null ? '' : (
    confirmation.kind === 'hibernate' ? t('confirmHibernateTitle')
    : confirmation.kind === 'archive' ? t('confirmArchiveTitle')
    : t('confirmDeleteTitle')
  )
  const confirmDescription = confirmation === null ? '' : (
    confirmation.kind === 'hibernate' ? t('confirmHibernateDescription')
    : confirmation.kind === 'archive' ? t('confirmArchiveDescription')
    : t('confirmDeleteDescription', { branch: confirmation.task.branch })
  )
  const confirmAction = confirmation === null ? '' : (
    confirmation.kind === 'hibernate' ? t('confirmHibernateAction')
    : confirmation.kind === 'archive' ? t('confirmArchiveAction')
    : t('confirmDeleteAction')
  )

  return (
    <div className={css.section}>
      <div className={css.header}>
        <div>
          <h2>{t('title')}</h2>
          <p className={css.description}>{t('description')}</p>
        </div>
        <div className={css.toolbar}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || busy !== null}
          >
            <IconRefreshOutline16 />
            {loading ? t('refreshing') : t('refresh')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreate(true)}
            disabled={busy !== null}
          >
            <IconPlusOutline16 />
            {t('create')}
          </Button>
        </div>
      </div>

      {error !== null && <div className={css.errorBanner}>{error}</div>}
      {notice !== null && <div className={css.noticeBanner}>{notice}</div>}

      <div className={css.stats}>
        <span>{t('total')}: <strong>{tasks.length}</strong></span>
        <span>{t('activeCount')}: <strong>{activeCount}</strong></span>
        <span>{t('hibernatedCount')}: <strong>{hibernatedCount}</strong></span>
        <span>{t('archivedCount')}: <strong>{archivedCount}</strong></span>
      </div>

      {loading && <div className={css.loading}>{t('loading')}</div>}
      {!loading && tasks.length === 0 && <div className={css.empty}>{t('empty')}</div>}

      {!loading && tasks.length > 0 && (
        <div className={css.taskList}>
          {tasks.map(task => (
            <TaskCard
              key={task.taskId}
              task={task}
              t={t}
              busy={busy}
              onActivate={async () => {
                setBusy('activate')
                setError(null)
                try {
                  await activate(task.taskId, new AbortController().signal)
                  setNotice(t('noticeActivated'))
                  await refresh()
                } catch (err) { setError(failureMessage(err)) }
                finally { setBusy(null) }
              }}
              onHibernate={() => setConfirmation({ kind: 'hibernate', task })}
              onArchive={() => setConfirmation({ kind: 'archive', task })}
              onDelete={() => setConfirmation({ kind: 'delete', task })}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDialog
          t={t}
          create={create}
          onClose={() => setShowCreate(false)}
          onCreated={async () => {
            setShowCreate(false)
            await refresh()
          }}
          onError={setError}
        />
      )}

      <RiskConfirmation
        open={confirmation !== null}
        title={confirmTitle}
        description={confirmDescription}
        acknowledgeLabel={t('close')}
        cancelLabel={t('cancel')}
        closeLabel={t('close')}
        confirmLabel={confirmAction}
        acknowledged={acknowledged}
        disabled={busy !== null}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setConfirmation(null); setAcknowledged(false) }}
        onConfirm={() => void handleConfirm()}
      />
    </div>
  )
}

interface TaskCardProps {
  task: WorktreeTaskView
  t: WorktreeTaskSectionProps['t']
  busy: BusyOperation | null
  onActivate: () => void
  onHibernate: () => void
  onArchive: () => void
  onDelete: () => void
}

function TaskCard({ task, t, busy, onActivate, onHibernate, onArchive, onDelete }: TaskCardProps) {
  const statusClass =
    task.status === 'active' ? css.statusActive
    : task.status === 'hibernated' ? css.statusHibernated
    : css.statusArchived

  return (
    <div className={css.taskCard}>
      <div className={css.taskCardHeader}>
        <span className={css.taskName}>{task.name}</span>
        <span className={`${css.statusBadge} ${statusClass}`}>
          {task.status === 'active' ? t('statusActive')
            : task.status === 'hibernated' ? t('statusHibernated')
            : t('statusArchived')}
        </span>
      </div>
      <div className={css.taskMeta}>
        <span><label>{t('branch')}:</label> {task.branch}</span>
        <span><label>{t('sourcePath')}:</label> {task.sourcePath}</span>
        <span><label>{t('sessions')}:</label> {task.sessionIds.length > 0 ? task.sessionIds.join(', ') : t('noSessions')}</span>
        <span><label>{t('updatedAt')}:</label> {task.updatedAt}</span>
      </div>
      {task.status !== 'archived' && (
        <div className={css.taskActions}>
          {task.status === 'hibernated' && (
            <Button variant="ghost" size="sm" onClick={onActivate} disabled={busy !== null}>
              <IconPlayOutline16 />
              {t('activate')}
            </Button>
          )}
          {task.status === 'active' && (
            <Button variant="ghost" size="sm" onClick={onHibernate} disabled={busy !== null}>
              <IconPauseOutline16 />
              {t('hibernate')}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onArchive} disabled={busy !== null}>
            <IconArchiveOutline20 />
            {t('archive')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy !== null}>
            <IconTrashOutline16 />
            {t('delete')}
          </Button>
        </div>
      )}
    </div>
  )
}

interface CreateDialogProps {
  t: WorktreeTaskSectionProps['t']
  create: WorktreeTaskSectionInjected['create']
  onClose: () => void
  onCreated: () => void
  onError: (message: string) => void
}

function CreateDialog({ t, create, onClose, onCreated, onError }: CreateDialogProps) {
  const [name, setName] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [baseRef, setBaseRef] = useState('')
  const [linkedIssue, setLinkedIssue] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (name.trim() === '' || sourcePath.trim() === '') return
    setCreating(true)
    try {
      const request: WorktreeTaskCreateRequest = {
        name: name.trim(),
        workspaceId: workspaceId('default'),
        sourcePath: sourcePath.trim(),
        ...(baseRef.trim() === '' ? {} : { baseRef: baseRef.trim() }),
        ...(linkedIssue.trim() === '' ? {} : { linkedIssue: linkedIssue.trim() }),
      }
      const task = await create(request, new AbortController().signal)
      void task
      onCreated()
    } catch (err) {
      onError(failureMessage(err))
    } finally {
      setCreating(false)
    }
  }, [name, sourcePath, baseRef, linkedIssue, create, onCreated, onError])

  return (
    <div className={css.section}>
      <h2>{t('create')}</h2>
      <div className={css.createForm}>
        <div className={css.formRow}>
          <label>{t('createTaskName')}</label>
          <input
            type="text"
            placeholder={t('createTaskNamePlaceholder')}
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className={css.formRow}>
          <label>{t('createSourcePath')}</label>
          <input
            type="text"
            placeholder={t('createSourcePathPlaceholder')}
            value={sourcePath}
            onChange={e => setSourcePath(e.target.value)}
          />
        </div>
        <div className={css.formRow}>
          <label>{t('createBaseRef')}</label>
          <input
            type="text"
            placeholder={t('createBaseRefPlaceholder')}
            value={baseRef}
            onChange={e => setBaseRef(e.target.value)}
          />
        </div>
        <div className={css.formRow}>
          <label>{t('createLinkedIssue')}</label>
          <input
            type="text"
            placeholder={t('createLinkedIssuePlaceholder')}
            value={linkedIssue}
            onChange={e => setLinkedIssue(e.target.value)}
          />
        </div>
      </div>
      <div className={css.formActions}>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={creating}>
          {t('cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={creating || name.trim() === '' || sourcePath.trim() === ''}
        >
          {creating ? t('creating') : t('create')}
        </Button>
      </div>
    </div>
  )
}
