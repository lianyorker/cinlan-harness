/** Cinlan account presentation over injected observable state and commands. */
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  Button,
  IconRefreshOutline16,
  IconSendOutline16,
  IconTrashOutline16,
  IconUserOutline16,
  IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountAuthorizationPromptView } from '@deepseek-ai/dsh-api-account-controller/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import type { AccountUiError } from './source.ts'
import type { AccountSettingsProps } from './types.ts'
import type { AccountKey } from './locales.ts'
import css from './AccountSettingsSection.module.css'

const CINLAN_ACCOUNT_KEY = 'llm-pi-ai/sub2api' as CredentialKey

function errorKey(error: AccountUiError): AccountKey {
  return ('error.' + error) as AccountKey
}

function noticeHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.username.length === 0 && url.password.length === 0 ? value : undefined
  } catch {
    return undefined
  }
}

function PromptForm(props: {
  readonly prompt: AccountAuthorizationPromptView
  readonly pending: boolean
  readonly t: AccountSettingsProps['t']
  readonly answer: AccountSettingsProps['answer']
}): ReactNode {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (props.pending || (props.prompt.kind === 'select' && value.length === 0)) return
    const answer = value
    setValue('')
    void props.answer(props.prompt.id, answer)
  }
  return <form className={css.prompt} onSubmit={submit}>
    <label htmlFor={'account-prompt-' + props.prompt.id}>{props.prompt.message}</label>
    {props.prompt.kind === 'select'
      ? <select id={'account-prompt-' + props.prompt.id} className={css.input} value={value}
        disabled={props.pending} onChange={(event) => { setValue(event.currentTarget.value) }}>
        <option value="">{props.t('choose')}</option>
        {props.prompt.options.map(option => <option key={option.id} value={option.id}>
          {option.label}{option.description === undefined ? '' : props.t('optionSeparator') + option.description}
        </option>)}
      </select>
      : <input id={'account-prompt-' + props.prompt.id} className={css.input}
        type={props.prompt.autocomplete === 'username'
          ? 'email'
          : props.prompt.kind === 'secret' ? 'password' : 'text'}
        autoComplete={props.prompt.autocomplete ?? (props.prompt.kind === 'secret' ? 'current-password' : 'off')}
        inputMode={props.prompt.autocomplete === 'one-time-code' ? 'numeric' : undefined}
        value={value} disabled={props.pending} placeholder={props.prompt.placeholder}
        onChange={(event) => { setValue(event.currentTarget.value) }} />}
    <Button variant="primary" type="submit" icon={<IconSendOutline16 />}
      disabled={props.pending || (props.prompt.kind === 'select' && value.length === 0)}>
      {props.t('submit')}
    </Button>
  </form>
}

/**
 * Render the single Cinlan account card, caller-owned prompts, and explicit local sign-out.
 * @param props - framework hooks, localized copy, and apply-owned commands.
 * @returns the feature-owned Account Settings section.
 */
