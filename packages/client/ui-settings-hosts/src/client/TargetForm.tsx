/** Add/edit dialog shaped like the reference host form: two columns, Advanced disclosure, linked timeout. */
import { useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutline14, Input, Modal, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostDiagnostic, TargetRevision, HostsTranslate, TargetDraft } from './types.ts'
import type { HostsKey } from './locales.ts'
import { applyParsedDestination } from './target-draft.ts'
import { HostErrorNotice } from './HostDetails.tsx'
import css from './HostsSection.module.css'

/** Everything the dialog renders; the owner keeps the draft so a failed save preserves it. */
export interface TargetFormProps {
  readonly draft: TargetDraft
  /** Exact saved revision when editing; absent while adding. */
  readonly target: TargetRevision | undefined
  readonly pending: boolean
  readonly disabled: boolean
  /** The saved target disappeared underneath this draft; only cancellation remains. */
  readonly missing: boolean
  /** Localized validation message for the current draft, or undefined when it can be saved. */
  readonly problem: HostsKey | undefined
  /** Last rejected save, rendered inside the dialog that keeps the draft alive. */
  readonly failure: HostDiagnostic | undefined
  readonly t: HostsTranslate
  onChange: (next: TargetDraft) => void
  onSubmit: () => void
  onCancel: () => void
}

/**
 * Render the target editor inside the shared modal frame.
 * @param props - draft, operation state and localized copy owned by the page.
 * @returns the add/edit dialog.
 */
export function TargetForm(props: TargetFormProps): ReactNode {
  const { draft, target, pending, disabled, missing, t } = props
  const [advanced, setAdvanced] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const field = (key: keyof TargetDraft) => (event: { currentTarget: { value: string } }): void => {
    props.onChange({ ...draft, [key]: event.currentTarget.value })
  }
  const editing = target !== undefined
  const summary = draft.username.trim() === '' ? draft.destination.trim() : draft.username.trim() + '@' + draft.destination.trim()
  return <Modal
    open
    onClose={() => { if (!pending) props.onCancel() }}
    title={t(editing ? 'editTitle' : 'createTitle')}
    description={t(editing ? 'editDescription' : 'createDescription')}
    closeLabel={t('close')}
    className={css.targetDialog ?? ''}
    footer={<div className={css.dialogFooter}>
      <Button variant="outline" onClick={props.onCancel} disabled={pending}>{t('formCancel')}</Button>
      <Button variant="primary" data-modal-autofocus disabled={disabled || missing || pending}
        onClick={() => {
          if (props.problem !== undefined) { setSubmitted(true); return }
          props.onSubmit()
        }}>{t(pending ? 'formSaving' : editing ? 'formSave' : 'formCreate')}</Button>
    </div>}
  >
    <div className={css.form}>
      {editing && (draft.label.trim() !== '' || draft.destination.trim() !== '') && <p className={css.editingChip}>
        <span>{t('editingPrefix')}</span>
        {draft.label.trim() !== '' && <strong>{draft.label.trim()}</strong>}
        <span aria-hidden="true">·</span>
        <code>{summary}</code>
      </p>}
      <div className={css.formGrid}>
        <div className={css.formField}>
          <label htmlFor="execution-target-label">{t('formLabel')}</label>
          <Input id="execution-target-label" value={draft.label} placeholder={t('formLabelPlaceholder')}
            disabled={pending || missing} onChange={field('label')} />
        </div>
        <div className={css.formField}>
          <label htmlFor="execution-target-destination">{t('formDestination')}</label>
          <Input id="execution-target-destination" value={draft.destination} required
            placeholder={t('formDestinationPlaceholder')} disabled={pending || missing}
            onChange={field('destination')}
            onBlur={() => { props.onChange(applyParsedDestination(draft)) }} />
        </div>
        <div className={css.formField}>
          <label htmlFor="execution-target-username">{t('formUsername')}</label>
          <Input id="execution-target-username" value={draft.username} placeholder={t('formUsernamePlaceholder')}
            disabled={pending || missing} onChange={field('username')} />
        </div>
        <div className={css.formField}>
          <label htmlFor="execution-target-port">{t('formPort')}</label>
          <Input id="execution-target-port" type="number" min={1} max={65_535} value={draft.port}
            placeholder={t('formPortPlaceholder')} disabled={pending || missing} onChange={field('port')} />
        </div>
        <div className={css.formFieldWide}>
          <label htmlFor="execution-target-identity">{t('formIdentityFile')}</label>
          <Input id="execution-target-identity" value={draft.identityFile}
            placeholder={t('formIdentityFilePlaceholder')} disabled={pending || missing} onChange={field('identityFile')} />
          <p className={css.note}>{t('formIdentityFileHint')}</p>
        </div>
        <div className={css.formFieldWide}>
          <Button variant="ghost" className={css.disclosure} aria-expanded={advanced}
            aria-controls="execution-target-advanced" disabled={pending || missing}
            onClick={() => { setAdvanced(!advanced) }}>
            {t('formAdvanced')}
            <span className={advanced ? css.chevronOpen : css.chevron}><IconChevronDownOutline14 /></span>
          </Button>
        </div>
        {advanced && <div id="execution-target-advanced" className={css.advanced}>
          <div className={css.formField}>
            <label htmlFor="execution-target-proxy">{t('formProxyCommand')}</label>
            <Input id="execution-target-proxy" value={draft.proxyCommand} placeholder={t('formProxyCommandPlaceholder')}
              disabled={pending || missing} onChange={field('proxyCommand')} />
            <p className={css.note}>{t('formProxyCommandHint')}</p>
          </div>
          <div className={css.formField}>
            <label htmlFor="execution-target-jump">{t('formJumpHost')}</label>
            <Input id="execution-target-jump" value={draft.jumpHost} placeholder={t('formJumpHostPlaceholder')}
              disabled={pending || missing} onChange={field('jumpHost')} />
            <p className={css.note}>{t('formJumpHostHint')}</p>
          </div>
          <div className={css.formFieldWide}>
            <div className={css.switchRow}>
              <div className={css.switchCopy}>
                <label htmlFor="execution-target-reuse">{t('formConnectionReuse')}</label>
                <p className={css.note}>{t('formConnectionReuseHint')}</p>
              </div>
              <Switch checked={draft.connectionReuse} label={t('formConnectionReuse')} disabled={pending || missing}
                onChange={(next) => { props.onChange({ ...draft, connectionReuse: next }) }} />
            </div>
          </div>
          <div className={css.formField}>
            <label htmlFor="execution-target-connect-timeout">{t('formConnectTimeout')}</label>
            <Input id="execution-target-connect-timeout" type="number"
              value={draft.connectTimeoutSeconds} placeholder={t('formConnectTimeoutPlaceholder')}
              min={1} max={604_800}
              disabled={pending || missing} onChange={field('connectTimeoutSeconds')} />
            <p className={css.note}>{t('formConnectTimeoutHint')}</p>
          </div>
        </div>}
      </div>
      {submitted && props.problem !== undefined && <p role="alert" className={css.error}>{t(props.problem)}</p>}
      {props.failure !== undefined && <HostErrorNotice error={props.failure} t={t} />}
      {missing && <p role="alert" className={css.error}>{t('errorNotFound')}</p>}
    </div>
  </Modal>
}
