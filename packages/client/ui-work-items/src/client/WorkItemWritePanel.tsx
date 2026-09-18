/** External-write editor with server-owned preview identities and explicit confirmation. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkItemMutation, WorkItemSource, WorkItemWriteStatus } from '@deepseek-ai/dsh-work-items/types'
import type { WorkItemView, WorkItemWriteOperation } from '@deepseek-ai/dsh-api-work-items-controller/types'
import type { WorkItemsSectionProps } from './WorkItemsSection.tsx'
import type { WorkItemsKey } from './locales.ts'
import css from './WorkItemsSection.module.css'

type Props = Pick<WorkItemsSectionProps, 't' | 'prepareWrite' | 'confirmWrite' | 'cancelWrite' | 'listWrites' | 'target'>
  & { source: WorkItemSource | undefined; item: WorkItemView | undefined }
const statusKey: Record<WorkItemWriteStatus, WorkItemsKey> = {
  prepared: 'writeStatusPrepared', running: 'writeStatusRunning', succeeded: 'writeStatusSucceeded',
  failed: 'writeStatusFailed', unknown: 'writeStatusUnknown', canceled: 'writeStatusCanceled', expired: 'writeStatusExpired',
}

/**
 * Render a mutation editor and exact persisted approval/receipt records.
 * @param props - Current source/item, optional search target, and generated Host operations.
 * @returns User-driven preview and confirmation controls; mounting sends no write.
 */
export function WorkItemWritePanel({ t, source, item, target, prepareWrite, confirmWrite, cancelWrite, listWrites }: Props): ReactNode {
  const [kind, setKind] = useState<WorkItemMutation['kind']>('create')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [state, setState] = useState('')
  const [assignees, setAssignees] = useState('')
  const [records, setRecords] = useState<readonly WorkItemWriteOperation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()
  const operation = useRef<AbortController>()
  const disclosure = useRef<HTMLDetailsElement>(null)
  useEffect(() => () => { operation.current?.abort() }, [])
  useLayoutEffect(() => {
    if (target === undefined || !target.anchorId.startsWith('work-items-write-') || disclosure.current === null) return
    disclosure.current.open = true
    if (target.anchorId === 'work-items-write-title') setKind('create')
    if (target.anchorId === 'work-items-write-body') setKind(current => current === 'comment' ? current : 'create')
    if (target.anchorId === 'work-items-write-state') setKind('state')
    if (target.anchorId === 'work-items-write-assignees') setKind('assign')
  }, [target])

  const run = async (action: (signal: AbortSignal) => Promise<readonly WorkItemWriteOperation[]>): Promise<void> => {
    if (operation.current !== undefined && !operation.current.signal.aborted) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true)
    setError(undefined)
    try {
      const next = await action(controller.signal)
      if (!controller.signal.aborted) setRecords(next)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause ?? null)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      controller.abort()
    }
  }

  const preview = async (): Promise<void> => {
    if (source === undefined) return
    let mutation: WorkItemMutation
    if (kind === 'create') mutation = { kind, source, title, body }
    else {
      if (item === undefined) return
      if (kind === 'comment') mutation = { kind, id: item.id, body }
      else if (kind === 'state') mutation = { kind, id: item.id, state }
      else mutation = { kind, id: item.id, assignees: assignees.split(',').map(text => text.trim()).filter(Boolean) }
    }
    await run(async signal => [(await prepareWrite({ mutation }, signal)).operation])
  }

  return <details ref={disclosure} className={css.writePanel}>
    <summary>{t('writes')}</summary><p className={css.help}>{t('writeHint')}</p>
    {item === undefined ? <p className={css.help}>{t('writeSelectItem')}</p> : null}
    <div className={css.filters}>
      <label className={css.filter} data-settings-anchor="work-items-write-kind"><span>{t('writeKind')}</span><select value={kind} disabled={busy} onChange={(event) => {
        const next = event.currentTarget.value
        setKind(next === 'state' || next === 'assign' || next === 'comment' ? next : 'create')
      }}>
        <option value="create">{t('writeCreate')}</option><option value="comment" disabled={item === undefined}>{t('writeComment')}</option>
        <option value="state" disabled={item === undefined}>{t('writeState')}</option>
        <option value="assign" disabled={item === undefined}>{t('writeAssign')}</option>
      </select></label>
      {kind === 'create' ? <label className={css.filter} data-settings-anchor="work-items-write-title"><span>{t('writeTitle')}</span>
        <Input className={css.input ?? ''} value={title} maxLength={500} disabled={busy}
          onChange={(event) => { setTitle(event.currentTarget.value) }} /></label> : null}
      {kind === 'create' || kind === 'comment'
        ? <label className={css.filter} data-settings-anchor="work-items-write-body"><span>{t('writeBody')}</span><textarea value={body} maxLength={20_000} disabled={busy} onChange={(event) => { setBody(event.currentTarget.value) }} /></label>
        : <label className={css.filter} data-settings-anchor={kind === 'state' ? 'work-items-write-state' : 'work-items-write-assignees'}>
          <span>{t(kind === 'state' ? 'writeStateValue' : 'writeAssignees')}</span>
          <Input className={css.input ?? ''} value={kind === 'state' ? state : assignees} aria-label={t(kind === 'state' ? 'writeStateValue' : 'writeAssignees')}
            disabled={busy || item === undefined} onChange={(event) => {
              if (kind === 'state') setState(event.currentTarget.value)
              else setAssignees(event.currentTarget.value)
            }} />
          <span className={css.help}>{t(kind === 'state' ? 'writeStateHelp' : 'writeAssigneesHelp')}</span>
        </label>}
    </div>
    <div className={css.actions}>
      <Button variant="outline" className={css.button} data-settings-anchor="work-items-write-preview"
        disabled={busy || source === undefined || kind !== 'create' && item === undefined} onClick={() => { void preview() }}>{t('writePreview')}</Button>
      <Button className={css.button} data-settings-anchor="work-items-write-history" disabled={busy || source === undefined}
        onClick={() => { if (source !== undefined) void run(async signal => (await listWrites({ source, limit: 20 }, signal)).operations) }}>{t('writeHistory')}</Button>
    </div>
    {error === undefined ? null : <p role="alert" className={css.error}>{t('error', { message: error instanceof Error ? error.message : t('unknownError') })}</p>}
    {records.map(record => <article key={record.operationId} className={css.receipt}>
      <p>{t(statusKey[record.status])}</p>
      <pre>{JSON.stringify({ scope: record.scope, mutation: record.mutation, target: record.target }, null, 2)}</pre>
      {record.status === 'unknown' || record.status === 'running' ? <p role="status">{t('writeUnknown')}</p> : null}
      {record.errorCode === undefined ? null : <p>{record.errorCode}</p>}
      {record.status === 'prepared' ? <div className={css.actions}>
        <Button variant="outline" className={css.button} disabled={busy} onClick={() => {
          void run(async signal => [(await confirmWrite({ operationId: record.operationId }, signal)).operation])
        }}>{t('writeConfirm')}</Button>
        <Button className={css.button} disabled={busy} onClick={() => {
          void run(async signal => [(await cancelWrite({ operationId: record.operationId }, signal)).operation])
        }}>{t('writeCancel')}</Button>
      </div> : null}
      {record.result === undefined ? null : <a href={record.result.url} target="_blank" rel="noreferrer">{record.result.url}</a>}
    </article>)}
  </details>
}
