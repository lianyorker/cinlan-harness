/** SSH host management: one target list with inline row actions. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconDownloadOutline16, IconEditOutline16, IconInspectOutlineRegular, IconPlayOutline16,
  IconPlusOutline16, IconRefreshOutline16, IconStopFill16, IconTrashOutline16, Modal, StateDot, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ImportableHostsValue, TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostDiagnostic, HostsProps, HostsTranslate, ImportCandidate, TargetDraft, TargetRevision } from './types.ts'
import type { HostsKey } from './locales.ts'
import {
  draftFromImport, draftFromTarget, draftProblem, effectiveConnection, emptyDraft, targetRequest,
} from './target-draft.ts'
import { diagnosticLabel, hostDiagnostic } from './diagnostics.ts'
import { HostErrorNotice } from './HostDetails.tsx'
import { ImportDialog, type ImportState } from './ImportDialog.tsx'
import { TargetForm } from './TargetForm.tsx'
import css from './HostsSection.module.css'

type Editor = { draft: TargetDraft; target: TargetRevision | undefined; missing?: boolean }
type Notice = { key: HostsKey; params?: Record<string, string | number> }
/** One status dot per non-persistent observation phase. */
const DOT = { disconnected: 'idle', connecting: 'ongoing', ready: 'done', error: 'error' } as const
const STATUS_KEY: Record<TargetView['state']['phase'], HostsKey> = {
  disconnected: 'disconnected', connecting: 'connecting', ready: 'ready', error: 'error',
}

/** Decorative machine mark leading each target row. */
function TargetGlyph(): ReactNode {
  return <svg className={css.cardGlyph} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.2">
    <rect x="2" y="2.5" width="12" height="4.5" rx="1.2" />
    <rect x="2" y="9" width="12" height="4.5" rx="1.2" />
    <circle cx="4.6" cy="4.75" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="4.6" cy="11.25" r="0.7" fill="currentColor" stroke="none" />
  </svg>
}

/**
 * Read the row's second line: destination, identity file and saved connection deadline.
 * @param target - saved target as observed.
 * @param t - current settings translator.
 * @returns the effect line under the target label.
 */
function connectionLine(target: TargetView, t: HostsTranslate): string {
  const connection = effectiveConnection(target)
  const host = target.sshAlias
  const account = connection?.username
  const port = connection?.port
  let endpoint: string
  if (account !== undefined && account !== '' && port !== undefined) endpoint = t('endpointSummary', { username: account, host, port })
  else if (account !== undefined && account !== '') endpoint = t('endpointSummaryUser', { username: account, host })
  else if (port !== undefined) endpoint = t('endpointSummaryNoUser', { host, port })
  else endpoint = t('endpointSummaryAlias', { host })
  const identity = connection?.privateKeyFile
  const timeout = connection?.connectTimeoutSeconds
  return endpoint
    + (identity === undefined || identity === '' ? '' : ' • ' + identity)
    + (timeout === undefined ? '' : ' • ' + t('connectTimeout', { value: timeout }))
}

/**
 * Render the saved SSH targets with their connection actions.
 * @param props - renderer-bound observation, plain callbacks and localized copy.
 * @returns the SSH host settings page.
 */
