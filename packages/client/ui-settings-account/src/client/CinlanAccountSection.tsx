/** Cinlan (Sub2API) account settings page, following the Orca account layout. */
import { useEffect, useState, type FormEvent } from 'react'
import {
  Button, IconGlobeOutlineRegular, IconLoadingOutlineRegular, IconShareOutlineRegular, Input, Modal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, HostObservable, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Sub2ApiAccountState } from '@deepseek-ai/dsh-api-account-controller/types'
import type { CinlanAccountKey } from './cinlan-locales.ts'
import { AccountAvatar } from './AccountAvatar.tsx'
import css from './CinlanAccountSection.module.css'

/** Snapshot the registration publishes for this page. */
export interface CinlanAccountSnapshot {
  /** Latest safe Sub2API account state, absent until the first read settles. */
  state: Sub2ApiAccountState | undefined
  /** Whether the latest state read failed. */
  failed: boolean
}

/** Host operations injected into the Cordis-free Cinlan account component. */
export interface CinlanAccountInjected {
  /** Live Sub2API account state observed through a framework hook. */
  hooks: { state: HostObservable<CinlanAccountSnapshot> }
  /** @returns after the state re-read settles. */
  refresh: () => Promise<void>
  /**
   * @param request - email, password, and the 2FA code when the caller already has one.
   * @returns `totp-required` when the account demands a verification code.
   */
  signIn: (request: { email: string; password: string; totpCode?: string }) => Promise<'authorized' | 'totp-required'>
  /** Withdraw the running sign-in attempt, if any. */
  cancelSignIn: () => void
  /** @returns after the local API-key record is removed. */
  signOut: () => Promise<void>
}

/** Composed Cinlan account section props. */
export type CinlanAccountSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.cinlanAccount'> & InjectFace<CinlanAccountInjected>

/** @param props - localized copy, state subscription, and account actions. @returns Cinlan account settings UI. */
export function CinlanAccountSection({ t, useState: useCinlan, refresh, signIn, cancelSignIn, signOut }: CinlanAccountSectionProps) {
  const { state, failed } = useCinlan(value => value)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionFailed, setActionFailed] = useState(false)
  useEffect(() => { void refresh().catch(() => { /* the snapshot carries the failure */ }) }, [refresh])
  const signedIn = state?.signedIn === true
  const status = failed || actionFailed ? t('failed')
    : state === undefined ? t('loading')
      : signedIn ? t('signedInDescription') : t('signedOutDescription')
  const runSignOut = async (): Promise<void> => {
    setBusy(true)
    setActionFailed(false)
    try {
      await signOut()
      await refresh()
    } catch { setActionFailed(true) } finally { setBusy(false) }
  }
  return (
    <section className={css.section} aria-label={t('nav')}>
      <div className={css.card}>
        <div className={css.identity}>
          <span className={css.avatar}><AccountAvatar url={null} /></span>
          <div className={css.identityCopy}>
            <span className={css.name}>{signedIn ? t('signedInTitle') : t('signedOutTitle')}</span>
            <span className={css.status} role="status">{status}</span>
          </div>
        </div>
        {signedIn
          ? <Button variant="outline" disabled={busy} onClick={() => { void runSignOut() }}>{t('signOut')}</Button>
          : <Button variant="primary" onClick={() => { setActionFailed(false); setDialogOpen(true) }}>{t('signIn')}</Button>}
      </div>
      <span className={css.includedTitle}>{t('includedTitle')}</span>
      <div className={css.features}>
        <div className={css.feature}>
          <IconShareOutlineRegular className={css.featureIcon} size={16} />
          <div className={css.featureCopy}>
            <span className={css.featureTitle}>{t('artifactTitle')}</span>
            <span className={css.featureDescription}>{t('artifactDescription')}</span>
          </div>
        </div>
        <div className={css.feature}>
          <IconGlobeOutlineRegular className={css.featureIcon} size={16} />
          <div className={css.featureCopy}>
            <span className={css.featureTitle}>{t('relayTitle')}</span>
            <span className={css.featureDescription}>{t('relayDescription')}</span>
          </div>
        </div>
      </div>
      {dialogOpen && <CinlanSignInDialog t={t} onClose={() => { setDialogOpen(false) }}
        signIn={signIn} cancelSignIn={cancelSignIn} refresh={refresh} />}
    </section>
  )
}

/** Sign-in dialog props. */
interface CinlanSignInDialogProps {
  t: (key: CinlanAccountKey) => string
  onClose: () => void
  signIn: CinlanAccountInjected['signIn']
  cancelSignIn: CinlanAccountInjected['cancelSignIn']
  refresh: CinlanAccountInjected['refresh']
}

/** Collect account answers and run the Sub2API sign-in, surfacing the 2FA step. */
function CinlanSignInDialog({ t, onClose, signIn, cancelSignIn, refresh }: CinlanSignInDialogProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const outcome = await signIn({
        email, password,
        ...totpRequired && totpCode.trim().length > 0 ? { totpCode } : {},
      })
      if (outcome === 'authorized') {
        await refresh()
        onClose()
      } else setTotpRequired(true)
    } catch { setFailed(true) } finally { setBusy(false) }
  }
  const dismiss = (): void => {
    if (busy) { cancelSignIn(); return }
    onClose()
  }
  return (
    <Modal
      open
      onClose={dismiss}
      title={t('dialogTitle')}
      description={t('dialogDescription')}
      closeLabel={t('cancel')}
      className={css.dialog as string}
    >
      <form className={css.form} onSubmit={(event) => { void submit(event) }}>
        <div className={css.field}>
          <label className={css.label} htmlFor="cinlan-signin-email">{t('email')}</label>
          <Input
            id="cinlan-signin-email"
            type="email"
            autoComplete="username"
            required
            placeholder={t('emailPlaceholder')}
            value={email}
            disabled={busy}
            onChange={(event) => { setEmail(event.target.value) }}
          />
        </div>
        <div className={css.field}>
          <label className={css.label} htmlFor="cinlan-signin-password">{t('password')}</label>
          <Input
            id="cinlan-signin-password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            disabled={busy}
            onChange={(event) => { setPassword(event.target.value) }}
          />
        </div>
        {totpRequired && (
          <div className={css.field}>
            <label className={css.label} htmlFor="cinlan-signin-totp">{t('verificationCode')}</label>
            <Input
              id="cinlan-signin-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('verificationPlaceholder')}
              value={totpCode}
              disabled={busy}
              onChange={(event) => { setTotpCode(event.target.value) }}
            />
            <p className={css.notice}>{t('totpRequired')}</p>
          </div>
        )}
        {failed && (
          <div className={css.errorNotice} role="alert">
            <span className={css.errorText}>{t('signInFailed')}</span>
          </div>
        )}
        <div className={css.dialogActions}>
          <Button type="button" variant="outline" disabled={busy} onClick={dismiss}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || email.trim() === '' || password === ''}>
            {busy ? <><IconLoadingOutlineRegular className={css.spinner} size={14} />{t('signingIn')}</> : t('submit')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
