/** Static Settings panel describing the Browser Element Capture workflow. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import css from './BrowserElementCaptureSection.module.css'

/** Props assembled by the Settings section slot. */
export type BrowserElementCaptureSectionProps = PropsRuntime<'settings.section'> & PropsLocale<typeof NS>

/**
 * Render the model-tool workflow and its permission separation.
 * @param props - Settings owner and localized copy.
 * @returns the Browser Element Capture confirmation panel.
 */
export function BrowserElementCaptureSection({ t }: BrowserElementCaptureSectionProps): ReactNode {
  return <section className={css.section} data-browser-element-capture="" aria-labelledby="browser-element-capture-title">
    <header className={css.heading}>
      <h2 id="browser-element-capture-title">{t('title')}</h2>
      <p>{t('description')}</p>
    </header>
    <ol className={css.steps}>
      <li>{t('stepOne')}</li>
      <li>{t('stepTwo')}</li>
      <li>{t('stepThree')}</li>
    </ol>
    <section className={css.safety} aria-labelledby="browser-element-capture-safety-title">
      <h3 id="browser-element-capture-safety-title">{t('safetyTitle')}</h3>
      <p>{t('safetyBody')}</p>
    </section>
    <p className={css.notice}>{t('providerFact')}</p>
  </section>
}
