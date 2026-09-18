/** Native host management; drafts and operation status are private to this mounted page. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { HostDiagnostic, HostDraft, HostsProps, TargetRevision } from './types.ts'
import type { HostsKey } from './locales.ts'
import { hostDiagnostic } from './diagnostics.ts'
import { HostErrorNotice, ProcessDetails } from './HostDetails.tsx'
import { DirectoryInspector } from './DirectoryInspector.tsx'
import css from './HostsSection.module.css'

type Editor = HostDraft & { target: TargetRevision | undefined; missing?: boolean }
const UNAVAILABLE_ROWS = [
  ['default', 'defaultHost', 'defaultDescription'],
  ['confirmSwitch', 'confirmSwitch', 'confirmDescription'],
  ['isolation', 'taskIsolation', 'isolationDescription'],
] as const

/**
 * Render saved target operations separately from current local process provenance.
 * @param props - renderer-bound observation, plain callbacks and localized copy.
 * @returns native settings rows and revision-fenced management forms.
 */
export function HostsSection(props: HostsProps): ReactNode {
  const { useHosts, t } = props
  const snapshot = useHosts(value => value)
  const [editor, setEditor] = useState<Editor>()
  const [deleting, setDeleting] = useState<TargetView>()
  const [pending, setPending] = useState<string>()
  const [failure, setFailure] = useState<HostDiagnostic>()
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [notice, setNotice] = useState<HostsKey>()
  const operation = useRef<AbortController>()
  useEffect(() => () => { operation.current?.abort() }, [])
  const available = snapshot.status === 'ready'
  const targets = snapshot.value?.targets ?? []
  const perform = async (
    key: string, action: (signal: AbortSignal) => Promise<unknown>, success?: () => void, message?: HostsKey,
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
      await action(controller.signal)
      if (isCurrent()) {
        success?.()
        setNotice(message)
      }
    } catch (error) {
      if (!isCurrent()) return
      const diagnostic = hostDiagnostic(error)
      setFailure(diagnostic)
      if (diagnostic.code === 'execution-host/conflict') {
        try {
          const current = await props.refresh(controller.signal)
          if (!isCurrent()) return
          setEditor((draft) => {
            if (draft?.target === undefined) return draft
            const target = current.targets.find(value => value.id === draft.target?.id)
            return target === undefined ? { ...draft, missing: true } : { ...draft, target: { id: target.id, revision: target.revision } }
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
    setEditor({ label: target?.label ?? '', sshAlias: target?.sshAlias ?? '', target: target === undefined ? undefined : { id: target.id, revision: target.revision } })
  }
  return <section className={css.section}>
    <header className={css.heading}><span className={css.scope}>{t('scope')}</span><h2>{t('title')}</h2><p>{t('description')}</p></header>
    <div className={css.group} data-settings-anchor="current" tabIndex={-1}>
      <h3>{t('current')}</h3><p className={css.note}>{t('currentDescription')}</p>
      {snapshot.value?.current === undefined ? <p className={css.note}>{t(snapshot.status === 'loading' ? 'loading' : 'currentUnavailable')}</p>
        : <ProcessDetails info={snapshot.value.current} t={t} />}
    </div>
    <div className={css.group} data-settings-anchor="hosts" tabIndex={-1}>
      <div className={css.groupHeading}><div><h3>{t('hosts')}</h3><p className={css.note}>{t('hostsDescription')}</p></div>
        <div className={css.actions}>
          <Button variant="outline" disabled={pending !== undefined} onClick={() => { void perform('refresh', props.refresh) }}>{t('refresh')}</Button>
          <Button variant="primary" disabled={!available || pending !== undefined} onClick={() => { edit() }}>{t('add')}</Button>
        </div>
      </div>
      <p className={css.note} data-settings-anchor="ssh-alias" tabIndex={-1}>{t('sshDescription')}</p>
      {snapshot.status === 'loading' && <p role="status">{t('loadingStatus')}</p>}
      {snapshot.error !== undefined && <HostErrorNotice error={snapshot.error} t={t} />}
      {failure !== undefined && deleting === undefined && <HostErrorNotice error={failure} t={t} />}
      {refreshFailed && <p role="alert" className={css.error}>{t('refreshFailed')}</p>}
      {notice !== undefined && <p role="status">{t(notice)}</p>}
      {editor !== undefined && <form className={css.editor} onSubmit={(event) => {
        event.preventDefault()
        const request = { label: editor.label, sshAlias: editor.sshAlias }
        void perform('save', signal => editor.target === undefined ? props.create(request, signal) : props.update({ ...request, ...editor.target }, signal), () => { setEditor(undefined) }, 'saved')
      }}>
        <h4>{t(editor.target === undefined ? 'createTitle' : 'editTitle')}</h4>
        <fieldset disabled={!available || pending !== undefined || editor.missing}>
          <label htmlFor="execution-host-label">{t('label')}</label>
          <Input id="execution-host-label" value={editor.label} required placeholder={t('labelPlaceholder')}
            onChange={(event) => { setEditor({ ...editor, label: event.currentTarget.value }) }} />
          <label htmlFor="execution-host-alias">{t('sshAlias')}</label>
          <Input id="execution-host-alias" value={editor.sshAlias} required placeholder={t('aliasPlaceholder')}
            onChange={(event) => { setEditor({ ...editor, sshAlias: event.currentTarget.value }) }} />
        </fieldset>
        {editor.missing && <p role="alert">{t('errorNotFound')}</p>}
        <div className={css.actions}>
          <Button variant="primary" type="submit" disabled={!available || pending !== undefined || editor.missing || editor.label.trim() === '' || editor.sshAlias.trim() === ''}>{t(pending === 'save' ? 'saving' : 'save')}</Button>
          <Button variant="outline" disabled={pending !== undefined} onClick={() => { setEditor(undefined); setFailure(undefined) }}>{t('cancel')}</Button>
        </div>
      </form>}
      <div aria-label={t('savedTargets')}>
        {available && targets.length === 0 && <p className={css.note}>{t('empty')}</p>}
        {targets.map(target => <article key={target.id} className={css.target} aria-label={target.label}>
          <div className={css.groupHeading}>
            <div><h4>{target.label}</h4><code>{target.sshAlias}</code></div>
            <span className={css.status} role="status">{t(available ? target.state.phase : 'unavailable')}</span>
          </div>
          <dl className={css.facts}>
            <dt>{t('savedTargetId')}</dt><dd><code>{target.id}</code></dd>
            <dt>{t('revision')}</dt><dd>{target.revision}</dd>
          </dl>
          {available && target.state.phase === 'error' && <HostErrorNotice error={target.state} t={t} />}
          <div className={css.actions}>
            {target.state.phase === 'ready' || target.state.phase === 'connecting'
              ? <Button variant="outline" disabled={!available || (pending !== undefined && pending !== 'connect:' + target.id)}
                onClick={() => { void perform('disconnect', signal => props.disconnect({ id: target.id }, signal), undefined, 'disconnectedDone') }}>{t('disconnect')}</Button>
              : <Button variant="outline" disabled={!available || pending !== undefined}
                onClick={() => { void perform('connect:' + target.id, signal => props.connect({ id: target.id, revision: target.revision }, signal)) }}>{t('connect')}</Button>}
            <Button disabled={!available || pending !== undefined} onClick={() => { edit(target) }}>{t('edit')}</Button>
            <Button disabled={!available || pending !== undefined} onClick={() => { setDeleting(target); setFailure(undefined) }}>{t('remove')}</Button>
          </div>
          {available && target.state.phase === 'ready' && <>
            <h4>{t('worker')}</h4>
            <ProcessDetails info={target.state.info.executionHost} t={t} />
            <dl className={css.facts}><dt>{t('generation')}</dt><dd>{target.state.generation}</dd><dt>{t('checkedAt')}</dt><dd>{target.state.checkedAt}</dd></dl>
            <DirectoryInspector key={`${target.id}:${target.state.generation}`} target={{ ...target, state: target.state }} inspectDirectory={props.inspectDirectory} t={t} />
          </>}
        </article>)}
      </div>
    </div>
    <p className={css.note} data-settings-anchor="inspection" tabIndex={-1}>{t('inspectionDescription')}</p>
    <div className={css.group}>
      <h3>{t('defaults')}</h3>
      {UNAVAILABLE_ROWS.map(([anchor, title, description]) =>
        <div key={anchor} className={css.row} data-settings-anchor={anchor} tabIndex={-1}>
          <div><h4>{t(title)}</h4><p className={css.note}>{t(description)}</p><p className={css.note}>{t('routingUnavailable')}</p></div>
          <span className={css.scope}>{t('unavailable')}</span>
        </div>)}
    </div>
    <Modal open={deleting !== undefined} onClose={() => { if (pending === undefined) setDeleting(undefined) }}
      title={t('deleteTitle')} description={t('deleteDescription')} closeLabel={t('close')}
      footer={<div className={css.actions}>
        <Button variant="outline" disabled={pending !== undefined} onClick={() => { setDeleting(undefined) }}>{t('cancel')}</Button>
        <Button variant="primary" disabled={!available || pending !== undefined} onClick={() => {
          if (deleting !== undefined) void perform('delete', signal => props.removeTarget({ id: deleting.id, revision: deleting.revision }, signal), () => { setDeleting(undefined) }, 'deleted')
        }}>{t('deleteConfirm')}</Button>
      </div>}>
      <p>{deleting?.label}</p>
      {failure !== undefined && <HostErrorNotice error={failure} t={t} />}
    </Modal>
  </section>
}
