/** One retained task's rule, saved deliveries, run-time edits, deletion, and original-Session link. */
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button, IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconChevronUpOutlineRegular,
  IconClockOutlineRegular, IconCloseOutlineRegular,
  IconEllipsisOutlineRegular, IconTrashOutlineRegular, Modal, Pill, ReferenceIconRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
/** One task's rule, saved deliveries, edits, runs, and linked Session. */
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ScheduleCatalogEntry, ScheduleEditRequest, ScheduleId } from '@deepseek-ai/dsh-schedule/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  Button, IconCloseOutlineRegular, IconEllipsisOutlineRegular, IconPauseOutlineRegular, IconPlayOutlineRegular,
  IconChevronRightOutlineRegular, Menu, MenuItemButton, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { CatalogFeedback } from './CatalogFeedback.tsx'
import { DeliveryHistory, type DeliveryHistoryInjected } from './DeliveryHistory.tsx'
import type { CatalogDeleteOutcome, CatalogSnapshot } from './catalog-source.ts'
import { TaskEditorFields, draftTarget, projectChoices, targetLabelKey, taskDraft, taskDraftValid } from './TaskEditorFields.tsx'
import { timingFromDraft } from './editor-timing.ts'
import { formatAvailableAt, formatScheduleFrequency, nextRunParts, recordTimeZone, zoneLabel } from './schedule-format.ts'
import { sessionLinkState } from './session-link.ts'
import { taskNextRunAt, taskSessionId } from './task-record.ts'
import { NewSessionLimit } from './NewSessionLimit.tsx'
import { RELATIVE_CLOCK_PERIOD_MS, useRelativeClock } from './relative-clock.ts'
import css from './TaskManagerPage.module.css'

/** Localized reason the Host refused an edit, or reason the wiring could not confirm it. */
export type HostEditFailure = 'host.saveError' | 'host.conflict' | 'host.notFuture' | 'host.invalidRule' | 'detail.missing'

/** Localized reason the Host refused a run, or reason the wiring could not confirm it. */
export type HostRunFailure = 'host.runError' | 'host.executionPending' | 'detail.missing'

/** Target-based mutations supplied by the owning plugin's Remote wiring. */
export interface HostTaskActions {
  /**
   * Apply one edit and refresh the catalog after the Host answers.
   * @param request - task, change, and the `updatedAt` value that the change started from.
   * @returns `saved`, or the localized reason the edit did not take effect.
   */
  readonly edit: (request: ScheduleEditRequest) => Promise<'saved' | { readonly failed: HostEditFailure }>
  /**
   * Queue one run now and refresh the catalog after the Host answers.
   * @param id - task to run.
   * @returns `queued`, or the localized reason the run did not start.
   */
  readonly run: (id: ScheduleId) => Promise<'queued' | { readonly failed: HostRunFailure }>
  /** Read the configured minimum new-conversation interval; undefined means the read failed. */
  readonly loadNewSessionInterval: () => Promise<number | undefined>
}

/** The two views of one task's detail: its rule, or its saved delivery records. */
export type TaskDetailTab = 'rule' | 'records'

/** Deletion, Host edit and run, saved-history, and linked-Session actions one task's detail calls. */
export interface TaskDetailInjected extends DeliveryHistoryInjected {
  /** Host-owned edit, run, and new-Session interval actions. */
  readonly hostActions: HostTaskActions
  /**
   * Delete one task.
   * @param id - Task shown in this detail.
   * @returns The deletion's outcome after the Remote acknowledgement and
   * authoritative refresh; the wiring reports it as the app-wide toast.
   */
  readonly onDelete: (id: ScheduleId) => Promise<CatalogDeleteOutcome>
  /**
   * Reload the catalog after a query failure or an acknowledged edit,
   * and from a surface that needs a read newer than its own record.
   * @param since - request ordinal the caller last observed, 0 to share any read in flight.
   * @returns Resolution after publishing the read result; failures remain in catalog state.
   */
  readonly onRetry: (since?: number) => Promise<void>
  /**
   * Open an available, unarchived linked conversation after rechecking current metadata.
   * @param id - Session linked to the shown task.
   */
  readonly onOpenSession: (id: SessionId) => void
}

