/** Explicit Android resource operations and exact device/process mirroring controls. */
import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  MobileMirrorId, MobileResourceRequest, MobileResourceStatus, MobileResourceTask, MobileResourceTaskId,
} from '@deepseek-ai/dsh-mobile-device-runtime/types'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MobileResourceRead } from './mobile-resources.ts'
import type { MobileResourcesKey } from './mobile-locales.ts'
import css from './MobileResourcesSection.module.css'

/** Registration-owned observations and exact human resource commands. */
export interface MobileResourcesInjected {
  /** Release only observation when the panel leaves. */
  watchMobileResources: () => () => void
  /** Re-read authoritative Host facts. */
  refreshMobileResources: () => void
  /** Submit the displayed revision and explicit license decision. */
  runMobileResource: (request: MobileResourceRequest) => Promise<void>
  /** Cancel exactly the displayed Host task. */
  cancelMobileResource: (taskId: MobileResourceTaskId) => Promise<void>
  /** Start only the explicitly selected available Android device. */
  startMobileMirror: (deviceId: string) => Promise<void>
  /** Close only this owned mirror process. */
  closeMobileMirror: (mirrorId: MobileMirrorId) => Promise<void>
  /** Renderer binds the Host snapshot source to useMobileResources. */
  hooks: { mobileResources: SnapshotStore<MobileResourceRead> }
}

/** Props derived from the Settings locale and injected observation. */
export type MobileResourcesProps = InjectFace<MobileResourcesInjected> & PropsLocale<'settings.cinlanCapabilities'>
const PHASES = {
  preparing: 'mobileResourcesPreparing', downloading: 'mobileResourcesDownloading', verifying: 'mobileResourcesVerifying',
  extracting: 'mobileResourcesExtracting', committing: 'mobileResourcesCommitting', complete: 'mobileResourcesComplete',
} as const satisfies Record<MobileResourceTask['phase'], MobileResourcesKey>
const SOURCES = { custom: 'mobileResourcesCustom', managed: 'mobileResourcesManaged', path: 'mobileResourcesSystem' } as const
const MIRRORS = { starting: 'mobileResourcesMirrorStarting', running: 'mobileResourcesMirrorRunning',
  closed: 'mobileResourcesMirrorClosed', failed: 'mobileResourcesMirrorFailed' } as const
const INTEGRITY = { missing: 'mobileResourcesMissing', verified: 'mobileResourcesVerified', invalid: 'mobileResourcesInvalid' } as const

function ResourceRow({ resource, busy, run, t }: {
  resource: MobileResourceStatus
  busy: boolean
  run: (request: MobileResourceRequest) => void
} & PropsLocale<'settings.cinlanCapabilities'>) {
  const [accepted, setAccepted] = useState(false)
  const [removal, setRemoval] = useState<MobileResourceRequest>()
  const mutable = resource.supported && !resource.leased && !busy
  const installed = resource.installedVersion !== null
  const submit = (operation: MobileResourceTask['operation']): void => {
    if (!mutable || (operation !== 'remove' && !accepted)) return
    run({ resourceId: resource.definition.id, expectedRevision: resource.revision, operation, acceptLicense: accepted })
  }
  return <article className={css.resource} aria-label={resource.definition.id}>
    <h3>{resource.definition.id}</h3>
    <p>{t(INTEGRITY[resource.integrity])}</p>
    <dl className={css.facts}>
      <div><dt>{t('mobileResourcesVersion')}</dt><dd>{resource.definition.version}</dd></div>
      <div><dt>{t('mobileResourcesInstalled')}</dt><dd>{resource.installedVersion ?? t('mobileResourcesMissing')}</dd></div>
      {resource.installedPath !== null && <div><dt>{t('mobileResourcesPath')}</dt><dd>{resource.installedPath}</dd></div>}
    </dl>
    {!resource.supported && <p>{t('mobileResourcesUnsupported')}</p>}
    {resource.leased && <p>{t('mobileResourcesLeased')}</p>}
    <a href={resource.definition.licenseUrl} target="_blank" rel="noreferrer">{t('mobileResourcesLicense')}: {resource.definition.licenseName}</a>
    <label className={css.accept}><input type="checkbox" checked={accepted} disabled={!mutable}
      onChange={(event) => { setAccepted(event.currentTarget.checked) }} />{t('mobileResourcesAcceptLicense')}</label>
    <div className={css.actions}>
      <Button variant="outline" disabled={!mutable || !accepted} onClick={() => { submit(installed ? 'reinstall' : 'install') }}>
        {t(installed ? 'mobileResourcesRepair' : 'mobileResourcesInstall')}</Button>
      {resource.updateAvailable && installed && <Button variant="outline" disabled={!mutable || !accepted}
        onClick={() => { submit('update') }}>{t('mobileResourcesUpdate')}</Button>}
      {installed && <Button variant="outline" disabled={!mutable} onClick={() => {
        setRemoval({ resourceId: resource.definition.id, expectedRevision: resource.revision, operation: 'remove', acceptLicense: false })
      }}>{t('mobileResourcesRemove')}</Button>}
    </div>
    <Modal open={removal !== undefined} title={t('mobileResourcesRemoveTitle')} description={t('mobileResourcesRemoveDescription')}
      closeLabel={t('mobileResourcesClose')} onClose={() => { setRemoval(undefined) }} footer={<>
        <Button variant="outline" onClick={() => { setRemoval(undefined) }}>{t('mobileResourcesKeep')}</Button>
        <Button variant="outline" disabled={!mutable || removal?.expectedRevision !== resource.revision} onClick={() => {
          if (mutable && removal !== undefined && removal.expectedRevision === resource.revision) { run(removal); setRemoval(undefined) }
        }}>{t('mobileResourcesRemove')}</Button>
      </>} />
  </article>
}

