/** Mobile-companion entry inside the shared Desktop/Web workbench. */
import { useState, type ReactNode } from 'react'
import { CinlanLogo, IconChevronLeftOutline14, IconChevronRightOutline14, IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { CompanionSection } from './CompanionSection.tsx'
import css from './CompanionPanel.module.css'

/** Render the mobile landing page and in-app pairing view.
 * @param props - Main panel runtime and localized companion copy.
 * @returns Desktop/Web companion content without a separate mobile-app launcher.
 */
export function CompanionPanel({ t }: PropsRuntime<'main'> & PropsLocale<'settings.cinlanCapabilities'>): ReactNode {
  const [pairing, setPairing] = useState(false)
  return <main className={css.page}>
    <div className={css.content}>
      {pairing ? <>
        <button type="button" className={css.back} onClick={() => setPairing(false)}><IconChevronLeftOutline14 />{t('companionBack')}</button>
        <h1>{t('companionPairPhone')}</h1>
        <CompanionSection t={t} />
      </> : <>
        <CinlanLogo size={48} />
        <p className={css.eyebrow}>{t('companionBrand')}</p>
        <h1>{t('companionLandingTitle')}</h1>
        <p className={css.copy}>{t('companionLandingDescription')}</p>
        <p className={css.platforms}>{t('companionPlatforms')}</p>
        <button type="button" className={css.primary} onClick={() => setPairing(true)}><IconLinkOutline16 />{t('companionStartPairing')}<IconChevronRightOutline14 /></button>
        <p className={css.status}>{t('companionUnavailable')}</p>
      </>}
    </div>
  </main>
}