/** One task's detail, as the Tasks page and the task tab both compose it. */
export type TaskDetailProps = TaskDetailInjected
  & PropsLocale<'schedule.manager'>
  & Pick<PropsRuntime<'main'>, 'useSessions' | 'useWorkspaces'>
  & {
    /** Task shown; an authoritative catalog row refreshes on its own outside an open edit. */
    readonly task: ScheduleCatalogEntry
    /**
     * Whether an authoritative catalog row backs the shown task; a retained task alone disables its edit, pause,
     * run, and delete entries.
     */
    readonly authoritative: boolean
    /** Element id shared by the detail panels and any control that points at them. */
    readonly id: string
    /** Catalog query state; loading keeps every action visible and disabled. */
    readonly status: 'loading' | 'ready' | 'error'
    /** Tasks with a deletion in flight. */
    readonly deleting: readonly ScheduleId[]
    /**
     * Report the task that an open edit started from or that a confirmed deletion is removing, so its owner
     * retains it outside the catalog, or null when that edit closes or the Host does not apply that deletion.
     */
    readonly onEditState: (task: ScheduleCatalogEntry | null) => void
    /** Active detail view; the owner resets it to Rules when it selects another task. */
    readonly tab: TaskDetailTab
    /** Select the active detail view. */
    readonly onTabChange: (tab: TaskDetailTab) => void
    /** Task whose deletion confirmation the owner asked for, or null when none is open. */
    readonly confirmId: ScheduleId | null
    /** Ask for one task's deletion confirmation, or dismiss it with null. */
    readonly onConfirm: (id: ScheduleId | null) => void
    /**
     * Leave the shown task once the Host applied its deletion and the catalog refresh after it
     * settled: the Tasks page clears its selection and the session task tab closes.
     */
    readonly onDeleted: () => void
    /** Close this detail; a view with no list to return to omits the control. */
    readonly onClose?: () => void
  }

/** One task detail's editing state, as its Tasks page or task tab owns it. */
export interface TaskDetailController {
  /** Catalog row the shown id resolves to, or undefined when the read has no such row. */
  readonly record: ScheduleCatalogEntry | undefined
  /** Task to show: the catalog row, or the task that an open edit or a confirmed deletion retained. */
  readonly task: ScheduleCatalogEntry | undefined
  /** Props the shared detail element takes, without the task it shows. */
  readonly props: Omit<TaskDetailProps, 'task' | 'authoritative' | 'onClose' | 'onDeleted'>
}

/**
 * Own the editing state one task detail shares across both of its owners.
 *
 * The shown task is the catalog row for `taskId`, or the task that an open edit
 * or a confirmed deletion of that row retained after the row left the catalog.
 * The view, the confirmation, and the retained task all reset when `taskId`
 * changes, so one task's edit never carries into another.
 * @param injected - detail actions, localized copy, and framework readers.
 * @param catalog - the owner's authoritative task catalog snapshot.
 * @param taskId - task the owner selected, or undefined when it selected none.
 * @returns the shown task and catalog row, its element id, its confirmation, and the detail props.
 */
