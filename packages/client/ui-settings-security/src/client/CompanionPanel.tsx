/** Mobile-companion entry inside the shared Desktop/Web workbench. */
import { useEffect, useState, type ReactNode } from 'react'
import { CinlanLogo, IconChevronLeftOutline14, IconChevronRightOutline14, IconLinkOutline16, relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { AdminState } from '@cinlan/mobile-relay/protocol'
import { CompanionSection } from './CompanionSection.tsx'
import css from './CompanionPanel.module.css'
import type { CompanionApi } from './companion-api.ts'
import { relativeLabel } from './paired-time.ts'

/** Render the mobile landing page and in-app pairing view.
 * @param props - Main panel runtime and localized companion copy.
 * @returns Desktop/Web companion content without a separate mobile-app launcher.
 */
export function CompanionPanel({ t, api }: PropsRuntime<'main'> & PropsLocale<'settings.cinlanCapabilities'> & { api?: CompanionApi }): ReactNode {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [platform, setPlatform] = useState<'ios' | 'android'>('ios')
  const [state, setState] = useState<AdminState>()
  const [now, setNow] = useState(() => Date.now())
  const deviceCount = state?.devices.length ?? 0
  // The result step dates each paired record; a phone re-pairs several times,
  // so repeating rows stay tellable apart by when each one was paired.
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { clearInterval(timer) }
  }, [])
  useEffect(() => {
    // A paired phone is the reason to show the result step; an explicit
    // navigation back to step 2 must survive the next settings poll.
    if (deviceCount > 0) setStep(current => current === 1 ? 3 : current)
  }, [deviceCount])
  const steps: readonly [1 | 2 | 3, string][] = [
    [1, t('companionStepGetApp')],
    [2, t('companionStepPair')],
    [3, t('companionStepDone')],
  ]
  return <main className={css.page}>
    <div className={css.content}>
      <div className={css.header}>
        <CinlanLogo size={36} />
        <div className={css.headerText}>
          <p className={css.eyebrow}><strong>{t('companionBrand')}</strong>{t('companionPlatforms')}</p>
        </div>
      </div>
      <nav className={css.steps} aria-label={t('companionSteps')}>
        {steps.map(([item, label]) => <button
          key={item}
          type="button"
          className={step === item ? css.stepActive : css.step}
          aria-current={step === item ? 'step' : undefined}
          onClick={() => { setStep(item) }}
          disabled={item === 3 && deviceCount === 0}
        >
          <span>{item}</span>{label}
        </button>)}
      </nav>

      {step === 1 && <section className={css.stepPage}>
        <p className={css.stepCount}>{t('companionStepCount1')}</p>
        <h1 className={css.title}>{t('companionGetAppTitle')}</h1>
        <p className={css.copy}>{t('companionGetAppDescription')}</p>
        <div className={css.card}>
          <div className={css.platformTabs} role="tablist" aria-label={t('companionPlatforms')}>
            {(['ios', 'android'] as const).map(value => <button
              key={value}
              type="button"
              role="tab"
              aria-selected={platform === value}
              className={platform === value ? css.platformActive : css.platform}
              onClick={() => { setPlatform(value) }}
            >{value === 'ios' ? t('companionPlatformIos') : t('companionPlatformAndroid')}</button>)}
          </div>
          <p className={css.notice}>{t(platform === 'ios' ? 'companionIosUnavailable' : 'companionAndroidUnavailable')}</p>
        </div>
        <div className={css.actions}>
          <button type="button" className={css.primary} onClick={() => { setStep(2) }}>
            <IconLinkOutline16 />{t('companionContinue')}<IconChevronRightOutline14 />
          </button>
        </div>
      </section>}

      {step === 2 && <section className={css.stepPage}>
        <button type="button" className={css.back} onClick={() => { setStep(1) }}><IconChevronLeftOutline14 />{t('companionBack')}</button>
        <p className={css.stepCount}>{t('companionStepCount2')}</p>
        {/* The pairing card below carries its own "配对手机" heading and help
            copy; repeating them here would print the same two lines twice. */}
        <CompanionSection t={t} onStateChange={setState} {...api === undefined ? {} : { api }} />
      </section>}

      {step === 3 && <section className={css.stepPage}>
        <p className={css.stepCount}>{t('companionStepCount3')}</p>
        <h1 className={css.title}>{t('companionPairedTitle')}</h1>
        <p className={css.copy}>{t('companionPairedDescription')}</p>
        <div className={css.card}>
          <h2>{t('companionPairedDevices')}</h2>
          {deviceCount === 0
            ? <p className={css.emptyRow}>{t('companionNoDevices')}</p>
            : <ul className={css.rowList}>
              {state?.devices.map(device => <li className={css.row} key={device.id}>
                <span className={css.rowMain}>
                  <span className={css.deviceDot} aria-hidden="true" />
                  <span className={css.rowText}>
                    <strong>{device.name}</strong>
                    <small>{t('companionDevicePairedAt', { time: relativeLabel(t, relativeTime(device.createdAt, now)) })}</small>
                  </span>
                </span>
              </li>)}
            </ul>}
        </div>
        <div className={css.actions}>
          <button type="button" className={css.secondary} onClick={() => { setStep(2) }}>
            <IconLinkOutline16 />{t('companionPairAnother')}
          </button>
          <button type="button" className={css.primary} onClick={() => { setStep(2) }}>{t('companionDone')}</button>
        </div>
      </section>}
    </div>
  </main>
}