export function HostsSection(props: HostsProps): ReactNode {
  const { useHosts, t } = props
  const snapshot = useHosts(value => value)
  const [editor, setEditor] = useState<Editor>()
  const [importState, setImportState] = useState<ImportState>()
  const [deleting, setDeleting] = useState<TargetView>()
  const [pending, setPending] = useState<string>()
  const [failure, setFailure] = useState<HostDiagnostic>()
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])
  const available = snapshot.status === 'ready'
  const targets = snapshot.value?.targets ?? []
  const perform = async (
    key: string, action: (signal: AbortSignal) => Promise<unknown>,
    options: { onSuccess?: (value: unknown) => void; notice?: Notice } = {},
  ): Promise<void> => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    const isCurrent = (): boolean => operation.current === controller && !controller.signal.aborted
    setPending(key)
    setFailure(undefined)
    setRefreshFailed(false)
    setNotice(undefined)
    try {
      const value = await action(controller.signal)
      if (isCurrent()) {
        options.onSuccess?.(value)
        if (options.notice !== undefined) setNotice(options.notice)
      }
    } catch (error) {
      if (!isCurrent()) return
      const diagnostic = hostDiagnostic(error)
      setFailure(diagnostic)
      if (diagnostic.code === 'execution-host/conflict') {
        try {
          const current = await props.refresh(controller.signal)
          if (!isCurrent()) return
          // Keep every typed value: only the revision fence is refreshed.
          setEditor((draft) => {
            if (draft?.target === undefined) return draft
            const target = current.targets.find(value => value.id === draft.target?.id)
            return target === undefined ? { ...draft, missing: true }
              : { ...draft, target: { id: target.id, revision: target.revision } }
          })
          setDeleting(previous => previous === undefined ? undefined : current.targets.find(target => target.id === previous.id))
        } catch (_refreshFailure) {
          if (isCurrent()) setRefreshFailed(true)
        }
      }
    } finally {
      if (isCurrent()) setPending(undefined)
    }
  }
  const edit = (target?: TargetView): void => {
    setFailure(undefined)
    setNotice(undefined)
    setEditor({ draft: target === undefined ? emptyDraft() : draftFromTarget(target),
      target: target === undefined ? undefined : { id: target.id, revision: target.revision } })
  }
  const openImport = (): void => {
    setFailure(undefined)
    setNotice(undefined)
    setImportState({ status: 'loading' })
    void perform('import', signal => props.listImportableHosts(signal), {
      onSuccess: value => { setImportState({ status: 'ready', value: value as ImportableHostsValue }) },
    })
  }
  const acceptImport = (entry: ImportCandidate): void => {
    setImportState(undefined)
    setEditor({ draft: draftFromImport(entry), target: undefined })
  }
  return <section className={css.section}>
    <h1 className={css.title}>{t('title')}</h1>
    <p className={css.lead}>{t('description')}</p>
    <div className={css.panel} data-settings-anchor="hosts" tabIndex={-1}>
      <div className={css.groupHeading}>
        <div><h3>{t('hosts')}</h3><p className={css.note}>{t('hostsDescription')}</p></div>
        <div className={css.actions}>
          <Button variant="outline" size="sm" icon={<IconDownloadOutline16 />} disabled={pending !== undefined}
            onClick={openImport}>{t('import')}</Button>
          <Button variant="outline" size="sm" icon={<IconPlusOutline16 />} disabled={!available || pending !== undefined}
            onClick={() => { edit() }}>{t('add')}</Button>
        </div>
      </div>
      <p className={css.note} data-settings-anchor="ssh-alias" tabIndex={-1}>{t('connectionDescription')}</p>
      {snapshot.status === 'loading' && <p role="status">{t('loadingStatus')}</p>}
      {snapshot.error !== undefined && <HostErrorNotice error={snapshot.error} t={t} />}
      {failure !== undefined && deleting === undefined && editor === undefined && <HostErrorNotice error={failure} t={t} />}
      {refreshFailed && <p role="alert" className={css.error}>{t('refreshFailed')}</p>}
      {notice !== undefined && <p role="status">{t(notice.key, notice.params)}</p>}
      <div className={css.targets} aria-label={t('savedTargets')}>
        {available && targets.length === 0 && <p className={css.empty}>{t('empty')}</p>}
        {targets.map(target => {
          const state = target.state
          const busy = pending !== undefined
          return <div key={target.id} className={css.card} aria-label={target.label}>
            <TargetGlyph />
            <div className={css.cardBody}>
              <div className={css.cardTitleRow}>
                <span className={css.cardLabel}>{target.label}</span>
                <StateDot state={DOT[state.phase]} size={8} />
                <span className={css.cardStatus} role="status">{t(available ? STATUS_KEY[state.phase] : 'unavailable')}</span>
              </div>
              <p className={css.cardLine}>{connectionLine(target, t)}</p>
              {available && state.phase === 'error' && <p className={css.cardError} role="alert">
                {diagnosticLabel(state, t)}{state.message === '' ? '' : ' · ' + state.message}
              </p>}
            </div>
            <div className={css.cardActions}>
              {state.phase === 'ready' && <Tooltip label={t('resetRelay')} side="top" portal>
                <Button variant="ghost" size="sm" icon={<IconRefreshOutline16 />}
                  aria-label={t(pending === 'reset:' + target.id ? 'resettingRelay' : 'resetRelay')}
                  disabled={!available || busy}
                  onClick={() => { void perform('reset:' + target.id, signal => props.connect({ id: target.id, revision: target.revision }, signal), { notice: { key: 'resetDone' } }) }} />
              </Tooltip>}
              <Button variant="ghost" size="sm" icon={<IconEditOutline16 />} aria-label={t('edit')}
                disabled={!available || busy} onClick={() => { edit(target) }} />
              <Button variant="ghost" size="sm" icon={<IconTrashOutline16 />} aria-label={t('remove')}
                disabled={!available || busy} onClick={() => { setDeleting(target); setFailure(undefined) }} />
              {state.phase === 'ready' || state.phase === 'connecting'
                ? <Button variant="ghost" size="sm" icon={<IconStopFill16 />}
                  disabled={!available || (busy && pending !== 'connect:' + target.id)}
                  onClick={() => { void perform('disconnect', signal => props.disconnect({ id: target.id }, signal), { notice: { key: 'disconnectedDone' } }) }}>{t('disconnect')}</Button>
                : <>
                  <Button variant="ghost" size="sm" icon={<IconInspectOutlineRegular size={14} />}
                    disabled={!available || busy}
                    onClick={() => { void perform('test:' + target.id, signal => props.test({ id: target.id, revision: target.revision }, signal), {
                      onSuccess: value => { setNotice({ key: 'testSucceeded', params: { count: (value as { rootCount: number }).rootCount } }) },
                    }) }}>{t(pending === 'test:' + target.id ? 'testing' : 'test')}</Button>
                  <Button variant="ghost" size="sm" icon={<IconPlayOutline16 />} disabled={!available || busy}
                    onClick={() => { void perform('connect:' + target.id, signal => props.connect({ id: target.id, revision: target.revision }, signal), { notice: { key: 'connected' } }) }}>{t('connect')}</Button>
                </>}
            </div>
          </div>
        })}
      </div>
    </div>
    {editor !== undefined && <TargetForm
      draft={editor.draft}
      target={editor.target}
      pending={pending !== undefined}
      disabled={!available}
      missing={editor.missing === true}
      problem={draftProblem(editor.draft)}
      failure={failure}
      t={t}
      onChange={(draft) => { setEditor(current => current === undefined ? current : { ...current, draft }) }}
      onSubmit={() => {
        const request = targetRequest(editor.draft)
        void perform('save', signal => editor.target === undefined
          ? props.create(request, signal)
          : props.update({ ...request, ...editor.target }, signal), {
          onSuccess: () => { setEditor(undefined) },
          notice: { key: 'saved' },
        })
      }}
      onCancel={() => { setEditor(undefined); setFailure(undefined) }}
    />}
    {importState !== undefined && <ImportDialog state={importState} t={t} onPick={acceptImport} onClose={() => { setImportState(undefined) }} />}
    <Modal open={deleting !== undefined} onClose={() => { if (pending === undefined) setDeleting(undefined) }}
      title={t('deleteTitle')} description={t('deleteDescription')} closeLabel={t('close')}
      footer={<div className={css.dialogFooter}>
        <Button variant="outline" disabled={pending !== undefined} onClick={() => { setDeleting(undefined) }}>{t('formCancel')}</Button>
        <Button variant="primary" disabled={!available || pending !== undefined} onClick={() => {
          if (deleting !== undefined) void perform('delete', signal => props.removeTarget({ id: deleting.id, revision: deleting.revision }, signal), {
            onSuccess: () => { setDeleting(undefined) }, notice: { key: 'deleted' },
          })
        }}>{t('deleteConfirm')}</Button>
      </div>}>
      <p>{deleting?.label}</p>
      {failure !== undefined && <HostErrorNotice error={failure} t={t} />}
    </Modal>
  </section>
}
