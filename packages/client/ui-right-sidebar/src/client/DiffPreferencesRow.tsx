/** Settings row for editor and diff review preferences registered in settings.general.item. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { useDiffPreferences } from './diff-preferences-store.ts'
import css from './SidebarContributors.module.css'

/**
 * Render editor and diff review preferences into General Settings.
 * @param props - Slot runtime and locale bundle.
 * @returns React component tree.
 */
export function DiffPreferencesRow({ t }: PropsRuntime<'settings.general.item'> & PropsLocale<'rightSidebarContributors'>) {
  const [prefs, setPrefs] = useDiffPreferences()

  return (
    <div className={css.preferencesCard} data-testid="editor-diff-preferences-row">
      <div className={css.preferencesHeader}>
        <div className={css.preferencesTitle}>{t('review.diffPreferencesTitle')}</div>
        <div className={css.preferencesDesc}>{t('review.diffPreferencesDesc')}</div>
      </div>
      <div className={css.preferencesControls}>
        <div className={css.preferenceRow}>
          <span>{t('review.viewMode')}</span>
          <div className={css.diffToolbarGroup}>
            <button
              type="button"
              className={`${css.diffToolbarBtn} ${prefs.diffViewMode === 'inline' ? css.diffToolbarBtnActive : ''}`}
              onClick={() => { setPrefs({ diffViewMode: 'inline' }) }}
            >
              {t('review.viewInline')}
            </button>
            <button
              type="button"
              className={`${css.diffToolbarBtn} ${prefs.diffViewMode === 'side-by-side' ? css.diffToolbarBtnActive : ''}`}
              onClick={() => { setPrefs({ diffViewMode: 'side-by-side' }) }}
            >
              {t('review.viewSideBySide')}
            </button>
          </div>
        </div>
        <div className={css.preferenceRow}>
          <span>{t('review.wordWrap')}</span>
          <Switch
            checked={prefs.diffWordWrap}
            label={t('review.wordWrap')}
            onChange={checked => { setPrefs({ diffWordWrap: checked }) }}
          />
        </div>
        <div className={css.preferenceRow}>
          <span>{t('review.showWhitespace')}</span>
          <Switch
            checked={prefs.showWhitespace}
            label={t('review.showWhitespace')}
            onChange={checked => { setPrefs({ showWhitespace: checked }) }}
          />
        </div>
        <div className={css.preferenceRow}>
          <div>
            <div>{t('review.autoSaveTitle')}</div>
            <div className={css.muted}>{t('review.autoSaveDesc')}</div>
          </div>
          <span className={`${css.badge} ${css.badgeManaged}`}>{t('review.autoSaveBadge')}</span>
        </div>
      </div>
    </div>
  )
}
