/** Security skill installation resources, independent of scan configuration and reports. */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SecuritySkillResourceOperation } from '@deepseek-ai/dsh-security-skills/types'
import { Button, IconSkillOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilitySettingsKey } from './locales.ts'
import type { SecurityResourceRead } from './resource-observer.ts'
import css from './SecurityResourcesSection.module.css'

/** Resource commands use the Host operation kinds, without duplicating its resource schema. */
export type SecurityResourceAction = SecuritySkillResourceOperation['kind']

/** Registration-private snapshot source and explicit resource operations. */
export interface SecurityResourcesInjected {
  /** Start an observation; disposal only unsubscribes. */
  watch: () => () => void
  /** Reconnect to the Host resource observation. */
  refresh: () => void
  /** Start one Host-owned operation without retaining its lifetime in the page. */
  run: (action: SecurityResourceAction) => Promise<void>
  /** Cancel only the operation the user observed. */
  cancel: (id: SecuritySkillResourceOperation['id']) => Promise<void>
  /** Framework binds the one authoritative resource snapshot source. */
  hooks: { securityResources: SnapshotStore<SecurityResourceRead> }
}

/** Slot-derived props for the security resource section. */
export type SecurityResourcesProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.cinlanCapabilities'> & InjectFace<SecurityResourcesInjected>

const PHASES = {
  'fetching-manifest': 'resourceFetching', downloading: 'resourceDownloading', extracting: 'resourceExtracting',
  validating: 'resourceValidating', committing: 'resourceCommitting', cancelling: 'resourceCancelling',
} as const satisfies Record<SecuritySkillResourceOperation['phase'], CapabilitySettingsKey>

/** Render resource provenance and human-initiated installation operations.
 * @param props - Framework-bound resource snapshot and callbacks.
 * @returns The resource manager, including explicit unavailable and reconnect states.
 */
