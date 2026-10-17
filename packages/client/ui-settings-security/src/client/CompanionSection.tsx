/** Cinlan pairing settings backed by the local Host, including self-hosted multi-region relays. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toString as qrToString } from 'qrcode/lib/browser.js'
import { Switch, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdminState, HostSettings } from '@cinlan/mobile-relay/protocol'
import type { CompanionApi } from './companion-api.ts'
import { relativeLabel } from './paired-time.ts'
import css from './CompanionSection.module.css'

type CompanionProps = PropsLocale<'settings.cinlanCapabilities'> & {
  api?: CompanionApi
  onStateChange?: (state: AdminState) => void
}

function readVisible(): boolean {
  try { return localStorage.getItem('cinlan-companion:visible') !== 'false' }
  catch (_storageUnavailable) { return true }
}

/** Render the existing pairing layout using real Host settings and enrolled devices. */
export function CompanionSection({ t, api, onStateChange }: CompanionProps): ReactNode {
  const [visible, setVisible] = useState(readVisible)
  const [state, setState] = useState<AdminState>()
  const [settings, setSettings] = useState<HostSettings>({ name: '', mode: 'local', directorUrl: '', preferredRegion: '', address: '' })
  const settingsRef = useRef(settings)
  const confirmed = useRef(settings)
  const mounted = useRef(false)
  const saving = useRef(Promise.resolve())
  const revision = useRef(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [offer, setOffer] = useState<{ pairingUrl: string; expiresAt: number }>()
  const [qr, setQr] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [enlarged, setEnlarged] = useState(false)
  const [expired, setExpired] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState<string>()
  const [clock, setClock] = useState(() => Date.now())
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!api) return
    mounted.current = true
    const controller = new AbortController()
    let initialized = false
    const refresh = async (): Promise<void> => {
      try {
        const next = await api.state(controller.signal)
        if (controller.signal.aborted) return
        setState(next)
        onStateChange?.(next)
        if (!initialized) { initialized = true; confirmed.current = next.settings; settingsRef.current = next.settings; setSettings(next.settings) }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'mobile_request_failed') }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { mounted.current = false; controller.abort(); clearInterval(timer); revision.current++ }
  }, [api])
  useEffect(() => {
    if (!offer) return
    const expire = setTimeout(() => { setOffer(undefined); setQr(undefined); setExpired(true) }, Math.max(0, offer.expiresAt - Date.now()))
    const ticker = setInterval(() => { setClock(Date.now()) }, 30_000)
    return () => { clearTimeout(expire); clearInterval(ticker) }
  }, [offer])
  useEffect(() => () => { if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current) }, [])
  const change = (patch: Partial<HostSettings>): HostSettings => {
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next; setSettings(next)
    revision.current++; setOffer(undefined); setQr(undefined); setExpired(false); setEnlarged(false)
    return next
  }
  const save = (next = settingsRef.current): Promise<void> => {
    if (!api) return Promise.reject(new Error('mobile_api_unavailable'))
    const version = revision.current
    setError('')
    const task = saving.current.then(async () => {
      const value = await api.save(next)
      confirmed.current = value.settings
      if (!mounted.current) return
      setState(value)
      onStateChange?.(value)
      if (version === revision.current) { settingsRef.current = value.settings; setSettings(value.settings) }
    })
    saving.current = task.catch(reason => {
      if (!mounted.current) return
      setError(reason instanceof Error ? reason.message : 'mobile_request_failed')
      if (version === revision.current) { settingsRef.current = confirmed.current; setSettings(confirmed.current) }
    })
    return task
  }
  const generate = async (): Promise<void> => {
    if (!api || busy) return
    const generation = ++revision.current
    setBusy(true); setError(''); setOffer(undefined); setQr(undefined); setExpired(false); setEnlarged(false)
    try {
      await save()
      const next = await api.pair()
      const svg = await qrToString(next.pairingUrl, { type: 'svg', margin: 4, width: 280, errorCorrectionLevel: 'M' })
      const code = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      if (mounted.current && generation === revision.current) { setOffer(next); setQr(code); setCopied(false); setClock(Date.now()) }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'mobile_request_failed') }
    finally { if (mounted.current) setBusy(false) }
  }
  const revoke = async (deviceId: string): Promise<void> => {
    if (!api || busy) return
    setBusy(true); setError('')
    try {
      await api.revoke(deviceId)
      const next = await api.state()
      if (!mounted.current) return
      setState(next); onStateChange?.(next); setConfirmingRevoke(undefined)
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'mobile_request_failed') }
    finally { if (mounted.current) setBusy(false) }
  }
  const ready = api !== undefined && state !== undefined
  const remainingMinutes = offer === undefined ? 0 : Math.max(0, Math.ceil((offer.expiresAt - clock) / 60_000))
  return <section className={css.section} data-capability="companion">
    <div className={css.card}>
      <h2>{t('companionIntro')}</h2>
      <p className={css.helper}>{t('companionRelayNotice')}</p>
      <div className={css.visibilityRow} data-settings-anchor="companion-visibility">
        <span><strong>{t('companionWorkspaceVisible')}</strong><small>{t('companionWorkspaceVisibleHelp')}</small></span>
        <Switch checked={visible} label={t('companionWorkspaceVisible')} onChange={next => {
          setVisible(next)
          try { localStorage.setItem('cinlan-companion:visible', String(next)) } catch (_storageUnavailable) { /* Visibility still applies to this window. */ }
          window.dispatchEvent(new CustomEvent('cinlan-companion-visibility', { detail: next }))
        }} />
      </div>
    </div>

    <div className={css.card} data-settings-anchor="companion-host-name">
      <h2>{t('companionHostName')}</h2>
      <label className={css.field}>
        <span>{t('companionHostNameHelp')}</span>
        <input disabled={!ready} value={settings.name} onChange={event => { change({ name: event.currentTarget.value }) }} onBlur={() => { void save().catch(() => {}) }} aria-label={t('companionHostName')} />
      </label>
    </div>

    <div className={css.card} data-settings-anchor="companion-transport">
      <h2>{t('companionConnection')}</h2>
      <fieldset className={css.settingList} disabled={!ready}>
        {(['local', 'lan', 'relay'] as const).map(mode => <label className={css.settingLine} key={mode} data-selected={settings.mode === mode}>
          <span><strong>{t(mode === 'local' ? 'companionLocal' : mode === 'lan' ? 'companionLan' : 'companionRelay')}</strong><small>{t(mode === 'local' ? 'companionLocalHelp' : mode === 'lan' ? 'companionLanHelp' : 'companionRelayHelp')}</small></span>
          <input type="radio" name="companion-transport" checked={settings.mode === mode} onChange={() => { const next = change({ mode }); if (mode !== 'relay' || next.directorUrl) void save(next).catch(() => {}) }} />
        </label>)}
      </fieldset>
      {settings.mode === 'lan' && <label className={css.field}><span>{t('companionAddress')}</span><select disabled={!ready} value={settings.address} onChange={event => { void save(change({ address: event.currentTarget.value })).catch(() => {}) }}>
        <option value="">{t('companionAutomatic')}</option>{state?.addresses.map(address => <option value={address} key={address}>{address}</option>)}
      </select></label>}
      {settings.mode === 'relay' && <>
        <label className={css.field}><span>{t('companionHubUrl')}</span><input disabled={!ready} type="url" value={settings.directorUrl} onChange={event => { change({ directorUrl: event.currentTarget.value }) }} onBlur={() => { if (settingsRef.current.directorUrl) void save().catch(() => {}) }} /></label>
        <label className={css.field}><span>{t('companionRegion')}</span><select disabled={!ready} value={settings.preferredRegion} onChange={event => { void save(change({ preferredRegion: event.currentTarget.value })).catch(() => {}) }}>
          <option value="">{t('companionAutomatic')}</option>{state?.regions.map(region => <option key={region.id} value={region.id}>{region.name}</option>)}
        </select></label>
        <p className={css.relayStatus} role="status"><span className={state?.relayStatus === 'online' ? css.statusDotOnline : css.statusDot} aria-hidden="true" />{t(state?.relayStatus === 'online' ? 'companionConnected' : state?.relayStatus === 'connecting' ? 'companionConnecting' : 'companionOffline')}</p>
      </>}
    </div>

    <div className={css.card} data-settings-anchor="companion-pairing">
      <h2>{t('companionPairPhone')}</h2>
      <p className={css.helper}>{t('companionPairHelp')}</p>
      <button type="button" className={css.action} disabled={!ready || busy} onClick={() => { void generate() }}>{t('companionGenerateQr')}</button>
      {error && <p className={css.alert} role="alert" title={error}>{t('companionFailed')}</p>}
      {expired && <p className={css.alert} role="status">{t('companionOfferExpired')}</p>}
      {offer && <div className={css.pairingResult}>
        {qr && <div className={css.qrRow}>
          <img className={enlarged ? `${css.qr} ${css.qrLarge}` : css.qr} src={qr} alt={t('companionQrCode')} />
          <button type="button" className={css.actionQuiet} aria-pressed={enlarged} onClick={() => { setEnlarged(value => !value) }}>{t(enlarged ? 'companionQrShrink' : 'companionQrEnlarge')}</button>
        </div>}
        <p className={css.helper} role="status">{t('companionOfferExpiresIn', { minutes: remainingMinutes })}</p>
        <label className={css.field} htmlFor="cinlan-pairing-link" style={{ width: '100%' }}><span>{t('companionPairLink')}</span></label>
        <div className={css.pairLinkRow}>
          <textarea id="cinlan-pairing-link" readOnly value={offer.pairingUrl} aria-label={t('companionPairLink')} />
          <button type="button" className={css.actionQuiet} disabled={!navigator.clipboard} onClick={() => {
            void navigator.clipboard.writeText(offer.pairingUrl).then(() => {
              setCopied(true)
              if (copiedTimer.current !== undefined) clearTimeout(copiedTimer.current)
              copiedTimer.current = setTimeout(() => { setCopied(false) }, 2000)
            }, () => setError('clipboard_unavailable'))
          }}>{t(copied ? 'companionCopied' : 'companionCopyLink')}</button>
        </div>
      </div>}
    </div>

    <div className={css.card} data-settings-anchor="companion-devices">
      <h2>{t('companionPairedDevices')}</h2>
      {state?.devices.length ? state.devices.map(device => confirmingRevoke === device.id
        ? <div key={device.id} className={css.confirmRow}>
          <p className={css.helper}>{t('companionRevokeConfirm', { name: device.name })}</p>
          <div className={css.confirmActions}>
            <button type="button" className={css.actionQuiet} disabled={busy} onClick={() => { setConfirmingRevoke(undefined) }}>{t('companionRevokeCancel')}</button>
            <button type="button" className={css.danger} disabled={busy} onClick={() => { void revoke(device.id) }}>{t('companionRevokeConfirmAction')}</button>
          </div>
        </div>
        : <div key={device.id} className={css.visibilityRow}>
          <span>
            <strong>{device.name}</strong>
            <small>{t('companionDevicePairedAt', { time: relativeLabel(t, relativeTime(device.createdAt, Date.now())) })}</small>
          </span>
          <button type="button" className={css.actionQuiet} onClick={() => { setConfirmingRevoke(device.id) }}>{t('companionRemove')}</button>
        </div>) : <p className={css.helper}>{t('companionNoDevices')}</p>}
    </div>
  </section>
}