export function AccountSettingsSection(props: AccountSettingsProps): ReactNode {
  const { t } = props
  const state = props.useAccount(value => value)
  const [confirmKey, setConfirmKey] = useState<CredentialKey | null>(null)
  const flows = state.snapshot?.flows ?? []
  const cinlanFlow = state.status === 'ready'
    ? flows.find(flow => flow.key === CINLAN_ACCOUNT_KEY)
    : undefined
  const method = cinlanFlow?.methods[0]
  const attempt = state.attempt
  const attemptFlow = attempt === null ? undefined : flows.find(flow => flow.key === attempt.key)
  const active = attempt?.phase === 'starting' || attempt?.phase === 'running'
  const cinlanAttemptRetained = attempt?.key === CINLAN_ACCOUNT_KEY
  const requestDelete = (key: CredentialKey): void => { props.clearFeedback(); setConfirmKey(key) }
  const confirmDelete = (key: CredentialKey): void => {
    setConfirmKey(null)
    void props.deleteCredential(key)
  }
  const startLogin = (): void => {
    if (cinlanFlow === undefined || method === undefined) return
    props.start(cinlanFlow.key, method.id)
  }
  return <section className={css.section}>
    <header className={css.header}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>
    </header>

    {state.status !== 'ready' && <div className={css.readState} role={state.status === 'error' ? 'alert' : 'status'}>
      <span>{t(state.status === 'loading' ? 'loading' : state.status === 'offline' ? 'offline' : 'unavailable')}</span>
      {state.status === 'error' && <Button variant="outline" size="sm" icon={<IconRefreshOutline16 />}
        onClick={props.retry}>{t('retry')}</Button>}
    </div>}

    <div className={css.group} data-settings-anchor="account-login" tabIndex={-1}>
      {state.status === 'ready' && cinlanFlow === undefined && <p className={css.muted}>{t('empty')}</p>}
      {cinlanFlow !== undefined && <article className={css.accountCard}>
        <div className={css.accountRow}>
          <div className={css.identity}>
            <span className={css.identityIcon} aria-hidden="true"><IconUserOutline16 /></span>
            <div className={css.identityCopy}>
              <div className={css.labelLine}>
                <h3>{t('cinlanAccount')}</h3>
                <span className={cinlanFlow.inFlight
                  ? css.inProgress
                  : cinlanFlow.credential.configured ? css.configured : css.unconfigured}>
                  {t(cinlanFlow.inFlight ? 'inProgress' : cinlanFlow.credential.configured ? 'configured' : 'notConfigured')}
                </span>
              </div>
              <p>{t(cinlanFlow.credential.configured ? 'connected' : 'notConnected')}</p>
            </div>
          </div>
          <div className={css.actions}>
            {method !== undefined && <Button variant={cinlanFlow.credential.configured ? 'outline' : 'primary'} size="sm"
              icon={<IconUserOutline16 />}
              disabled={cinlanFlow.inFlight || cinlanAttemptRetained || state.pendingDeletion === cinlanFlow.key}
              onClick={startLogin}>
              {t(cinlanFlow.credential.configured ? 'signInAgain' : 'signIn')}
            </Button>}
            {cinlanFlow.credential.configured && <Button variant="ghost" size="sm" icon={<IconTrashOutline16 />}
              disabled={!cinlanFlow.credential.writable || cinlanFlow.inFlight
                || cinlanAttemptRetained || state.pendingDeletion === cinlanFlow.key}
              onClick={() => { requestDelete(cinlanFlow.key) }}>
              {state.pendingDeletion === cinlanFlow.key ? t('deleting') : t('signOut')}
            </Button>}
          </div>
        </div>
        {confirmKey === cinlanFlow.key && <div className={css.confirm} role="group"
          aria-labelledby={'account-remove-' + cinlanFlow.key}>
          <IconWarningOutline16 />
          <div>
            <h5 id={'account-remove-' + cinlanFlow.key}>{t('confirmTitle')}</h5>
            <p>{t('confirmDescription', { provider: t('cinlanAccount') })}</p>
            <div className={css.actions}>
              <Button variant="outline" size="sm" onClick={() => { setConfirmKey(null) }}>{t('keep')}</Button>
              <Button variant="primary" size="sm" icon={<IconTrashOutline16 />}
                onClick={() => { confirmDelete(cinlanFlow.key) }}>{t('remove')}</Button>
            </div>
          </div>
        </div>}
      </article>}
    </div>

    {state.deletedLocally !== null && <div className={css.feedback} role="status">
      <span>{t('deletedLocal')}</span>
      <Button variant="ghost" size="sm" onClick={props.clearFeedback}>{t('dismiss')}</Button>
    </div>}
    {state.actionError !== null && <div className={css.feedbackError} role="alert">
      <span>{t(errorKey(state.actionError))}</span>
      <Button variant="ghost" size="sm" onClick={props.clearFeedback}>{t('dismiss')}</Button>
    </div>}

    {attempt !== null && <div className={css.group} data-settings-anchor="account-authorization" tabIndex={-1}>
      <div className={css.attemptHeader}>
        <div><h3>{t('authorization')}</h3><p>{attemptFlow?.label ?? t('cinlanAccount')}</p></div>
        <span role="status">{t(attempt.phase)}</span>
      </div>
      {attempt.notices.length > 0 && <ul className={css.notices}>{attempt.notices.map((notice, index) => {
        const href = noticeHref(notice.url)
        return <li key={index}>
          <span>{notice.message}</span>
          {href !== undefined && <a href={href} target="_blank" rel="noreferrer">{t('openPage')}</a>}
          {notice.code !== undefined && <span>{t('code')}: <code>{notice.code}</code></span>}
        </li>
      })}</ul>}
      {attempt.prompt !== null && <PromptForm key={attempt.prompt.id} prompt={attempt.prompt}
        pending={attempt.pendingAnswer} t={t} answer={props.answer} />}
      {attempt.phase === 'failed' && attempt.failure !== null && <p className={css.error} role="alert">
        {t(errorKey(attempt.failure))}
      </p>}
      <div className={css.actions}>
        {active && <Button variant="outline" onClick={() => { void props.cancel() }}>{t('cancel')}</Button>}
        {!active && <Button variant="outline" onClick={props.dismissAttempt}>{t('dismiss')}</Button>}
      </div>
    </div>}
  </section>
}