/** Display Host facts and explicit commands without treating files as device readiness.
 * @param props - Framework-bound Host snapshots, localized copy, and human command callbacks.
 * @returns Resource licenses, installation controls, selected device and owned mirror state.
 */
export function MobileResourcesSection({ useMobileResources, watchMobileResources, refreshMobileResources,
  runMobileResource, cancelMobileResource, startMobileMirror, closeMobileMirror, t }: MobileResourcesProps) {
  const read = useMobileResources(value => value)
  const [pending, setPending] = useState(false)
  const [requestError, setRequestError] = useState(false)
  const [selected, setSelected] = useState('')
  const active = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => {
    active.current = true
    const release = watchMobileResources()
    return () => { active.current = false; release() }
  }, [watchMobileResources])
  const request = async (action: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true; setPending(true); setRequestError(false)
    try { await action() } catch (_resourceRequestRejected) { if (active.current) setRequestError(true) }
    finally { inFlight.current = false; if (active.current) setPending(false) }
  }
  const status = read.status === 'ready' ? read.value : undefined
  const task = status?.task
  const running = task?.state === 'running'
  const mirror = status?.mirror
  const mirroring = mirror?.state === 'running' || mirror?.state === 'starting'
  const device = status?.devices.find(item => item.id === selected && item.available)
  const canMirror = !pending && !running && !mirroring && device !== undefined && status?.adb.error === null
    && status.resources.some(item => item.definition.id === 'scrcpy' && item.supported && item.integrity === 'verified')
  return <section className={css.section} aria-label={t('mobileResourcesTitle')} data-settings-anchor="mobile-resources">
    <h2>{t('mobileResourcesTitle')}</h2><p>{t('mobileResourcesDescription')}</p>
    {read.status === 'loading' && <p role="status">{t('mobileResourcesLoading')}</p>}
    {read.status === 'error' && <p role="alert">{t('mobileResourcesReadFailed')}</p>}
    {status !== undefined && <>
      <div className={css.resources}>{status.resources.map(resource => <ResourceRow
        key={resource.definition.id + ':' + resource.revision} resource={resource} busy={pending || running}
        run={(value) => { void request(() => runMobileResource(value)) }} t={t} />)}</div>
      {task !== null && task !== undefined && <div role={task.state === 'failed' ? 'alert' : 'status'}>
        <p>{task.resourceId}</p>
        <p>{t(task.state === 'failed' ? 'mobileResourcesTaskFailed' : task.state === 'cancelled'
          ? 'mobileResourcesCancelled' : PHASES[task.phase])}</p>
        {running && <><progress aria-label={t('mobileResourcesProgress')}
          {...task.totalBytes > 0 ? { max: task.totalBytes, value: task.downloadedBytes } : {}} />
        <Button variant="outline" disabled={pending || task.phase === 'committing'}
          onClick={() => { void request(() => cancelMobileResource(task.id)) }}>{t('mobileResourcesCancel')}</Button></>}
      </div>}
      <h3>{t('mobileResourcesAdbTitle')}</h3>
      <dl className={css.facts}><div><dt>{t('mobileResourcesAdbSource')}</dt><dd>{t(SOURCES[status.adb.source])}</dd></div>
        <div><dt>{t('mobileResourcesPath')}</dt><dd>{status.adb.path}</dd></div>
        <div><dt>{t('mobileResourcesInstalled')}</dt><dd>{status.adb.version ?? t('mobileResourcesMissing')}</dd></div></dl>
      {status.adb.error !== null && <p role="alert">{t('mobileResourcesAdbFailed')}</p>}
      {status.devices.length === 0 && <p>{t('mobileResourcesNoDevices')}</p>}
      <label>{t('mobileResourcesSelectDevice')}<select value={device?.id ?? ''} disabled={pending || mirroring}
        onChange={(event) => { setSelected(event.currentTarget.value) }}>
        <option value="">{t('mobileResourcesChooseDevice')}</option>
        {status.devices.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{item.serial} — {item.state}</option>)}
      </select></label>
      <div className={css.actions}><Button variant="outline" disabled={!canMirror} onClick={() => {
        if (canMirror) void request(() => startMobileMirror(device.id))
      }}>{t('mobileResourcesMirrorStart')}</Button>
      {mirroring && <Button variant="outline" disabled={pending} onClick={() => {
        void request(() => closeMobileMirror(mirror.id))
      }}>{t('mobileResourcesMirrorStop')}</Button>}
      </div>
      {mirror !== null && mirror !== undefined && <p role={mirror.state === 'failed' ? 'alert' : 'status'}>
        {mirror.deviceId}: {t(MIRRORS[mirror.state])}</p>}
      <p>{t('mobileResourcesContinues')}</p><p>{t('mobileResourcesIosUnsupported')}</p>
    </>}
    {requestError && <p role="alert">{t('mobileResourcesActionFailed')}</p>}
    <div><Button variant="ghost" disabled={pending} onClick={refreshMobileResources}>{t('mobileResourcesRefresh')}</Button></div>
  </section>
}
