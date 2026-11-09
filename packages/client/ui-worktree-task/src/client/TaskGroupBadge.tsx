/** Sidebar group badge and review overlay for Worktree Task checkouts. */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeTaskReview, WorktreeTaskView } from '@cinlan/api-worktree-task-controller/types'
import type { WorktreeTaskId } from '@cinlan/worktree-task/types'
import { WorktreeReviewPanel } from './WorktreeReviewPanel.tsx'
import type { WorktreeTaskLinks } from './links.ts'
import type { WorktreeTaskKey } from './locales.ts'
import css from './TaskGroupBadge.module.css'

/** Badge callbacks and shared link observation supplied by the registration. */
export interface TaskGroupBadgeInjected {
  hooks: { worktreeTaskLinks: SnapshotStore<WorktreeTaskLinks> }
  activate: (taskId: WorktreeTaskId) => Promise<void>
  openReview: (taskId: WorktreeTaskId) => void
}

/** Sidebar badge props. */
export type TaskGroupBadgeProps =
  & PropsRuntime<'sidebar.workspaces.group.trailing'>
  & PropsLocale<'settings.worktreeTask'>
  & InjectFace<TaskGroupBadgeInjected>

/**
 * Status badge, linked-issue link, Review entry, and hibernation activation
 * for one task-owned Workspace group row; renders nothing for plain workspaces.
 * @param props - slot owner, locale, and injected observation.
 * @returns the badge, or nothing when the Workspace has no task link.
 */
export function TaskGroupBadge(props: TaskGroupBadgeProps) {
  const links = props.useWorktreeTaskLinks(map => map)
  const link = links.get(props.workspaceId)
  if (link === undefined || link.status === undefined) return null
  const status = { active: props.t('statusActive'), hibernated: props.t('statusHibernated'),
    archived: props.t('statusArchived') }[link.status]
  return <span className={css.badge}>
    <span className={`${css.status} ${css[link.status]}`}>{status}</span>
    {link.linkedIssue !== undefined && <a className={css.issue} href={link.linkedIssue} target="_blank" rel="noreferrer">{link.linkedIssue}</a>}
    <Button variant="outline" className={css.action} onClick={() => { props.openReview(link.taskId) }}>{props.t('review')}</Button>
    {link.status === 'hibernated' && <Button variant="outline" className={css.action}
      onClick={() => { void props.activate(link.taskId) }}>{props.t('activate')}</Button>}
  </span>
}

/** Review overlay callbacks supplied by the registration. */
export interface WorktreeTaskReviewOverlayInjected {
  hooks: { worktreeTaskReview: SnapshotStore<WorktreeTaskView | undefined> }
  review: (taskId: WorktreeTaskId, signal: AbortSignal) => Promise<WorktreeTaskReview>
  closeReview: () => void
}

/** Review overlay props. */
export type WorktreeTaskReviewOverlayProps =
  & PropsRuntime<'shell.overlay'>
  & PropsLocale<'settings.worktreeTask'>
  & InjectFace<WorktreeTaskReviewOverlayInjected>
  & { t: (key: WorktreeTaskKey, params?: Record<string, unknown>) => string }

/**
 * Modal review surface opened from a group badge; renders nothing while closed.
 * @param props - overlay runtime, locale, and injected review state.
 * @returns the review modal, or nothing when no task is under review.
 */
export function WorktreeTaskReviewOverlay(props: WorktreeTaskReviewOverlayProps) {
  const task = props.useWorktreeTaskReview(value => value)
  if (task === undefined) return null
  return <Modal open onClose={props.closeReview} title={props.t('reviewTitle', { name: task.name })} headless>
    <WorktreeReviewPanel task={task} t={props.t} review={props.review} onClose={props.closeReview} />
  </Modal>
}
