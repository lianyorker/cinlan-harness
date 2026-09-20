/** Native pairing page: explicit Session grants and transient invitation display. */
import { useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PairingScope } from '@deepseek-ai/dsh-remote-access/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PairingProps } from './types.ts'
import css from './PairingSection.module.css'

const scopes: readonly PairingScope[] = ['session:read', 'session:send', 'session:stop', 'questions:answer', 'approvals:decide']

/**
 * Render readiness, explicit grants, one-time invitation and revocable device metadata.
 * @param props - framework hooks, localized copy, and apply-owned management callbacks.
 * @returns the independent phone-pairing Settings section.
 */
export function PairingSection(props: PairingProps): ReactNode {
  const { t } = props
  const snapshot = props.usePairing(value => value)
  const sessions = props.usePairingSessions(value => value)
  const [selected, setSelected] = useState<SessionId[]>([])
  const [allowed, setAllowed] = useState<readonly PairingScope[]>(['session:read'])
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed'>()
  const { status, invitation, pending, failed } = snapshot
  const sessionIds = selected.filter(id => sessions.ids.includes(id))
  const ready = !failed && status?.state === 'ready'
  const copy = async (value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyState('copied')
    } catch {
      // Clipboard permission and availability failures retain selectable text.
      setCopyState('copyFailed')
    }
  }
  const copyValue = (label: string, value: string): ReactNode => <div className={css.copyRow}>
    <span><span className={css.label}>{label}</span><code>{value}</code></span>
    <Button variant="outline" aria-label={t('copy') + ' ' + label} onClick={() => { void copy(value) }}>{t('copy')}</Button>
  </div>
  return <section className={css.section}>
    <header><h2>{t('title')}</h2><p>{t('description')}</p></header>
    <div className={css.group} data-settings-anchor="listener" tabIndex={-1}>
      <h3>{t('listener')}</h3>
      <p role="status">{t(status === undefined ? 'loading' : status.state === 'not-configured' ? 'notConfigured' : status.state)}</p>
      {status?.state !== 'ready' && <p>{t('configuration')}</p>}
      {status !== undefined && status.missingConfiguration.length > 0 && <ul>
        {status.missingConfiguration.map(reason => <li key={reason}>{t(`missing.${reason}`)}</li>)}
      </ul>}
      {status?.origin !== null && status?.origin !== undefined && <p>{t('origin')}<code>{status.origin}</code></p>}
      {status?.certificateFingerprint !== null && status?.certificateFingerprint !== undefined && <p>{t('fingerprint')}<code>{status.certificateFingerprint}</code></p>}
      <div className={css.actions}>
        <Button variant="outline" disabled={pending} onClick={() => { void props.refresh() }}>{t('refresh')}</Button>
        <Button variant="primary" disabled={pending || status === undefined || ready} onClick={() => { void props.enable() }}>{t('enable')}</Button>
        <Button variant="outline" disabled={pending || status === undefined || status.state === 'disabled'} onClick={() => { void props.disable() }}>{t('disable')}</Button>
      </div>
      {failed && <p role="alert">{t('failed')}</p>}
    </div>
    <div className={css.group} data-settings-anchor="invitation" tabIndex={-1}>
      <h3>{t('invitation')}</h3>
      <fieldset disabled={pending || !ready || invitation !== undefined}>
        <legend>{t('sessions')}</legend><p>{t('sessionsHelp')}</p>
        {sessions.phase !== 'ready' ? <p>{t('sessionsLoading')}</p> : sessions.ids.length === 0 ? <p>{t('sessionsEmpty')}</p> : sessions.ids.map(id =>
          <label className={css.choice} key={id}>
            <input type="checkbox" checked={sessionIds.includes(id)} onChange={(event) => {
              const checked = event.currentTarget.checked
              setSelected(previous => checked ? [...previous, id] : previous.filter(value => value !== id))
            }} />
            <span>{sessions.byId[id]?.displayTitle}{' '}<code>{id}</code></span>
          </label>)}
      </fieldset>
      <fieldset disabled={pending || !ready || invitation !== undefined}>
        <legend>{t('permissions')}</legend><p>{t('permissionsHelp')}</p>
        {scopes.map(scope => <label className={css.choice} key={scope}>
          <input type="checkbox" checked={allowed.includes(scope)} disabled={scope === 'session:read'} onChange={(event) => {
            const checked = event.currentTarget.checked
            setAllowed(previous => checked ? [...previous, scope] : previous.filter(value => value !== scope))
          }} />{t(`scope.${scope}`)}
        </label>)}
      </fieldset>
      <Button variant="primary" disabled={pending || !ready || sessions.phase !== 'ready' || sessionIds.length === 0 || invitation !== undefined}
        onClick={() => { void props.createInvitation({ sessionIds, scopes: allowed }) }}>{t('create')}</Button>
      {invitation !== undefined && ready && <div className={css.invitation}>
        <p>{t('invitationHelp')}</p>
        {status.origin !== null && copyValue(t('link'), new URL('/pair', status.origin).href)}
        {copyValue(t('invitationId'), invitation.invitationId)}
        {copyValue(t('code'), invitation.code)}
        <p>{t('expires')}<time dateTime={new Date(invitation.expiresAt).toISOString()}>{new Date(invitation.expiresAt).toISOString()}</time></p>
        <p>{t('sessionIds')}<code>{invitation.sessionIds.join(', ')}</code></p>
        <p>{t('permissions')}: {invitation.scopes.map(scope => t(`scope.${scope}`)).join(', ')}</p>
        <Button variant="outline" disabled={pending} onClick={() => { void props.cancelInvitation() }}>{t('cancel')}</Button>
        {copyState !== undefined && <p role="status">{t(copyState)}</p>}
      </div>}
    </div>
    <div className={css.group} data-settings-anchor="devices" tabIndex={-1}>
      <h3>{t('devices')}</h3>
      {status?.devices.length === 0 && <p>{t('noDevices')}</p>}
      {status?.devices.map(device => <article className={css.device} key={device.deviceId}>
        <h4>{device.displayName}</h4>
        <dl>
          <dt>{t('deviceId')}</dt><dd><code>{device.deviceId}</code></dd>
          <dt>{t('deviceStatus')}</dt><dd>{t(device.revokedAt !== null ? 'revoked' : device.expiresAt <= Date.now() ? 'expired' : 'active')}</dd>
          <dt>{t('sessionIds')}</dt><dd>{device.sessionIds.map(id => <code key={id}>{id}</code>)}</dd>
          <dt>{t('permissions')}</dt><dd>{device.scopes.map(scope => <div key={scope}>{t(`scope.${scope}`)} <code>{scope}</code></div>)}</dd>
          <dt>{t('expires')}</dt><dd><time dateTime={new Date(device.expiresAt).toISOString()}>{new Date(device.expiresAt).toISOString()}</time></dd>
        </dl>
        <Button variant="outline" disabled={pending || device.revokedAt !== null} aria-label={t('revokeNamed', { name: device.displayName })}
          onClick={() => { void props.revokeDevice(device.deviceId) }}>{t('revoke')}</Button>
      </article>)}
    </div>
  </section>
}
