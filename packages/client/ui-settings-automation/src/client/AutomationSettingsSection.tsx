/** Native settings page; useAutomation is bound by the Slots renderer to the API object. */
import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { AutomationDefinition, AutomationRequestId, AutomationRunRequest, AutomationRun } from '@deepseek-ai/dsh-automation/types'
import type { AutomationSettingsProps, EditingDraft } from './types.ts'
import type { AutomationSettingsKey } from './locales.ts'
import { definitionDraft, errorKey, isActive, utcTime } from './presentation.ts'
import { DraftForm } from './DraftForm.tsx'
import css from './AutomationSettings.module.css'

/**
 * Render authoritative tasks and journal data alongside local revision-fenced drafts.
 * @param props - framework source hook, locale, owner close callback, and plain commands.
 * @returns explicit task execution controls; no run is started by viewing or editing.
 */
export function AutomationSettingsSection(props: AutomationSettingsProps): ReactNode {
  const { useAutomation, create, update, deleteTask, run, cancel, refresh, loadRuns, loadMoreRuns, openSession, close, t } = props
  const snapshot = useAutomation(value => value)
  const runtime = snapshot.runtime?.status === 'ready' ? snapshot.runtime : null
  const catalog = snapshot.catalog
  const writable = snapshot.availability === 'ready' && snapshot.writable && runtime !== null
  const [draft, setDraft] = useState<EditingDraft>()
  const [deleteTarget, setDeleteTarget] = useState<Pick<AutomationDefinition, 'id' | 'revision'>>()
  const [retries, setRetries] = useState<Readonly<Record<string, AutomationRunRequest>>>({})
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ key: AutomationSettingsKey; error: boolean }>()
  const pending = useRef(false)
  const commit = async (operation: () => Promise<unknown>, accepted?: () => void): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setFeedback(undefined)
    try {
      await operation()
      accepted?.()
    } catch (error) {
      setFeedback({ key: errorKey(error), error: true })
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const begin = (): void => {
    if (!writable || catalog === null || draft !== undefined) return
    setFeedback(undefined)
    setDraft({ fields: { title: '', prompt: '', workspaceId: '', agentPresetId: catalog.defaults.agentPresetId,
      model: { ...catalog.defaults.model }, permissionPresetId: catalog.defaults.permissionPresetId,
      schedule: { kind: 'daily', hour: 0, minute: 0 } } })
  }
  const beginEdit = (definition: AutomationDefinition): void => {
    setFeedback(undefined)
    const { id, revision, enabled } = definition
    setDraft({ fields: definitionDraft(definition), original: { id, revision, enabled } })
  }
  const save = (): void => {
    if (!writable || draft === undefined) return
    const { fields, original } = draft
    if (fields.workspaceId === '' || fields.title.trim() === '' || fields.prompt.trim() === ''
      || (fields.schedule.kind === 'weekly' && fields.schedule.weekdays.length === 0)) {
      setFeedback({ key: 'invalid', error: true })
      return
    }
    const input = { ...fields, workspaceId: fields.workspaceId }
    void commit(() => original === undefined ? create(input) : update({ id: original.id, expectedRevision: original.revision,
      enabled: original.enabled, draft: input }), () => {
      setDraft(undefined)
      setFeedback({ key: original === undefined ? 'saved' : 'updated', error: false })
    })
  }
  const invoke = (definition: AutomationDefinition, retry?: AutomationRunRequest): void => {
    if (!writable || pending.current) return
    const request = retry ?? { id: definition.id, expectedRevision: definition.revision, requestId: randomUUID() as AutomationRequestId }
    setRetries(previous => ({ ...previous, [definition.id]: request }))
    const forgetRequest = (): void => {
      setRetries(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== definition.id)))
    }
    void commit(async () => {
      try { return await run(request) }
      catch (error) {
        if (['conflict', 'invalid', 'busy', 'resource', 'notFound', 'readonly'].includes(errorKey(error))) forgetRequest()
        throw error
      }
    }, forgetRequest)
  }
  const choicesAvailable = catalog !== null && catalog.workspaces.some(item => item.availability === 'ready')
    && catalog.agentPresets.some(item => item.availability === 'ready')
    && catalog.models.some(item => item.availability === 'ready' || item.availability === 'unlisted')
    && catalog.permissionPresets.some(item => item.availability === 'ready')
  const openRecordedSession = (id: AutomationRun['sessionId']): void => {
    if (id !== null) { openSession(id); close() }
  }
  const activeById = new Map(runtime?.activeRuns.map(item => [item.id, item]))
  const history = snapshot.history
  const refreshAll = (): void => {
    void commit(async () => { await refresh(); if (history !== null) await loadRuns(history.automationId) })
  }

  return <section className={css.section}>
    <header className={css.heading}><span className={css.scope}>{t('scope')}</span><h1>{t('title')}</h1><p>{t('description')}</p></header>
    <div className={css.actions}><Button disabled={busy || snapshot.loading} onClick={refreshAll}>{t('refresh')}</Button></div>
    {snapshot.availability !== 'ready' && <p className={css.notice} role="status">{t(snapshot.availability === 'loading' ? 'loading' : 'unavailable')}</p>}
    {!snapshot.writable && <p className={css.notice} role="status">{t('readonly')}</p>}
    {feedback !== undefined && <p className={feedback.error ? css.error : css.status} role={feedback.error ? 'alert' : 'status'}>{t(feedback.key)}</p>}
    {feedback === undefined && snapshot.error !== null && <p className={css.error} role="alert">{t(errorKey(snapshot.error))}</p>}

    <section className={css.group} data-settings-anchor="tasks" tabIndex={-1}>
      <h2>{t('tasks')}</h2><p className={css.help}>{t('tasksHelp')}</p>
      <div className={css.actions}><Button variant="outline" disabled={!writable || busy || !choicesAvailable || draft !== undefined} onClick={begin}>{t('newTask')}</Button></div>
      {catalog !== null && !choicesAvailable && <p className={css.notice}>{t('noChoices')}</p>}
      {runtime !== null && runtime.definitions.length === 0 && <p className={css.notice}>{t('empty')}</p>}
      <ul className={css.list}>{runtime?.definitions.map((definition) => {
        const active = runtime.activeRuns.filter(item => item.automationId === definition.id && isActive(item.status))
        const retry = retries[definition.id]
        return <li key={definition.id} className={css.row}>
          <div className={css.copy}>
            <h3>{definition.spec.title}</h3>
            <p className={css.help}>{definition.spec.workspacePath}</p>
            <p className={css.help}>{t(definition.enabled ? 'enabled' : 'disabled')} · {t('revision', { revision: definition.revision })}</p>
            <p className={css.help}>{t('next')}: {definition.nextPlannedAt === null ? t('none') : <time dateTime={utcTime(definition.nextPlannedAt)}>{utcTime(definition.nextPlannedAt)}</time>}</p>
            {definition.needsReview && <p className={css.warning} role="status">{t('review')}</p>}
            <div className={css.actions}>
              <Button disabled={!writable || busy || draft !== undefined} onClick={() => { beginEdit(definition) }}>{t('edit')}</Button>
              <Button disabled={!writable || busy || draft?.original?.id === definition.id} onClick={() => {
                void commit(() => update({ id: definition.id, expectedRevision: definition.revision,
                  draft: definitionDraft(definition), enabled: !definition.enabled }))
              }}>{t(definition.enabled ? 'pause' : 'enable')}</Button>
              <Button disabled={!writable || busy || active.length > 0} onClick={() => { invoke(definition) }}>{t('run')}</Button>
              <Button disabled={busy} onClick={() => { void commit(() => loadRuns(definition.id)) }}>{t('showRuns')}</Button>
              <Button disabled={!writable || busy || active.length > 0 || draft?.original?.id === definition.id} onClick={() => { setDeleteTarget({ id: definition.id, revision: definition.revision }) }}>{t('delete')}</Button>
            </div>
            {active.map(item => <div key={item.id} className={css.actions}>
              <span className={css.status}>{t(item.status)}</span>
              <Button disabled={!writable || busy || item.status === 'stopping'} onClick={() => { void commit(() => cancel(item.id)) }}>{t('cancelRun')}</Button>
              {item.sessionId !== null && <Button onClick={() => { openRecordedSession(item.sessionId) }}>{t('openSession')}</Button>}
            </div>)}
            {active.length > 0 && <p className={css.help}>{t('activeHelp')}</p>}
            {retry !== undefined && !busy && <div className={css.notice}>
              <p>{t('runUncertain')}</p><Button disabled={!writable} onClick={() => { invoke(definition, retry) }}>{t('retryRun')}</Button>
            </div>}
            {deleteTarget !== undefined && deleteTarget.id === definition.id && <div className={css.notice}>
              <p>{t('deleteHelp')}</p><div className={css.actions}>
                <Button disabled={!writable || busy || active.length > 0} onClick={() => {
                  void commit(() => deleteTask({ id: deleteTarget.id, expectedRevision: deleteTarget.revision }),
                    () => { setDeleteTarget(undefined) })
                }}>{t('deleteConfirm')}</Button>
                <Button disabled={busy} onClick={() => { setDeleteTarget(undefined) }}>{t('keep')}</Button>
              </div>
            </div>}
          </div>
        </li>
      })}</ul>
    </section>

    <section className={css.group} data-settings-anchor="draft" tabIndex={-1}>
      <h2>{t('draft')}</h2><p className={css.help}>{t('draftHelp')}</p>
      {draft !== undefined && catalog !== null && <DraftForm t={t} fields={draft.fields} catalog={catalog}
        disabled={!writable || busy} pending={busy} onChange={(fields) => { setDraft({ ...draft, fields }) }} onSave={save}
        onDiscard={() => { if (!pending.current) { setDraft(undefined); setFeedback(undefined) } }} />}
    </section>

    <section className={css.group} data-settings-anchor="journal" tabIndex={-1}>
      <h2>{t('journal')}</h2><p className={css.help}>{t('journalHelp')}</p><p className={css.help}>{t('utc')}</p>
      {history === null && <p className={css.notice}>{t('showRuns')}</p>}
      {history?.loading && <p role="status" className={css.notice}>{t('journalLoading')}</p>}
      {history?.error && <p role="alert" className={css.error}>{t('journalFailed')}</p>}
      {history !== null && !history.loading && history.error === null && history.runs.length === 0 && <p className={css.notice}>{t('emptyJournal')}</p>}
      <ul className={css.list}>{history?.runs.map(item => <li key={item.id} className={css.row}>
        <div className={css.copy}>
          <h3>{item.spec.title}</h3>
          <p className={css.help}>{t(item.status)} · {t(item.trigger)} · <time dateTime={utcTime(item.plannedAt)}>
            {utcTime(item.plannedAt)}</time></p>
          {item.reason !== null && <p className={css.help}>{item.reason}</p>}
          {item.status === 'completed' && <p className={css.help}>{t('completedHelp')}</p>}
          {(item.status === 'ambiguous' || item.status === 'interrupted') && <p className={css.warning}>{t('review')}</p>}
          <div className={css.actions}>
            {item.sessionId === null ? <span className={css.status}>{t('noSession')}</span>
              : <Button onClick={() => { openRecordedSession(item.sessionId) }}>{t('openSession')}</Button>}
            {activeById.has(item.id) && <Button disabled={!writable || busy || activeById.get(item.id)?.status === 'stopping'}
              onClick={() => { void commit(() => cancel(item.id)) }}>{t('cancelRun')}</Button>}
          </div>
        </div>
      </li>)}</ul>
      {history?.nextCursor != null && <div className={css.actions}><Button disabled={busy || history.loading} onClick={() => { void commit(loadMoreRuns) }}>{t('more')}</Button></div>}
    </section>
  </section>
}
