/** Framework-bound mobile preference drafts and independent read-only device checks. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { MobileDeviceListSnapshot, MobileSdkSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import css from './CapabilitySection.module.css'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'

type Props = Pick<CapabilitySectionProps, 'useMobileSettings' | 'saveMobileSettings' | 'resetMobileSettings' | 'checkSdk' | 'listMobileDevices' | 't'>

/**
 * Edit preferences for SDK checks and device observation without granting control authority.
 * @param props - Renderer-bound settings, revision-fenced callbacks, and read-only checks.
 * @returns Native preference rows and explicit SDK/device results.
 */
export function MobilePreferences({
  useMobileSettings, saveMobileSettings, resetMobileSettings, checkSdk, listMobileDevices, t,
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
      else if (draft !== undefined) await saveMobileSettings(draft.value, draft.revision)
      if (mounted.current) { setDraft(undefined); setStatus('saved') }
    } catch (_preferenceWriteRejected) {
      if (mounted.current) setStatus('error')
    } finally { pending.current = false }
  }
  const unavailable = t(snapshot.status === 'loading' ? 'preferencesLoading' : 'preferencesUnavailable')
  const selectedMissing = value !== undefined && value.defaultDeviceId !== '' && !devices?.devices.some(device => device.id === value.defaultDeviceId)
  const checking = sdkState === 'loading' || deviceState === 'loading'
  return <div className={css.mobilePreferences}>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <p>{t('mobilePreferenceConsumers')}</p>
      {snapshot.status !== 'ready' && <p role="status">{unavailable}</p>}
      <fieldset disabled={!writable || status === 'saving'}>
        <label className={css.settingRow} data-settings-anchor="mobile-enabled">
          <span>{t('mobileEnable')}<small>{t('mobileEnableDescription')}</small></span>
          {value === undefined ? <span role="status">{unavailable}</span> : <Switch label={t('mobileEnable')}
            checked={value.enabled} disabled={!writable || status === 'saving'} onChange={(enabled) => { change({ enabled }) }} />}
        </label>
        <label className={css.settingRow} data-settings-anchor="mobile-sdk-path">
          <span>{t('mobileSdkCustomPath')}<small>{t('mobileSdkPathHelp')}</small></span>
          {value === undefined ? <span role="status">{unavailable}</span> : <span className={css.settingControl}>
            <input type="text" aria-label={t('mobileSdkCustomPath')} value={value.androidSdkPath}
              onChange={(event) => { change({ androidSdkPath: event.currentTarget.value }) }} />
            {value.androidSdkPath !== '' && <button type="button" className={css.recheckButton} onClick={() => { change({ androidSdkPath: '' }) }}>{t('mobileSdkClear')}</button>}
            {sdk?.android.sdkPath !== null && sdk?.android.sdkPath !== undefined && <button type="button" className={css.recheckButton}
              onClick={() => { change({ androidSdkPath: sdk.android.sdkPath ?? '' }) }}>{t('mobileSdkUseDetected')}</button>}
          </span>}
        </label>
        <label className={css.settingRow} data-settings-anchor="mobile-device">
          <span>{t('mobileDefaultDevice')}<small>{t('mobileDefaultDeviceDescription')}</small></span>
          {value === undefined ? <span role="status">{unavailable}</span> : <select aria-label={t('mobileDefaultDevice')}
            value={value.defaultDeviceId} onChange={(event) => { change({ defaultDeviceId: event.currentTarget.value }) }}>
            <option value="">{t('mobileDefaultDeviceAuto')}</option>
            {selectedMissing && <option value={value.defaultDeviceId} disabled>{t('mobileSavedDeviceUnavailable')}</option>}
            {devices?.devices.map(device => <option key={device.id} value={device.id} disabled={!device.isAvailable}>
              {device.name}
            </option>)}
          </select>}
        </label>
        <div className={css.browserActions}>
          <button className={css.recheckButton} type="submit" disabled={draft === undefined}>{t(status === 'saving' ? 'preferencesSaving' : 'preferencesSave')}</button>
          <button className={css.recheckButton} type="button" disabled={draft === undefined}
            onClick={() => { setDraft(undefined); setStatus('idle') }}>{t('preferencesDiscard')}</button>
          <button className={css.recheckButton} type="button" onClick={() => { void save(true) }}>{t('preferencesReset')}</button>
        </div>
      </fieldset>
      {!writable && <p role="status">{t('preferencesReadOnly')}</p>}
      {status === 'saved' && <p role="status">{t('mobilePreferencesSaved')}</p>}
      {status === 'error' && <p className={css.failure} role="alert">{t('preferencesFailed')}</p>}
    </form>
    <section className={css.agentSetup} data-settings-anchor="mobile-detection" aria-busy={checking}>
      <div className={css.availability}><div><h2>{t('mobileDetectTitle')}</h2><p>{t('mobileDetectDescription')}</p></div>
        <button type="button" className={css.recheckButton} disabled={checking} onClick={() => { setRequest(value => value + 1) }}>{t('computerRecheck')}</button>
      </div>
      <dl className={css.facts}>
        <div><dt>{t('mobileSdkAndroid')}</dt><dd>
          {sdkState === 'loading' ? t('preferencesLoading') : sdkState === 'error' ? <span className={css.failure} role="alert">{t('mobileSdkFailed')}</span>
            : sdk === undefined ? t('mobileNotChecked') : sdk.android.found ? sdk.android.sdkPath ?? t('mobileSdkFound') : t('mobileSdkAndroidNotFound')}
          {sdkState === 'ready' && sdk?.android.found === false && <a href="https://developer.android.com/studio" target="_blank" rel="noreferrer">{t('mobileSdkDownload')}</a>}
        </dd></div>
        {sdkState === 'ready' && sdk?.ios !== null && sdk?.ios !== undefined && <div><dt>{t('mobileSdkIos')}</dt><dd>{t(sdk.ios.simctlOk ? 'mobileSdkIosReady' : 'mobileSdkIosNotReady')}</dd></div>}
        <div><dt>{t('mobileDevicesTitle')}</dt><dd>
          {deviceState === 'loading' ? t('preferencesLoading') : deviceState === 'error' ? <span className={css.failure} role="alert">{t('mobileDevicesFailed')}</span>
            : devices === undefined ? t('mobileNotChecked') : !devices.available ? t('deviceProviderUnavailable')
              : devices.devices.length === 0 ? t('deviceNoDevices')
                : <ul>{devices.devices.map(device => <li key={device.id}>{device.name} — {t(device.isAvailable ? 'mobileDeviceAvailable' : 'mobileDeviceUnavailable')}</li>)}</ul>}
        </dd></div>
      </dl>
    </section>
  </div>
}
