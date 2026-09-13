/** External-write editor with server-owned preview identities and explicit confirmation. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkItemMutation, WorkItemSource, WorkItemWriteStatus } from '@deepseek-ai/dsh-work-items/types'
import type { WorkItemView, WorkItemWriteOperation } from '@deepseek-ai/dsh-api-work-items-controller/types'
import type { WorkItemsSectionProps } from './WorkItemsSection.tsx'
import type { WorkItemsKey } from './locales.ts'
import css from './WorkItemsSection.module.css'

type Props = Pick<WorkItemsSectionProps, 't' | 'prepareWrite' | 'confirmWrite' | 'cancelWrite' | 'listWrites'>
  & { source: WorkItemSource; item: WorkItemView | undefined }
const statusKey: Record<WorkItemWriteStatus, WorkItemsKey> = {
  prepared: 'writeStatusPrepared', running: 'writeStatusRunning', succeeded: 'writeStatusSucceeded',
  failed: 'writeStatusFailed', unknown: 'writeStatusUnknown', canceled: 'writeStatusCanceled', expired: 'writeStatusExpired',
}

/**
 * Render a mutation editor and exact persisted approval/receipt records.
 * @param props - Current source/item and generated Host operations.
 * @returns User-driven preview and confirmation controls; mounting sends no write.
 */
export function WorkItemWritePanel({ t, source, item, prepareWrite, confirmWrite, cancelWrite, listWrites }: Props): ReactNode {
  const [kind, setKind] = useState<WorkItemMutation['kind']>('create')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [value, setValue] = useState('')
  const [records, setRecords] = useState<readonly WorkItemWriteOperation[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])

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
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('unknownError'))
    } finally {
      if (!controller.signal.aborted) setBusy(false)
      controller.abort()
    }
  }

  const preview = async (): Promise<void> => {
    let mutation: WorkItemMutation
    if (kind === 'create') mutation = { kind, source, title, body }
    else {
      if (item === undefined) return
      if (kind === 'comment') mutation = { kind, id: item.id, body }
      else if (kind === 'state') mutation = { kind, id: item.id, state: value }
      else mutation = { kind, id: item.id, assignees: value.split(',').map(text => text.trim()).filter(Boolean) }
    }
    await run(async signal => [(await prepareWrite({ mutation }, signal)).operation])
  }

  return <details className={css.detail}>
    <summary>{t('writes')}</summary><p>{t('writeHint')}</p>
    <div className={css.filters}>
      <label className={css.filter}><span>{t('writeKind')}</span><select value={kind} disabled={busy} onChange={(event) => {
        const next = event.currentTarget.value
        setKind(next === 'state' || next === 'assign' || next === 'comment' ? next : 'create')
      }}>
        <option value="create">{t('writeCreate')}</option><option value="comment" disabled={item === undefined}>{t('writeComment')}</option>
        <option value="state" disabled={item === undefined}>{t('writeState')}</option><option value="assign" disabled={item === undefined}>{t('writeAssign')}</option>
      </select></label>
      {kind === 'create' ? <label className={css.filter}><span>{t('writeTitle')}</span><input value={title} maxLength={500} disabled={busy} onChange={(event) => { setTitle(event.currentTarget.value) }} /></label> : null}
      {kind === 'create' || kind === 'comment'
        ? <label className={css.filter}><span>{t('writeBody')}</span><textarea value={body} maxLength={20_000} disabled={busy} onChange={(event) => { setBody(event.currentTarget.value) }} /></label>
        : <label className={css.filter}><span>{t(kind === 'state' ? 'writeStateValue' : 'writeAssignees')}</span><input value={value} disabled={busy} onChange={(event) => { setValue(event.currentTarget.value) }} /></label>}
      <button type="button" className={css.button} disabled={busy || kind !== 'create' && item === undefined} onClick={() => { void preview() }}>{t('writePreview')}</button>
      <button type="button" className={css.button} disabled={busy} onClick={() => { void run(async signal => (await listWrites({ source, limit: 20 }, signal)).operations) }}>{t('writeHistory')}</button>
    </div>
    {error === undefined ? null : <p role="alert">{t('error', { message: error })}</p>}
    {records.map(record => <article key={record.operationId}>
      <p>{t(statusKey[record.status])}</p>
      <pre>{JSON.stringify({ scope: record.scope, mutation: record.mutation, target: record.target }, null, 2)}</pre>
      {record.status === 'unknown' || record.status === 'running' ? <p role="status">{t('writeUnknown')}</p> : null}
      {record.errorCode === undefined ? null : <p>{record.errorCode}</p>}
      {record.status === 'prepared' ? <div className={css.actions}>
        <button type="button" className={css.button} disabled={busy} onClick={() => {
          void run(async signal => [(await confirmWrite({ operationId: record.operationId }, signal)).operation])
        }}>{t('writeConfirm')}</button>
        <button type="button" className={css.button} disabled={busy} onClick={() => {
          void run(async signal => [(await cancelWrite({ operationId: record.operationId }, signal)).operation])
        }}>{t('writeCancel')}</button>
      </div> : null}
      {record.result === undefined ? null : <a href={record.result.url} target="_blank" rel="noreferrer">{record.result.url}</a>}
    </article>)}
  </details>
}
