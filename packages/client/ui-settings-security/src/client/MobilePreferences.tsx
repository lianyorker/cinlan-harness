/** Mobile Emulator setup card: enable, availability, Android SDK, and default device. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DeviceCapabilitySnapshot, MobileDeviceListSnapshot, MobileSdkSnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { MobileSectionInjected, CapabilitySectionProps } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './CapabilitySection.module.css'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'

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

type Props = Pick<InjectFace<MobileSectionInjected>, 'useMobileSettings' | 'saveMobileSettings' | 'resetMobileSettings' | 'checkSdk' | 'listMobileDevices'> & Pick<CapabilitySectionProps, 't'> & {
  /** Probe result rendered as the availability row. */
  readonly availability: MobileAvailability
}

/**
 * Edit mobile emulator setup without granting control authority: one draft form owns the enable switch,
 * the custom SDK path, and the default device, while availability and toolchain rows stay read-only.
 * @param props - Renderer-bound settings, revision-fenced callbacks, read-only checks, and the probed availability.
 * @returns The setup card with its switch, availability, SDK, device, and save rows.
 */
export function MobilePreferences({
  useMobileSettings, saveMobileSettings, resetMobileSettings, checkSdk, listMobileDevices, availability, t,
}: Props): ReactNode {
  const snapshot = useMobileSettings(value => value)
  const [draft, setDraft] = useState<{ value: MobileDeviceSettings; revision: number }>()
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [request, setRequest] = useState(0)
  const [sdk, setSdk] = useState<MobileSdkSnapshot>()
  const [devices, setDevices] = useState<MobileDeviceListSnapshot>()
  const [sdkState, setSdkState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [deviceState, setDeviceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const mounted = useRef(false)
  const pending = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
  const change = (patch: Partial<MobileDeviceSettings>): void => {
    if (!writable || pending.current || value === undefined || snapshot.revision === undefined) return
    setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? snapshot.revision })
    setStatus('idle')
  }
  const save = async (reset = false): Promise<void> => {
    if (!writable || pending.current || snapshot.revision === undefined || (!reset && draft === undefined)) return
    pending.current = true; setStatus('saving')
    try {
      if (reset) await resetMobileSettings(draft?.revision ?? snapshot.revision)
      else {
        /* v8 ignore next -- defensive: the submit control stays disabled until a draft exists, so a write with no draft has no route. */
        if (draft !== undefined) await saveMobileSettings(draft.value, draft.revision)
      }
      if (mounted.current) { setDraft(undefined); setStatus('saved') }
    } catch (_preferenceWriteRejected) {
      if (mounted.current) setStatus('error')
    } finally { pending.current = false }
  }
  const unavailable = t(snapshot.status === 'loading' ? 'preferencesLoading' : 'preferencesUnavailable')
  const selectedMissing = value !== undefined && value.defaultDeviceId !== '' && !devices?.devices.some(device => device.id === value.defaultDeviceId)
  const detectedPath = sdkState === 'ready' && sdk?.android.found === true ? sdk.android.sdkPath ?? undefined : undefined
  const sdkDetail = sdkState === 'loading' ? t('preferencesLoading')
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
  return <form className={css.mobileSetupCard} data-settings-anchor="mobile-setup" aria-busy={checking}
    onSubmit={(event) => { event.preventDefault(); void save() }}>
    {snapshot.status !== 'ready' && <p role="status">{unavailable}</p>}
    <fieldset disabled={!writable || status === 'saving'}>
      <div className={css.settingRow} data-settings-anchor="mobile-enabled">
        <span>{t('mobileEnable')}<small>{t('mobileEnableDescription')}</small></span>
        {value !== undefined && <Switch label={t('mobileEnable')}
          checked={value.enabled} disabled={!writable || status === 'saving'} onChange={(enabled) => { change({ enabled }) }} />}
      </div>
      <div className={css.settingRow} data-settings-anchor="mobile-readiness">
        <span>{t('mobileSdkStatusTitle')}<small>{availabilityDetail}</small></span>
        <span className={css.settingControl}>
          <span className={css.computerBadge} data-capability-status={availability.status} role="status">
            <span className={css.dot} aria-hidden="true" />{t(availability.statusKey)}
          </span>
          <button type="button" className={css.recheckButton} disabled={availability.checking}
            onClick={refreshAll}>{t('mobileAgentRecheck')}</button>
        </span>
      </div>
      <div className={css.settingRow} data-settings-anchor="mobile-sdk-path">
        <span>{t('mobileSdkAndroid')}<small>{sdkDetail}</small></span>
        <span className={css.settingControl}>
          {sdkState === 'ready' && sdk?.android.found === false
            && <a className={css.recheckButton} href="https://developer.android.com/studio" target="_blank" rel="noreferrer">{t('mobileSdkDownload')}</a>}
          {detectedPath !== undefined && <button type="button" className={css.recheckButton}
            onClick={() => { change({ androidSdkPath: detectedPath }) }}>{t('mobileSdkUseDetected')}</button>}
          {value !== undefined && value.androidSdkPath !== '' && <button type="button" className={css.recheckButton}
            onClick={() => { change({ androidSdkPath: '' }) }}>{t('mobileSdkClear')}</button>}
        </span>
      </div>
      <div className={css.settingRow}>
        <span>{t('mobileSdkCustomPath')}<small>{t('mobileSdkPathHelp')}</small></span>
        {value !== undefined && <input type="text" aria-label={t('mobileSdkCustomPath')} value={value.androidSdkPath}
          onChange={(event) => { change({ androidSdkPath: event.currentTarget.value }) }} />}
      </div>
      {sdkState === 'ready' && sdk?.ios !== null && sdk?.ios !== undefined && <div className={css.settingRow} data-settings-anchor="mobile-ios">
        <span>{t('mobileSdkIos')}<small>{t(sdk.ios.simctlOk ? 'mobileSdkIosReady' : 'mobileSdkIosNotReady')}</small></span>
      </div>}
      <div className={css.settingRow} data-settings-anchor="mobile-device">
        <span>{t('mobileDefaultDevice')}<small>{t('mobileDefaultDeviceDescription')}</small></span>
        {value !== undefined && <select aria-label={t('mobileDefaultDevice')}
          value={value.defaultDeviceId} onChange={(event) => { change({ defaultDeviceId: event.currentTarget.value }) }}>
          <option value="">{t('mobileDefaultDeviceAuto')}</option>
          {selectedMissing && <option value={value.defaultDeviceId} disabled>{t('mobileSavedDeviceUnavailable')}</option>}
          {devices?.devices.map(device => <option key={device.id} value={device.id} disabled={!device.isAvailable}>
            {device.name}
          </option>)}
        </select>}
      </div>
      <div className={css.browserActions}>
        <button className={css.recheckButton} type="submit" disabled={draft === undefined}>{t(status === 'saving' ? 'preferencesSaving' : 'preferencesSave')}</button>
        <button className={css.recheckButton} type="button" disabled={draft === undefined}
          onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('preferencesDiscard')}</button>
        <button className={css.recheckButton} type="button" onClick={() => { void save(true) }}>{t('preferencesReset')}</button>
      </div>
    </fieldset>
    {!writable && <p role="status">{t('preferencesReadOnly')}</p>}
    {deviceState === 'error' && <p className={css.failure} role="alert">{t('mobileDevicesFailed')}</p>}
    {status === 'saved' && <p role="status">{t('mobilePreferencesSaved')}</p>}
    {status === 'error' && <p className={css.failure} role="alert">{t('preferencesFailed')}</p>}
  </form>
}