export function useTaskDetail(
  injected: TaskDetailInjected & PropsLocale<'schedule.manager'> & Pick<PropsRuntime<'main'>, 'useSessions' | 'useWorkspaces'>,
  catalog: CatalogSnapshot<ScheduleCatalogEntry>,
  taskId: ScheduleId | undefined,
): TaskDetailController {
  const [draft, setDraft] = useState<ScheduleCatalogEntry | null>(null)
  const [tab, setTab] = useState<TaskDetailTab>('rule')
  const [confirmId, setConfirmId] = useState<ScheduleId | null>(null)
  const id = useId()
  useEffect(() => {
    setDraft(null)
    setTab('rule')
    setConfirmId(null)
  }, [taskId])
  const record = taskId === undefined ? undefined : catalog.records.find(item => item.id === taskId)
  const task = record ?? (draft !== null && draft.id === taskId ? draft : undefined)
  return {
    record, task,
    props: {
      ...injected,
      status: catalog.status,
      deleting: catalog.deleting,
      id,
      onEditState: setDraft,
      tab,
      onTabChange: setTab,
      confirmId,
      onConfirm: setConfirmId,
    },
  }
}

/**
 * Render one task's rule or saved deliveries; changing its id resets the edit.
 * @param props - Task, catalog state, detail view, confirmation, locale, and actions.
 * @returns The detail region and its deletion confirmation dialog.
 */
export function TaskDetail(props: TaskDetailProps): ReactNode {
  return <TaskDetailView key={props.task.id} {...props} />
}

