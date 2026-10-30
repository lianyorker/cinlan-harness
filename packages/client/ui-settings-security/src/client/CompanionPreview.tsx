/** Automatic local walkthrough; it has no Host, Session, or input capability. */
import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './CompanionPanel.module.css'

const SCREENS = ['home', 'sessions', 'chat'] as const

/**
 * Animate illustrative mobile screens without accepting user input.
 * @param props - Locale-owned example copy.
 * @returns A noninteractive phone demonstration, isolated from real pairing.
 */
export function CompanionPreview({ t }: PropsLocale<'settings.cinlanCapabilities'>): ReactNode {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = () => {
      clearInterval(timer)
      if (motion?.matches) setStep(0)
      else timer = setInterval(() => { setStep(value => (value + 1) % SCREENS.length) }, 3200)
    }
    sync()
    motion?.addEventListener('change', sync)
    return () => { clearInterval(timer); motion?.removeEventListener('change', sync) }
  }, [])
  const screen = SCREENS[step]
  return <div className={css.device}>
    <div className={css.phone} role="img" aria-label={t('companionPreviewNotice')} data-companion-demo={screen}>
      <header className={css.phoneHeader}>
        <span className={css.phoneBrand}>Cinlan</span>
        <span className={css.previewBadge}>{t('companionPreviewDemo')}</span>
      </header>
      <div className={css.previewNav} aria-hidden="true">
        <span data-active={screen === 'home'}>{t('companionPreviewHome')}</span>
        <span data-active={screen === 'sessions'}>{t('companionPreviewSessions')}</span>
        <span data-active={screen === 'chat'}>{t('companionPreviewChat')}</span>
      </div>
      <div className={css.phoneContent} key={screen} aria-hidden="true">
        {screen === 'home' && <>
          <h3>{t('companionPreviewHomeTitle')}</h3>
          <div className={css.hostRow}><span>{t('companionPreviewHost')}</span><strong>{t('companionPreviewOnline')}</strong></div>
          <h4>{t('companionPreviewRecent')}</h4>
          <div className={css.previewItem} data-demo-target><span>{t('companionPreviewSessionOne')}</span><small>{t('companionPreviewOpenSessions')}</small></div>
        </>}
        {screen === 'sessions' && <>
          <h3>{t('companionPreviewSessionsTitle')}</h3>
          <div className={css.previewItem} data-demo-target><span>{t('companionPreviewSessionOne')}</span><small>{t('companionPreviewOpenChat')}</small></div>
          <div className={css.previewItem}><span>{t('companionPreviewSessionTwo')}</span><small>{t('companionPreviewOpenChat')}</small></div>
        </>}
        {screen === 'chat' && <>
          <h3>{t('companionPreviewSessionOne')}</h3>
          <div className={css.bubble}>{t('companionPreviewUserMessage')}</div>
          <div className={css.bubbleAssistant}>{t('companionPreviewAssistantMessage')}</div>
          <span className={css.previewSend} data-demo-target>{t('companionPreviewBackHome')}</span>
        </>}
      </div>
      <footer className={css.phoneFooter}>{t('companionPreviewNotice')}</footer>
    </div>
  </div>
}
