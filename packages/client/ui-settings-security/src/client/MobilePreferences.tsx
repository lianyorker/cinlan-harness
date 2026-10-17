/** Mobile Emulator setup card: availability, Android SDK, and default device. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DeviceCapabilitySnapshot, MobileDeviceListSnapshot, MobileSdkSnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { InjectFace, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MobileSectionInjected, CapabilitySectionProps } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './CapabilitySection.module.css'
import { Button, IconCheckOutline16, IconFolderOpen16, IconRefreshOutline16, IconWarningOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'

/** Device readiness the capability page already probed, projected into the setup card. */
export interface MobileAvailability {
  /** Raw probe status, which selects the badge tone. */
  readonly status: DeviceCapabilitySnapshot['status'] | 'checking'
  /** Locale key naming that status. */
  readonly statusKey: CapabilitySettingsKey
  /** Localized explanation of the current probe status. */
  readonly reason: string
  /** True while the Host probe is in flight. */
  readonly checking: boolean
  /** Re-run the read-only device probe owned by the capability page. */
  readonly onRefresh: () => void
}

type Props = PropsRenderFactories & Pick<InjectFace<MobileSectionInjected>, 'useMobileSettings' | 'saveMobileSettings' | 'checkSdk' | 'listMobileDevices' | 'openSdkDirectory'> & Pick<CapabilitySectionProps, 't'> & {
  /** Probe result rendered as the availability row. */
  readonly availability: MobileAvailability
}

/**
 * Save mobile preferences on blur without granting device-control authority. Writes are serialized;
 * later edits retain their draft, and a failed write leaves the input available for retry.
 * @param props - Renderer-bound settings, revision-fenced callbacks, read-only checks, and the probed availability.
 * @returns The preference fields, read-only checks, and shared directory picker.
 */
