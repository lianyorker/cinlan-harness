/** Floating Workspace settings card backed by accepted preferences. */
import { useId, type ReactNode } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { FloatingActions, FloatingSnapshot } from './contract.ts'
import type { ToggleButtonPosition } from '../types.ts'
import css from './FloatingWorkspaceSection.module.css'

/** Private runtime facts and callbacks; no settings service reaches the component. */
export interface FloatingWorkspaceSectionInjected {
  /** The renderer binds the stable source as useFloating. */
  hooks: { floating: ObservableSnapshot<FloatingSnapshot> }
  /** Persist a schema-valid preference; the source echoes accepted writes. */
  set: FloatingActions['set']
}

/** Framework-derived owner, locale and private-source shares for this section. */
export type FloatingWorkspaceSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.floatingWorkspace'> & InjectFace<FloatingWorkspaceSectionInjected>

const positions: readonly ToggleButtonPosition[] = ['header', 'floating']

/**
 * Render accepted preferences without inventing defaults.
 * @param props - framework locale/source hooks and preference callbacks.
 * @returns a page heading and one settings card.
 */
export function FloatingWorkspaceSection({ useFloating, set, t }: FloatingWorkspaceSectionProps): ReactNode {
  const snapshot = useFloating(value => value)
  const { settings } = snapshot
  const value = settings.status === 'ready' ? settings.value : undefined
  const locked = !settings.writable || snapshot.writing
  const positionName = useId()
  return <section className={css.section} data-floating-workspace-section>
    <header className={css.pageHeading}>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
    </header>
    {settings.status === 'loading' && <p className={css.message} role="status">{t('loading')}</p>}
    {settings.status !== 'loading' && value === undefined && <p className={css.error} role="status">{t('error')}</p>}
    {snapshot.writeFailed && <p className={css.error} role="alert">{t('writeFailed')}</p>}
    {snapshot.writing && <p className={css.message} role="status">{t('saving')}</p>}
    {value !== undefined && <>
      {!settings.writable && <p className={css.message}>{t('readOnly')}</p>}
      <div className={css.card}>
        <div className={css.row} data-settings-anchor="floating-enabled">
          <div className={css.rowText}>
            <span className={css.rowTitle}>{t('enable')}</span>
            <p className={css.rowDesc}>{t('enableDescription')}</p>
          </div>
          <Switch checked={value.enabled} disabled={locked} label={t('enable')}
            onChange={(next) => { void set('enabled', next) }} />
        </div>
        <div className={css.row} data-settings-anchor="floating-position">
          <div className={css.rowText}>
            <span className={css.rowTitle} id={positionName}>{t('toggleButtonPosition')}</span>
            <p className={css.rowDesc} id={positionName + '-help'}>{t('toggleButtonPositionDescription')}</p>
          </div>
          <fieldset className={css.segmented} aria-labelledby={positionName} aria-describedby={positionName + '-help'}>
            {positions.map(position => <label className={css.segment} key={position}>
              <input type="radio" name={positionName} value={position}
                checked={value.toggleButtonPosition === position} disabled={locked || !value.enabled}
                onChange={() => { void set('toggleButtonPosition', position) }} />
              <span>{t(position === 'header' ? 'toggleButtonPositionHeader' : 'toggleButtonPositionFloating')}</span>
            </label>)}
          </fieldset>
        </div>
      </div>
    </>}
  </section>
}