function TaskDetailView(props: TaskDetailProps): ReactNode {
  const { task, id, tab, onTabChange, onClose, onDelete, onConfirm, confirmId, onDeleted,
    onRetry, onOpenSession, loadHistory, status, deleting, useSessions, useWorkspaces, t, hostActions } = props
  const sessions = useSessions(snapshot => snapshot)
  const workspaces = useWorkspaces(snapshot => snapshot)
  const detailTabsRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  // The next-run line states how long remains, so the panel reads the same
  // ticking clock the task list does.
  const now = useRelativeClock()
  const busy = deleting.includes(task.id) || status === 'loading'
  const confirming = authoritative && confirmId === task.id
  const sessionLink = sessionLinkState(task.sessionId, sessions, workspaces)
  const linkedSession = sessionLabel(task.sessionId, sessions)
  const sessionNotice = sessionLink === 'available' ? undefined : t(sessionLinkMessages[sessionLink])
  const linkedShown = tab === 'rule' && withinSession !== task.sessionId
  const linkedText = t('detail.session')
  const [linkedCompact, setLinkedCompact] = useState(false)
  const linkedRef = useRef<HTMLSpanElement>(null)
  // The expanded entry's width for its current label, measured while it last
  // rendered expanded; the compact icon cannot report it.
  const linkedExpanded = useRef<{ label: string; width: number } | undefined>(undefined)
  const linkedAction = linkedSession.titled
    ? t('detail.openSessionTitle', { title: linkedSession.text })
    : t('detail.openSession')
  // The Session name is the entry's visually hidden accessible description in both layouts.
  const linkedName = <span id={`${id}-session`} className={css.linkedSessionName}>{linkedSession.text}</span>
  const linkedDescribedBy = `${id}-session${sessionNotice === undefined ? '' : ` ${id}-session-state`}`
  useLayoutEffect(() => {
    if (!linkedShown) return
    const tabs = detailTabsRef.current as HTMLDivElement
    const linked = linkedRef.current as HTMLSpanElement
    const measure = (): void => {
      const width = linked.getBoundingClientRect().width
      if (!linkedCompact) linkedExpanded.current = { label: linkedText, width }
      // The first measurement is always expanded, so a width is recorded; a
      // label changed while compact has no expanded width for that label yet.
      const expanded = linkedExpanded.current as { label: string; width: number }
      if (expanded.label !== linkedText) {
        setLinkedCompact(false)
        return
      }
      // The tab list grows into the strip's free width, so its own width cannot
      // tell whether its tabs overflow; the tabs' extent can. The expanded entry
      // fits only when that extent still fits in the width it would leave.
      const extent = (tabs.lastElementChild as Element).getBoundingClientRect().right
        - (tabs.firstElementChild as Element).getBoundingClientRect().left
      // Expanding again takes 1px more room than collapsing, so whole-pixel
      // clientWidth rounding cannot switch the two layouts back and forth.
      setLinkedCompact(extent > tabs.clientWidth - (expanded.width - width) - (linkedCompact ? 1 : 0))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(tabs)
    // A tab label can widen, as when a web font loads, without resizing the list.
    for (const tab of tabs.children) observer.observe(tab)
    return () => { observer.disconnect() }
  }, [linkedShown, linkedCompact, linkedText])
  const taskIdentity = `${task.sessionId}\u0000${task.id}`
  const [edit, setEdit] = useState<RuleEdit>(() => initialRuleEdit(task))
  // The elapsed-interval unit lives here, not in the Run time card, so the saved
  // draft's below-floor message states the same unit the row shows.
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(() => preferredIntervalUnit(edit.shown.draft.seconds))
  // A unit the user picked in the Repeat menu outranks the seeded seconds, so
  // the kind effect below must not derive one back from the whole-hour seed and
  // overwrite the explicit choice.
  const explicitUnit = useRef(false)
  const previousKind = useRef(edit.shown.kind)
  useEffect(() => {
    if (previousKind.current === edit.shown.kind) return
    previousKind.current = edit.shown.kind
    if (edit.shown.kind !== 'every') {
      // Leaving the interval drops the explicit choice with the row that held it.
      explicitUnit.current = false
      return
    }
    if (explicitUnit.current) return
    setIntervalUnit(preferredIntervalUnit(edit.shown.draft.seconds))
  }, [edit.shown.kind, edit.shown.draft.seconds])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => taskDraft(task))
  const [base, setBase] = useState(task)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<HostEditFailure | HostRunFailure | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    panelRef.current?.focus({ preventScroll: true })
    return () => { mounted.current = false }
  }, [])
  const floorEndsAt = task.deliveryFloorEndsAt === undefined ? undefined : Date.parse(task.deliveryFloorEndsAt)
  // A sample at the floor's end enables Run now when the interval passes, not up to one period later.
  const now = useRelativeClock(RELATIVE_CLOCK_PERIOD_MS, floorEndsAt)
  const busy = pending || status === 'loading' || deleting.includes(task.id)
  const executionActive = task.executionActive === true
  const deliveryFloor = floorEndsAt !== undefined && floorEndsAt > now
  const linkedId = taskSessionId(task)
  const linkedText = linkedId === undefined ? '' : sessions.byId[linkedId]?.displayTitle ?? linkedId
  const linkedState = linkedId === undefined ? 'unavailable' : sessionLinkState(linkedId, sessions, workspaces)
  // The Host refuses to deliver to an archived target Session.
  const targetArchived = task.target.kind !== 'new' && linkedState === 'archived'
  // Only the interval needs the row to explain itself: each other cause shows in the detail or is transient.
  const runHeld = busy || editing || executionActive || targetArchived || !props.authoritative
  const nextRunAt = taskNextRunAt(task)
  const next = nextRunParts(nextRunAt, t('time.locale'), now, t)
  // SessionListState gives every listed id a byId row.
  const choices = sessions.ids.map(value => ({ value, label: (sessions.byId[value] as SessionSummary).displayTitle }))
  const projects = projectChoices(workspaces.items, t('host.defaultProject'))

  const beginEdit = (): void => {
    setBase(task)
    setDraft(taskDraft(task))
    setFailure(null)
    props.onEditState(task)
    setEditing(true)
    onTabChange('rule')
  }
  const save = async (): Promise<void> => {
    setPending(true)
    setFailure(null)
    const target = draftTarget(draft, base)
    const seeded = taskDraft(base)
    const timingChanged = JSON.stringify(timingFromDraft(draft)) !== JSON.stringify(timingFromDraft(seeded))
    const targetChanged = draft.target !== seeded.target || draft.sessionId !== seeded.sessionId || draft.cwd !== seeded.cwd
    const patch = {
      ...(draft.title === base.title ? {} : { title: draft.title }),
      ...(draft.prompt === base.prompt ? {} : { prompt: draft.prompt }),
      ...(timingChanged ? { timing: timingFromDraft(draft, true) } : {}),
      ...(targetChanged ? { target } : {}),
    }
    if (Object.keys(patch).length === 0) Object.assign(patch, { title: draft.title })
    const outcome = await hostActions.edit({ id: task.id, action: 'update', patch, expectedUpdatedAt: base.updatedAt ?? null })
    if (!mounted.current) return
    // The read-only view returns at once, so its Edit button can take back the focus of the removed Save button.
    flushSync(() => {
      setPending(false)
      if (outcome === 'saved') { setEditing(false); props.onEditState(null) }
      else setFailure(outcome.failed)
    })
    if (outcome === 'saved') editRef.current?.focus()
  }
  const setActive = async (): Promise<void> => {
    setPending(true)
    const outcome = await hostActions.edit({ id: task.id, action: 'update', patch: { active: task.status !== 'active' }, expectedUpdatedAt: task.updatedAt ?? null })
    if (!mounted.current) return
    setPending(false)
    setFailure(outcome === 'saved' ? null : outcome.failed)
  }
  const run = async (): Promise<void> => {
    setMenuOpen(false)
    setPending(true)
    const outcome = await hostActions.run(task.id)
    if (!mounted.current) return
    setPending(false)
    setFailure(outcome === 'queued' ? null : outcome.failed)
  }

  return <>
    <aside ref={panelRef} tabIndex={-1} className={css.detail} id={id} aria-label={t('detail.label')}>
      <div className={css.detailTabsBar}>
        <div className={css.detailTabs} role="tablist" aria-label={t('detail.tabs')}>
          {(['rule', 'records'] as const).map(value => <button key={value} type="button" role="tab"
            id={`${id}-${value}-tab`} aria-controls={`${id}-${value}-panel`} tabIndex={tab === value ? 0 : -1}
            aria-selected={tab === value} className={css.detailTab}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : value === 'rule' ? 1 : 0
              onTabChange(next === 0 ? 'rule' : 'records')
              const button = event.currentTarget.parentElement?.children[next]
              if (button instanceof HTMLButtonElement) button.focus()
            }}
            onClick={() => { onTabChange(value) }}>{t(value === 'rule' ? 'detail.rule' : 'detail.records')}</button>)}
        </div>
        <div className={css.detailActions}>
          {/* The original Session belongs to the strip that also carries the view
              tabs and the task's own actions, so it stays visible while the
              detail scrolls. Rules-only: the records view has no linked row. A
              detail hosted inside the linked Session itself omits the entry. */}
          {/* One Button serves both layouts, so crossing the fit threshold keeps
              its keyboard focus. The tooltip anchors on the wrapper, which still
              receives hover while the Button is disabled. */}
          {linkedShown && <Tooltip label={linkedText} side="bottom" portal disabled={!linkedCompact}>
            <span ref={linkedRef} className={css.detailContext}>
              <Button
                size={linkedCompact ? 'sm' : 'md'}
                className={linkedCompact ? css.detailIconButton : css.linkedSession}
                title={linkedCompact ? undefined : linkedSession.titled ? linkedSession.text : task.sessionId}
                aria-label={linkedAction}
                aria-describedby={linkedDescribedBy}
                disabled={sessionLink !== 'available'}
                onClick={() => { onOpenSession(task.sessionId) }}
              >
                {linkedCompact
                  ? <>
                    <ReferenceIconRegular kind="session" />
                    {linkedName}
                  </>
                  : <>
                    <span className={css.linkedSessionLabel}>{linkedText}</span>
                    <span className={css.linkedSessionTarget}>
                      {linkedName}
                      <IconChevronRightOutlineRegular />
                    </span>
                  </>}
              </Button>
            </span>
          </Tooltip>}
          {/* The menu closes Escape from its own document keydown listener; this
              wrapper covers a menu whose own listener stands down, where the page's
              Escape handler would otherwise close the whole detail with it. */}
          <span className={css.menuGuard} onKeyDown={(event) => {
            guardMenuEscape(event, menuOpen, () => {
              setMenuOpen(false)
              moreRef.current?.focus()
            })
          }}>
            <TaskMenu
              open={menuOpen}
              onClose={() => { setMenuOpen(false) }}
              items={menuItems}
          {!editing && <Button ref={editRef} size="sm" disabled={busy || executionActive || !props.authoritative} onClick={beginEdit}>{t('host.edit')}</Button>}
          <Tooltip label={t(task.status === 'active' ? 'host.pause' : 'host.resume')} side="bottom" delayMs={500} portal>
            <span><Button size="sm" className={css.detailIconButton} disabled={busy || editing || executionActive || task.status === 'ended' || !props.authoritative}
              aria-label={t(task.status === 'active' ? 'host.pause' : 'host.resume')} onClick={() => { void setActive() }}>
              {task.status === 'active' ? <IconPauseOutlineRegular /> : <IconPlayOutlineRegular />}
            </Button></span>
          </Tooltip>
          <Menu open={menuOpen} onClose={() => { setMenuOpen(false) }} align="end" portal autoFocus
            anchor={<Button ref={moreRef} size="sm" className={css.detailIconButton} aria-label={t('detail.more')}
              aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen(value => !value) }}>
              <IconEllipsisOutlineRegular />
            </Button>}>
            <MenuItemButton disabled={runHeld || deliveryFloor}
              disabledReason={deliveryFloor && !runHeld
                ? t('host.runAfterInterval', { time: formatAvailableAt(floorEndsAt, t('time.locale'), now) }) : undefined}
              onSelect={() => { void run() }}>{t('host.run')}</MenuItemButton>
            <MenuItemButton disabled={busy || editing || executionActive || !props.authoritative}
              onSelect={() => {
                // The dialog returns focus to the control that held it on open, not to the removed menu row.
                moreRef.current?.focus()
                setMenuOpen(false)
                onConfirm(task.id)
              }}>
              {t('delete.action')}
            </MenuItemButton>
          </Menu>
          {onClose !== undefined && <Button size="sm" className={css.detailIconButton} aria-label={t('detail.close')}
            disabled={pending} onClick={onClose}><IconCloseOutlineRegular /></Button>}
        </div>
      </div>
      <div className={clsx(css.detailScroll, tab === 'records' && css.detailRecords)} role="tabpanel"
        id={`${id}-${tab}-panel`} aria-labelledby={`${id}-${tab}-tab`} tabIndex={0}>
        <CatalogFeedback status={status} populated onRetry={onRetry} t={t} />
        {tab === 'rule' && <>
          {!editing && <>
            <header className={css.detailHeader}><h2 className={css.readonlyName}>{task.title}</h2></header>
            <div className={css.nextRun}><p>{task.status === 'active'
              ? <>{t('detail.nextRun')} <time dateTime={nextRunAt}>{next.absolute}</time>{' '}
                <span className={css.nextRunRelative}>{next.relative}</span></>
              : t(`status.${task.status}`)}</p></div>
            <p className={css.readonlyPrompt}>{task.prompt}</p>
            <div className={css.ruleCard}>
              <div className={css.hostRuleRow}><span>{t('rule.repeat')}</span><span>{formatScheduleFrequency(task, t, {
                system: Intl.DateTimeFormat().resolvedOptions().timeZone, label: zone => zoneLabel(zone, t),
              })}</span></div>
              <div className={css.hostRuleRow}><span>{t('host.target')}</span><span>{t(targetLabelKey(task.target.kind))}</span></div>
            </div>
            {linkedId !== undefined && linkedState !== 'available' && task.target.kind === 'session'
              && <p className={css.detailNotice} role="status">{t(linkedState === 'archived' ? 'detail.sessionArchived'
                : linkedState === 'loading' ? 'detail.sessionLoading' : 'detail.sessionUnavailable')}</p>}
            {/* A refused run states the same cause, so it alone reports a queued or running execution. */}
            {executionActive && failure !== 'host.executionPending'
              && <p className={css.detailNotice} role="status">{t('host.executionActive')}</p>}
          </>}
          {editing && <TaskEditorFields draft={draft} onChange={setDraft} disabled={pending}
            projects={projects} original={base} t={t} />}
          {editing && draft.target === 'new'
            && <NewSessionLimit load={hostActions.loadNewSessionInterval} t={t} />}
          {/* A refused run is an expected wait, not a failure of the Host or of the user's input. */}
          {failure === 'host.executionPending' ? <p className={css.detailNotice} role="status">{t(failure)}</p>
            : failure !== null && <p className={css.saveFailure} role="alert">{t(failure)}</p>}
          {failure === 'host.conflict' && <Button onClick={beginEdit}>{t('host.reload')}</Button>}
        </>}
        {tab === 'records' && <DeliveryHistory id={task.id} latestMessageId={task.lastDelivery?.messageId}
          timeZone={recordTimeZone(task)} loadHistory={loadHistory} onOpenSession={onOpenSession}
          sessionTitles={Object.fromEntries(choices.map(choice => [choice.value, choice.label]))}
          availableSessionIds={sessions.ids.filter(value => sessionLinkState(value, sessions, workspaces) === 'available')} t={t} />}
      </div>
      {editing ? <footer className={css.saveFooter}>
        <span className={css.saveNotice}>{t('rule.unsaved')}</span>
        <Button disabled={pending} onClick={() => { setEditing(false); props.onEditState(null); setFailure(null) }}>{t('rule.cancel')}</Button>
        <Button variant="primary" disabled={pending || !taskDraftValid(draft) || failure === 'host.conflict'}
          onClick={() => { void save() }}>{t(pending ? 'rule.saving' : 'rule.save')}</Button>
      </footer> : (task.target.kind !== 'new' || linkedId !== undefined) && <footer className={css.hostSessionFooter}>
        <span>{t(task.target.kind === 'new' ? 'host.latestConversation' : 'detail.session')}</span>
        {linkedId === undefined || (task.target.kind === 'new_once' && linkedState === 'unavailable')
          ? <span className={css.hostSessionEmpty}>{t('host.sessionAfterFirstRun')}</span>
          : <Button variant="outline" disabled={linkedState !== 'available'}
            aria-label={linkedText === linkedId ? t('detail.openSession') : t('detail.openSessionTitle', { title: linkedText })}
            onClick={() => { onOpenSession(linkedId) }}>
            {linkedText}<IconChevronRightOutlineRegular />
          </Button>}
      </footer>}
    </aside>
    <Modal open={confirmId === task.id} className={css.confirmDialog as string} contentClassName={css.confirmContent as string}
      title={t('delete.title')} description={t('delete.description')} closeLabel={t('delete.close')} onClose={() => { onConfirm(null) }}
      footer={<div className={css.confirmActions}>
        <Button data-modal-autofocus onClick={() => { onConfirm(null) }}>{t('delete.cancel')}</Button>
        <Button disabled={busy} onClick={() => {
          onConfirm(null)
          // The refresh that drops the row lands before the outcome, so the owner retains the task until then.
          props.onEditState(task)
          void onDelete(task.id).then((outcome) => {
            if (!mounted.current) return
            if (outcome === 'deleted') onDeleted()
            else props.onEditState(null)
          })
        }}>{t('delete.confirm')}</Button>
      </div>}><p className={css.confirmPrompt}>{task.prompt}</p></Modal>
  </>
}