export function MobilePreferences({
  useMobileSettings, saveMobileSettings, checkSdk, listMobileDevices,
  renderFactorySlot, openSdkDirectory, availability, t,
}: Props): ReactNode {
  const snapshot = useMobileSettings(value => value)
  const [draft, setDraft] = useState<{ value: MobileDeviceSettings; revision: number }>()
  const currentDraft = useRef<typeof draft>()
  const saveRequested = useRef(false)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [request, setRequest] = useState(0)
  const [sdk, setSdk] = useState<MobileSdkSnapshot>()
  const [devices, setDevices] = useState<MobileDeviceListSnapshot>()
  const [sdkState, setSdkState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [deviceState, setDeviceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [folderAction, setFolderAction] = useState<'picking' | 'opening'>()
  const [folderError, setFolderError] = useState<CapabilitySettingsKey>()
  const mounted = useRef(false)
  const pending = useRef(false)
  const folderPending = useRef(false)
  const lifetime = useRef<AbortController>()
  useEffect(() => {
    mounted.current = true
    const abort = new AbortController()
    lifetime.current = abort
    return () => { mounted.current = false; abort.abort() }
  }, [])
  useEffect(() => {
    if (snapshot.value?.enabled !== true && request === 0) return
    const abort = new AbortController()
    setSdkState('loading'); setDeviceState('loading')
    void checkSdk(abort.signal).then(
      (value) => { if (!abort.signal.aborted) { setSdk(value); setSdkState('ready') } },
      () => { if (!abort.signal.aborted) setSdkState('error') },
    )
    void listMobileDevices(abort.signal).then(
      (value) => { if (!abort.signal.aborted) { setDevices(value); setDeviceState('ready') } },
      () => { if (!abort.signal.aborted) setDeviceState('error') },
    )
    return () => { abort.abort() }
  }, [snapshot.value?.enabled, request, checkSdk, listMobileDevices])
  const value = draft?.value ?? snapshot.value
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const editingDisabled = !writable || folderAction !== undefined
  const change = (patch: Partial<MobileDeviceSettings>): void => {
    if (!writable || folderPending.current || value === undefined || snapshot.revision === undefined) return
    const next = { ...(currentDraft.current?.value ?? value), ...patch }
    currentDraft.current = { value: next, revision: currentDraft.current?.revision ?? snapshot.revision }
    setDraft(currentDraft.current)
    setStatus('idle')
  }
  const save = async (): Promise<void> => {
    if (!writable || folderPending.current || currentDraft.current === undefined) return
    saveRequested.current = true
    if (pending.current) return
    pending.current = true; setStatus('saving')
    try {
      let savedSdkPath = snapshot.value?.androidSdkPath
      while (saveRequested.current && currentDraft.current !== undefined && mounted.current) {
        saveRequested.current = false
        const writing: NonNullable<typeof draft> = currentDraft.current
        const sdkChanged = writing.value.androidSdkPath !== savedSdkPath
        const revision = await saveMobileSettings(writing.value, writing.revision)
        if (lifetime.current?.signal.aborted === true) return
        savedSdkPath = writing.value.androidSdkPath
        currentDraft.current = currentDraft.current === writing ? undefined
          : { value: currentDraft.current.value, revision }
        setDraft(currentDraft.current)
        setStatus(currentDraft.current === undefined ? 'saved' : 'idle')
        if (sdkChanged) { setRequest(current => current + 1); availability.onRefresh() }
      }
    } catch (_preferenceWriteRejected) {
      saveRequested.current = false
      if (mounted.current) setStatus('error')
    } finally { pending.current = false }
  }
  const changeAndSave = (patch: Partial<MobileDeviceSettings>): void => { change(patch); void save() }
  const unavailable = t(snapshot.status === 'loading' ? 'preferencesLoading' : 'preferencesUnavailable')
  const selectedMissing = value !== undefined && value.defaultDeviceId !== '' && !devices?.devices.some(device => device.id === value.defaultDeviceId)
  const detectedPath = sdkState === 'ready' && sdk?.android.found === true ? sdk.android.sdkPath ?? undefined : undefined
  const sdkDraft = draft !== undefined && draft.value.androidSdkPath !== snapshot.value?.androidSdkPath
  const sdkDetail = sdkDraft ? t('mobileSdkDraft') : sdkState === 'loading' ? t('preferencesLoading')
    : sdkState === 'error' ? t('mobileSdkFailed')
      : sdk === undefined ? t('mobileNotChecked')
        : !sdk.android.found ? t('mobileSdkAndroidNotFound')
          : detectedPath === undefined ? t('mobileSdkFound') : t('mobileSdkDetectedAt', { path: detectedPath })
  const deviceCount = devices?.available === true ? devices.devices.length : undefined
  const availabilityDetail = deviceCount === undefined ? availability.reason
    : deviceCount === 0 ? t('deviceNoDevices')
      : t(deviceCount === 1 ? 'mobileDeviceDetectedOne' : 'mobileDevicesDetected', { count: deviceCount })
  const checking = sdkState === 'loading' || deviceState === 'loading'
  const refreshAll = (): void => { setRequest(current => current + 1); availability.onRefresh() }
  const closePicker = (): void => { folderPending.current = false; setFolderAction(undefined) }
  const pickFolder = (): void => {
    if (!writable || folderPending.current) return
    folderPending.current = true; setFolderAction('picking'); setFolderError(undefined)
  }
  const openFolder = async (): Promise<void> => {
    const signal = lifetime.current?.signal
    if (signal === undefined || !mounted.current || pending.current || folderPending.current
      || detectedPath === undefined || sdkDraft) return
    folderPending.current = true; setFolderAction('opening'); setFolderError(undefined)
    try {
      await openSdkDirectory(detectedPath, signal)
    } catch (_folderRequestRejected) {
      if (!signal.aborted) setFolderError('mobileSdkOpenFailed')
    } finally {
      folderPending.current = false
      if (!signal.aborted) setFolderAction(undefined)
    }
  }
  return <form className={css.mobileSetupCard} data-settings-anchor="mobile-setup" aria-busy={checking}
    onBlur={() => { void save() }}
    onSubmit={(event) => { event.preventDefault(); void save() }}>
    {snapshot.status !== 'ready' && <p role="status">{unavailable}</p>}
    <fieldset>
      <div className={css.settingRow} data-settings-anchor="mobile-readiness">
        <span>{t('mobileSdkStatusTitle')}<small>{availabilityDetail}</small></span>
        <span className={css.settingControl}>
          <span className={css.computerBadge} data-capability-status={availability.status} role="status">
            <span className={css.dot} aria-hidden="true" />{t(availability.statusKey)}
          </span>
          <Tooltip label={t('mobileAgentRecheck')} portal>
            <Button size="sm" variant="outline" aria-label={t('mobileAgentRecheck')} icon={<IconRefreshOutline16 />}
              disabled={availability.checking || checking} onClick={refreshAll} />
          </Tooltip>
        </span>
      </div>
      <div className={css.sdkPanel} data-settings-anchor="mobile-sdk-path" aria-busy={folderAction !== undefined}>
        <div className={css.sdkHeader}>
          <div className={css.sdkStatus}>
            {sdk?.android.found === true && !sdkDraft ? <IconCheckOutline16 /> : <IconWarningOutline16 />}
            <span>{t('mobileSdkAndroid')}<small>{sdkDetail}</small></span>
          </div>
          <div className={css.settingControl}>
            <a className={css.sdkDownload} href="https://developer.android.com/studio" target="_blank" rel="noreferrer">{t('mobileSdkDownload')}</a>
            <Button size="sm" variant="ghost" icon={<IconFolderOpen16 />} disabled={editingDisabled}
              onClick={pickFolder}>{t('mobileSdkLocate')}</Button>
            {detectedPath !== undefined && !sdkDraft && <Button size="sm" variant="outline" icon={<IconFolderOpen16 />}
              disabled={folderAction !== undefined || status === 'saving'}
              onClick={() => { void openFolder() }}>{t('mobileSdkOpen')}</Button>}
          </div>
        </div>
        <div className={css.sdkPath}>
          <label htmlFor="mobile-sdk-custom-path">{t('mobileSdkCustomPath')}</label>
          {value !== undefined && <input id="mobile-sdk-custom-path" type="text" disabled={editingDisabled} value={value.androidSdkPath}
            onChange={(event) => { change({ androidSdkPath: event.currentTarget.value }) }} />}
          {detectedPath !== undefined && <Button size="sm" variant="ghost" disabled={editingDisabled}
            onClick={() => { changeAndSave({ androidSdkPath: detectedPath }) }}>{t('mobileSdkUseDetected')}</Button>}
          {value !== undefined && value.androidSdkPath !== '' && <Button size="sm" variant="ghost" disabled={editingDisabled}
            onClick={() => { changeAndSave({ androidSdkPath: '' }) }}>{t('mobileSdkClear')}</Button>}
        </div>
        <p>{t('mobileSdkPathHelp')}</p>
        {folderError !== undefined && <p className={css.failure} role="alert">{t(folderError)}</p>}
        {folderAction === 'picking' && renderFactorySlot('directory.picker', {
          open: true, busy: false,
          onPicked: (path) => { closePicker(); changeAndSave({ androidSdkPath: path }) },
          onCancel: closePicker,
          onError: () => { closePicker(); setFolderError('mobileSdkPickFailed') },
        }, { fallback: <div className={css.settingControl}>
          <p className={css.failure} role="alert">{t('mobileSdkPickFailed')}</p>
          <Button size="sm" variant="ghost" onClick={closePicker}>{t('mobileSdkCancel')}</Button>
        </div> })}
      </div>
      {sdkState === 'ready' && sdk?.ios !== null && sdk?.ios !== undefined && <div className={css.settingRow} data-settings-anchor="mobile-ios">
        <span>{t('mobileSdkIos')}<small>{t(sdk.ios.simctlOk ? 'mobileSdkIosReady' : 'mobileSdkIosNotReady')}</small></span>
      </div>}
      <div className={css.settingRow} data-settings-anchor="mobile-device">
        <span>{t('mobileDefaultDevice')}<small>{t('mobileDefaultDeviceDescription')}</small></span>
        <select aria-label={t('mobileDefaultDevice')} disabled={editingDisabled || value === undefined}
          value={value?.defaultDeviceId ?? ''} onChange={(event) => { change({ defaultDeviceId: event.currentTarget.value }) }}>
          <option value="">{t('mobileDefaultDeviceAuto')}</option>
          {selectedMissing && value !== undefined && <option value={value.defaultDeviceId} disabled>{t('mobileSavedDeviceUnavailable')}</option>}
          {devices?.devices.map(device => <option key={device.id} value={device.id} disabled={!device.isAvailable}>
            {device.name}
          </option>)}
        </select>
      </div>
    </fieldset>
    {deviceState === 'error' && <p className={css.failure} role="alert">{t('mobileDevicesFailed')}</p>}
    {status === 'saved' && <p role="status">{t('mobilePreferencesSaved')}</p>}
    {status === 'error' && <p className={css.failure} role="alert">{t('preferencesFailed')}</p>}
  </form>
}
