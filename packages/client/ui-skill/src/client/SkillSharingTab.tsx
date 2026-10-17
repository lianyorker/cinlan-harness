import type { ReactNode } from 'react'
import { Switch, Tag, IconWarningOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillSharingTab.module.css'

export type SkillSharingTabProps = PropsLocale<'skill'>

/**
 * Skill sharing and review tab under Settings -> Plugins.
 * Reflects private/self-hosted deployment reality: cloud unlisted link sharing
 * is marked unavailable with an explicit explanation; agent automated publishing
 * is disabled; offline archive (.tar.gz) guidelines are provided.
 */
export function SkillSharingTab({ t }: SkillSharingTabProps): ReactNode {
  return (
    <div className={css.tabContainer} data-testid="skill-sharing-tab">
      <header className={css.header}>
        <h2 className={css.title}>{t('sharing.title')}</h2>
        <p className={css.subtitle}>{t('sharing.subtitle')}</p>
      </header>

      <section className={`${css.banner} ${css.bannerWarning}`} role="alert" aria-label={t('sharing.cloudUnavailableTitle')}>
        <div className={css.bannerTitle}>
          <IconWarningOutlineRegular size={16} />
          <span>{t('sharing.cloudUnavailableTitle')}</span>
          <Tag tone="warning">{t('sharing.agentPublishDisabledReason')}</Tag>
        </div>
        <p className={css.bannerDesc}>{t('sharing.cloudUnavailableDescription')}</p>
      </section>

      <section className={css.section}>
        <div className={css.switchRow}>
          <div className={css.switchMeta}>
            <span className={css.switchLabel}>{t('sharing.agentPublishTitle')}</span>
            <p className={css.switchHelp}>{t('sharing.agentPublishDescription')}</p>
          </div>
          <Switch
            checked={false}
            onChange={() => {}}
            label={t('sharing.agentPublishTitle')}
            disabled={true}
            title={t('sharing.agentPublishDisabledReason')}
          />
        </div>
      </section>

      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('sharing.offlineTitle')}</h3>
        <p className={css.sectionDesc}>{t('sharing.offlineDescription')}</p>

        <ol className={css.stepsList}>
          <li className={css.stepItem}>
            <span className={css.stepNumber}>1</span>
            <div className={css.stepBody}>
              <span className={css.stepTitle}>{t('sharing.step1Title')}</span>
              <p className={css.stepDesc}>{t('sharing.step1Desc')}</p>
            </div>
          </li>
          <li className={css.stepItem}>
            <span className={css.stepNumber}>2</span>
            <div className={css.stepBody}>
              <span className={css.stepTitle}>{t('sharing.step2Title')}</span>
              <p className={css.stepDesc}>{t('sharing.step2Desc')}</p>
            </div>
          </li>
          <li className={css.stepItem}>
            <span className={css.stepNumber}>3</span>
            <div className={css.stepBody}>
              <span className={css.stepTitle}>{t('sharing.step3Title')}</span>
              <p className={css.stepDesc}>{t('sharing.step3Desc')}</p>
            </div>
          </li>
        </ol>
      </section>
    </div>
  )
}