export function SecurityResourcesSection({ useSecurityResources, watch, refresh, run, cancel, t }: SecurityResourcesProps) {
  const read = useSecurityResources(snapshot => snapshot)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [attempt, setAttempt] = useState<SecurityResourceAction>()
  useEffect(() => watch(), [watch])

  const status = read.status === 'ready' && read.value.state !== 'unavailable' ? read.value : undefined
  const operation = status?.operation
  const installed = status?.installed
  const busy = pending || operation !== undefined
  const canCancel = operation !== undefined && !pending && operation.phase !== 'cancelling' && operation.phase !== 'committing'
  const perform = async (action: SecurityResourceAction): Promise<void> => {
    if (busy) return
    setPending(true)
    setRequestError(false)
    setAttempt(action)
    try { await run(action) } catch (_resourceRequestFailed) { setRequestError(true) } finally { setPending(false) }
  }
  const stop = async (): Promise<void> => {
    if (!canCancel) return
    setPending(true)
    setRequestError(false)
    try { await cancel(operation.id) } catch (_resourceCancellationFailed) { setRequestError(true) } finally { setPending(false) }
  }
  const retry = attempt ?? (status?.download.available
    ? status.available === undefined ? 'check-update' : installed === undefined ? 'install' : 'reinstall'
    : 'install-bundled')
  const error = requestError ? t('resourceActionFailed') : status?.lastError
  const needsUpdate = status?.available !== undefined && installed !== undefined && status.available.version !== installed.version

  return <section className={css.section} aria-label={t('resourceTitle')}>
    <header className={css.heading}><h1>{t('resourceTitle')}</h1><p>{t('resourceDescription')}</p></header>
    <section className={css.resource} data-settings-anchor="security-resources">
      <div className={css.title}>
        <IconSkillOutline16 aria-hidden="true" />
        <h2>{t('securityNav')}</h2>
        {status !== undefined && <span className={css.badge}>{t(operation !== undefined ? 'resourceWorking'
          : installed !== undefined ? 'resourceInstalled' : status.state === 'error' ? 'resourceFailed' : 'resourceNotInstalled')}</span>}
      </div>
      {read.status === 'loading' && <p role="status">{t('resourceLoading')}</p>}
      {read.status === 'error' && <p role="alert" className={css.error}>{t('resourceReadFailed')}</p>}
      {read.status === 'ready' && read.value.state === 'unavailable' && <p role="status">{t('resourceMissing')}</p>}
      {status !== undefined && <>
        <dl className={css.facts}>
          <div><dt>{t('resourceInstalledVersion')}</dt><dd>{installed?.version ?? t('resourceAbsent')}</dd></div>
          <div><dt>{t('resourceAvailableVersion')}</dt><dd>{status.available?.version ?? t('resourceNotChecked')}</dd></div>
          <div><dt>{t('resourceSource')}</dt><dd>{installed === undefined ? t('resourceAbsent')
            : installed.source.kind === 'bundled' ? t('resourceBundled')
              : <><span>{t('resourceDownloaded')}</span>{installed.source.url && <span>{installed.source.url}</span>}</>}</dd></div>
        </dl>
        {!status.download.available && <p>{t('resourceNoRelease')}</p>}
        {operation !== undefined && <div className={css.progress} role="status">
          <span>{t(PHASES[operation.phase])}</span>
          <progress aria-label={t('resourceProgress')} {...operation.totalBytes !== undefined && operation.totalBytes > 0
            ? { value: operation.bytesReceived, max: operation.totalBytes } : {}} />
          <span>{operation.totalBytes === undefined
            ? t('resourceReceived', { received: operation.bytesReceived })
            : t('resourceBytes', { received: operation.bytesReceived, total: operation.totalBytes })}</span>
          <p>{t('resourceContinues')}</p>
        </div>}
        {error !== undefined && <p role="alert" className={css.error}>{error}</p>}
        <div className={css.actions}>
          {status.download.available ? <>
            <Button variant="outline" disabled={busy} onClick={() => { void perform('check-update') }}>{t('resourceCheck')}</Button>
            {installed === undefined
              ? <Button disabled={busy} onClick={() => { void perform('install') }}>{t('resourceInstall')}</Button>
              : <><Button variant="outline" disabled={busy} onClick={() => { void perform('reinstall') }}>{t('resourceReinstall')}</Button>
                {needsUpdate && <Button disabled={busy} onClick={() => { void perform('update') }}>{t('resourceUpdate')}</Button>}</>}
          </> : <Button disabled={busy} onClick={() => { void perform('install-bundled') }}>{t('resourceInstallBundled')}</Button>}
          {installed !== undefined && <Button variant="outline" disabled={busy} onClick={() => { setConfirmRemove(true) }}>{t('resourceRemove')}</Button>}
          {operation !== undefined && <Button variant="outline" disabled={!canCancel}
            onClick={() => { void stop() }}>{t('resourceCancel')}</Button>}
          {error !== undefined && operation === undefined && <Button variant="outline" disabled={pending}
            onClick={() => { if (retry === 'remove') setConfirmRemove(true); else void perform(retry) }}>{t('resourceRetry')}</Button>}
        </div>
      </>}
      <div><Button variant="ghost" disabled={pending} onClick={refresh}>{t('resourceRefresh')}</Button></div>
    </section>
    <section data-settings-anchor="security-resource-usage"><h2>{t('resourceUseTitle')}</h2><p>{t('resourceUseDescription')}</p></section>
    <Modal open={confirmRemove} title={t('resourceRemoveTitle')} description={t('resourceRemoveDescription')}
      closeLabel={t('resourceClose')} onClose={() => { setConfirmRemove(false) }} footer={<>
        <Button variant="outline" onClick={() => { setConfirmRemove(false) }}>{t('resourceKeep')}</Button>
        <Button disabled={busy || installed === undefined} onClick={() => { setConfirmRemove(false); void perform('remove') }}>{t('resourceRemove')}</Button>
      </>} />
  </section>
}
