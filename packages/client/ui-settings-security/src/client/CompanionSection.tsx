import type { ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CompanionSection.module.css'

type CompanionProps = PropsLocale<'settings.cinlanCapabilities'>

/** Desktop/Web pairing settings for the Orca Mobile companion.
 *
 * The relay protocol is not mounted in the current Web/Desktop profile, so the
 * Controls stay disabled until an authenticated Host pairing API is available.
 */
export function CompanionSection({ t }: CompanionProps): ReactNode {
  return <section className={css.section} data-capability="companion">
    <div className={css.setupCard}>
      <section>
        <p>{t('companionIntro')}</p>
        <p>{t('companionRelayNotice')}</p>
      </section>
      <section data-settings-anchor="companion-host-name">
        <h2>{t('companionHostName')}</h2>
        <input value="" disabled placeholder={t('companionUnavailable')} aria-label={t('companionHostName')} />
        <small>{t('companionHostNameHelp')}</small>
      </section>
      <section data-settings-anchor="companion-transport">
        <h2>{t('companionConnection')}</h2>
        <fieldset className={css.settingList} disabled>
          <label className={css.settingLine}>
            <span><strong>{t('companionRelay')}</strong><small>{t('companionRelayHelp')}</small></span>
            <input type="radio" name="companion-transport" checked={false} readOnly />
          </label>
          <label className={css.settingLine}>
            <span><strong>{t('companionLan')}</strong><small>{t('companionLanHelp')}</small></span>
            <input type="radio" name="companion-transport" checked={false} readOnly />
          </label>
        </fieldset>
        <p className={css.diagnostics}>{t('companionUnavailable')}</p>
      </section>
      <section data-settings-anchor="companion-pairing">
        <h2>{t('companionPairPhone')}</h2>
        <p>{t('companionPairHelp')}</p>
        <p role="status">{t('companionUnavailableHelp')}</p>
        <div className={css.browserActions}>
          <button type="button" className={css.recheckButton} disabled>{t('companionGenerateQr')}</button>
        </div>
      </section>
      <section data-settings-anchor="companion-devices">
        <h2>{t('companionPairedDevices')}</h2>
        <p>{t('companionDevicesUnavailable')}</p>
      </section>
    </div>
  </section>
}
