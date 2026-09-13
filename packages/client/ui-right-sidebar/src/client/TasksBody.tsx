/** Worktree Task panel backed by the Worktree Task Remote. */
import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorktreeTaskId, WorktreeTaskView } from '@deepseek-ai/dsh-api-worktree-task-controller/types'
import css from './SidebarContributors.module.css'

export interface TasksBodyInjected {
  readonly list: () => Promise<{ readonly items: readonly WorktreeTaskView[] }>
  readonly activate: (taskId: WorktreeTaskId) => Promise<void>
  readonly hibernate: (taskId: WorktreeTaskId) => Promise<void>
}

type TasksBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<'rightSidebarContributors'> & TasksBodyInjected

export function TasksBody({ t, list, activate, hibernate }: TasksBodyProps): JSX.Element {
  const [tasks, setTasks] = useState<readonly WorktreeTaskView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useCallback(async () => {
    setBusy(true)
    try { setError(undefined); setTasks((await list()).items) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }, [list])
  useEffect(() => { void refresh() }, [refresh])
  const transition = useCallback(async (task: WorktreeTaskView, operation: 'activate' | 'hibernate') => {
    setBusy(true)
    try {
      setError(undefined)
      if (operation === 'activate') await activate(task.taskId)
      else await hibernate(task.taskId)
      await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setBusy(false) }
  }, [activate, hibernate, refresh])
  return (
    <section className={css.panel}>
      <div className={css.toolbar}><button type="button" className={css.button} onClick={() => { void refresh() }} disabled={busy}>{t('tasks.refresh')}</button></div>
      {busy && tasks.length === 0 ? <p className={css.muted}>{t('tasks.loading')}</p> : null}
      {tasks.length === 0 && !busy ? <p className={css.muted}>{t('tasks.empty')}</p> : null}
      <ul className={css.items}>
        {tasks.map(task => <li key={task.taskId} className={css.item}>
          <strong>{task.name}</strong>
          <span>{t('tasks.status')}: {task.status}</span>
          <span>{t('tasks.branch')}: {task.branch}</span>
          <span>{t('tasks.path')}: {task.checkoutPath}</span>
          <div className={css.toolbar}>
            {task.status === 'hibernated' ? <button type="button" className={css.button} onClick={() => { void transition(task, 'activate') }} disabled={busy}>{t('tasks.activate')}</button> : null}
            {task.status === 'active' ? <button type="button" className={css.button} onClick={() => { void transition(task, 'hibernate') }} disabled={busy}>{t('tasks.hibernate')}</button> : null}
          </div>
        </li>)}
      </ul>
      {error !== undefined ? <p className={css.error} role="alert">{t('tasks.error', { message: error })}</p> : null}
    </section>
  )
}
