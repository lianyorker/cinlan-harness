import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CapabilitySection.module.css'

type CompanionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.cinlanCapabilities'>

/** Desktop/Web pairing settings for the Orca Mobile companion.
 *
 * The relay protocol is not mounted in the current Web/Desktop profile, so the
 * page exposes the complete pairing workflow while reporting that limitation
 * explicitly instead of generating a QR code that cannot be consumed.
 */
export function CompanionSection({ t }: CompanionProps): ReactNode {
  const [hostName, setHostName] = useState(() => `DESKTOP-${Math.random().toString(36).slice(2, 8).toUpperCase()}`)
  const [transport, setTransport] = useState<'relay' | 'lan'>('relay')
  const [showLocal, setShowLocal] = useState(false)
  const [generated, setGenerated] = useState(false)
  return <section className={css.section} data-capability="companion">
    <div className={css.setupCard}>
      <section>
        <p>{t('companionIntro')}</p>
        <p>{t('companionRelayNotice')}</p>
      </section>
      <section data-settings-anchor="companion-host-name">
        <h2>{t('companionHostName')}</h2>
        <input value={hostName} onChange={event => setHostName(event.currentTarget.value)} aria-label={t('companionHostName')} />
        <small>{t('companionHostNameHelp')}</small>
      </section>
      <section data-settings-anchor="companion-transport">
        <h2>{t('companionConnection')}</h2>
        <fieldset className={css.settingList}>
          <label className={css.settingLine}>
            <span><strong>{t('companionRelay')}</strong><small>{t('companionRelayHelp')}</small></span>
            <input type="radio" name="companion-transport" checked={transport === 'relay'} onChange={() => setTransport('relay')} />
          </label>
          <label className={css.settingLine}>
            <span><strong>{t('companionLan')}</strong><small>{t('companionLanHelp')}</small></span>
            <input type="radio" name="companion-transport" checked={transport === 'lan'} onChange={() => setTransport('lan')} />
          </label>
        </fieldset>
        <p className={css.diagnostics}>{transport === 'relay' ? t('companionRelayEndpoint') : t('companionLanEndpoint')}</p>
      </section>
      <section data-settings-anchor="companion-pairing">
        <h2>{t('companionPairPhone')}</h2>
        <p>{t('companionPairHelp')}</p>
        {generated && <div className={css.console} role="status"><strong>{t('companionUnavailable')}</strong><span>{t('companionUnavailableHelp')}</span></div>}
        <div className={css.browserActions}>
          <button type="button" className={css.recheckButton} onClick={() => setGenerated(true)}>{t('companionGenerateQr')}</button>
          <button type="button" className={css.recheckButton} onClick={() => setShowLocal(value => !value)}>{t('companionLocalOptions')}</button>
        </div>
        {showLocal && <p className={css.diagnostics}>{t('companionLocalOptionsHelp')}</p>}
      </section>
      <section data-settings-anchor="companion-devices">
        <h2>{t('companionPairedDevices')}</h2>
        <p>{t('companionNoDevices')}</p>
        <p>{t('companionRevokeHelp')}</p>
      </section>
    </div>
  </section>
}
