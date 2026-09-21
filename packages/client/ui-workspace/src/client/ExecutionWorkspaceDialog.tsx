/** Operator-selected execution location and exact revision for new Workspaces. */
import { useState } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TargetView } from '@deepseek-ai/dsh-api-execution-host-controller/types'
import type { WorkspacePickFlowProps } from './WorkspacePicker.tsx'
import type { ExecutionTargetsSnapshot } from './execution-targets.ts'
import css from './WorkspacePicker.module.css'

type Props = Pick<WorkspacePickFlowProps, 'open' | 't' | 'createWorkspace' | 'onPick' | 'onClose'> & {
  snapshot: ExecutionTargetsSnapshot
  localAvailable: boolean
  onLocal: () => void
}

/**
 * Capture target selection without upgrading its revision while the form is open.
 * @param props - current observation, directory callback and Host create operation.
 * @returns a location chooser whose remote failures never open a local directory.
 */
export function ExecutionWorkspaceDialog({ open, snapshot, localAvailable, t, createWorkspace, onPick, onClose, onLocal }: Props) {
  const [selected, setSelected] = useState<TargetView>()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const current = selected === undefined || (snapshot.available && snapshot.targets.some(target =>
    target.id === selected.id && target.revision === selected.revision))
  const valid = selected === undefined ? localAvailable : current && path.startsWith('/')
  const close = (): void => { if (!busy) { setSelected(undefined); setPath(''); setError(undefined); onClose() } }
  const submit = async (): Promise<void> => {
    if (!valid || busy) return
    if (selected === undefined) { onLocal(); return }
    setBusy(true)
    setError(undefined)
    try {
      const workspace = await createWorkspace({ path, targetRevision: { id: selected.id, revision: selected.revision } })
      onPick(workspace.workspaceId)
      onClose()
      setSelected(undefined)
      setPath('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally { setBusy(false) }
  }
  const key = (target: TargetView): string => target.id + ':' + String(target.revision)
  return <Modal open={open} onClose={close} closeLabel={t('close')} title={t('execution.title')}
    footer={<><Button variant="outline" disabled={busy} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" disabled={!valid || busy} onClick={() => { void submit() }}>{t(busy ? 'execution.creating' : 'execution.continue')}</Button></>}>
    <div className={css.executionForm}>
      <label htmlFor="workspace-execution-target">{t('execution.host')}</label>
      <select id="workspace-execution-target" disabled={busy} value={selected === undefined ? '' : key(selected)} onChange={(event) => {
        const target = snapshot.targets.find(value => key(value) === event.currentTarget.value)
        setSelected(target); setPath(target?.execution?.workspace ?? ''); setError(undefined)
      }}>
        <option value="" disabled={!localAvailable}>{t('execution.local')}</option>
        {selected !== undefined && !current && <option value={key(selected)} disabled>{selected.label}</option>}
        {snapshot.targets.map(target => <option key={key(target)} value={key(target)}>{t('execution.choice', { label: target.label, revision: target.revision })}</option>)}
      </select>
      {selected !== undefined && <>
        <p>{selected.execution?.endpoint.username}@{selected.execution?.endpoint.host}:{selected.execution?.endpoint.port}</p>
        <label htmlFor="workspace-execution-path">{t('execution.path')}</label>
        <Input id="workspace-execution-path" value={path} disabled={busy} onChange={(event) => { setPath(event.currentTarget.value) }} />
        <p>{t('execution.fixed')}</p>
        {!current && <p role="alert" className={css.modalError}>{t('execution.changed')}</p>}
      </>}
      {error !== undefined && <p role="alert" className={css.modalError}>{error}</p>}
    </div>
  </Modal>
}
