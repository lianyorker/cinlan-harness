/** Floating Workspace settings section: enable toggle, terminal directory, toggle button position, float default size. */
import { useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { FloatingWorkspaceSettings, ToggleButtonPosition } from '../types.ts'
import { FLOATING_WORKSPACE_NAMESPACE } from '../types.ts'
import { en, zh, type FloatingWorkspaceSettingsKey } from './locales.ts'
import css from './FloatingWorkspaceSection.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.floatingWorkspace': FloatingWorkspaceSettingsKey
  }
}

/** Injected face: the settings scope for floating workspace preferences. */
export interface FloatingWorkspaceSectionInjected {
  floatingWorkspace: SettingsScope<FloatingWorkspaceSettings>
}

export type FloatingWorkspaceSectionProps =
  & PropsRuntime<'settings.section'>
  & PropsLocale<'settings.floatingWorkspace'>
  & InjectFace<FloatingWorkspaceSectionInjected>

const NS = 'settings.floatingWorkspace'

export const inject = ['slots', 'locale', 'settingsScope']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-floating-workspace: dictionaries')
  const t = ctx.locale.bind(NS)
  const floatingWorkspace = ctx.settingsScope.bind<FloatingWorkspaceSettings>({ namespace: FLOATING_WORKSPACE_NAMESPACE })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'floating-workspace',
    order: 80,
    label: () => t('navLabel'),
    locale: NS,
    inject: (): FloatingWorkspaceSectionInjected => ({ floatingWorkspace }),
  }, FloatingWorkspaceSection))
}

/** Render the Floating Workspace settings page. */
export function FloatingWorkspaceSection({
  floatingWorkspace, t,
}: FloatingWorkspaceSectionProps): ReactNode {
  const snapshot = floatingWorkspace.getSnapshot()
  const [, forceRender] = useState(0)
  useEffect(() => floatingWorkspace.subscribe(() => forceRender(n => n + 1)), [floatingWorkspace])

  if (snapshot.status !== 'ready') {
    return <section className={css.section} data-floating-workspace-section>
      <div className={css.heading}>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </div>
      <p className={css.message}>{snapshot.status === 'unavailable' ? t('error') : t('loading')}</p>
    </section>
  }

  const value = snapshot.value ?? { enabled: false, terminalDirectory: '', toggleButtonPosition: 'header' as ToggleButtonPosition, floatDefaultWidth: 400, floatDefaultHeight: 300 }
  const writable = snapshot.writable

  return <section className={css.section} data-floating-workspace-section>
    <div className={css.heading}>
      <h2>{t('title')}</h2>
      <p>{t('description')}</p>
    </div>
    <div className={css.card}>
      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.rowTitle}>{t('enable')}</span>
          <span className={css.rowDesc}>{t('enableDescription')}</span>
        </span>
        <span className={css.control}>
          <label className={css.switch}>
            <input
              type="checkbox"
              className={css.switchInput}
              aria-label={t('enable')}
              checked={value.enabled}
              disabled={!writable}
              onChange={(e) => { void floatingWorkspace.set('enabled', e.currentTarget.checked) }}
            />
            <span className={css.switchTrack}><span className={css.switchThumb} /></span>
          </label>
        </span>
      </div>

      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.rowTitle}>{t('terminalDirectory')}</span>
          <span className={css.rowDesc}>{t('terminalDirectoryDescription')}</span>
        </span>
        <span className={css.control}>
          <input
            type="text"
            className={css.textInput}
            aria-label={t('terminalDirectory')}
            value={value.terminalDirectory}
            placeholder={t('terminalDirectoryPlaceholder')}
            disabled={!writable}
            onChange={(e) => { void floatingWorkspace.set('terminalDirectory', e.currentTarget.value) }}
          />
        </span>
      </div>

      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.rowTitle}>{t('toggleButtonPosition')}</span>
          <span className={css.rowDesc}>{t('toggleButtonPositionDescription')}</span>
        </span>
        <span className={css.control}>
          <select
            className={css.select}
            aria-label={t('toggleButtonPosition')}
            value={value.toggleButtonPosition}
            disabled={!writable}
            onChange={(e) => { void floatingWorkspace.set('toggleButtonPosition', e.currentTarget.value as ToggleButtonPosition) }}
          >
            <option value="header">{t('toggleButtonPositionHeader')}</option>
            <option value="sidebar">{t('toggleButtonPositionSidebar')}</option>
            <option value="floating">{t('toggleButtonPositionFloating')}</option>
          </select>
        </span>
      </div>

      <div className={css.row}>
        <span className={css.rowText}>
          <span className={css.rowTitle}>{t('floatDefaultSize')}</span>
          <span className={css.rowDesc}>{t('floatDefaultSizeDescription')}</span>
        </span>
        <span className={css.control}>
          <div className={css.sizeRow}>
            <label className={css.sizeLabel}>{t('floatDefaultWidth')}</label>
            <input
              type="number"
              className={css.numberInput}
              aria-label={t('floatDefaultWidth')}
              value={value.floatDefaultWidth}
              min={200}
              max={800}
              step={10}
              disabled={!writable}
              onChange={(e) => { void floatingWorkspace.set('floatDefaultWidth', Number(e.currentTarget.value) || 400) }}
            />
            <span className={css.sizeSuffix}>px</span>
            <label className={css.sizeLabel}>{t('floatDefaultHeight')}</label>
            <input
              type="number"
              className={css.numberInput}
              aria-label={t('floatDefaultHeight')}
              value={value.floatDefaultHeight}
              min={150}
              max={600}
              step={10}
              disabled={!writable}
              onChange={(e) => { void floatingWorkspace.set('floatDefaultHeight', Number(e.currentTarget.value) || 300) }}
            />
            <span className={css.sizeSuffix}>px</span>
          </div>
        </span>
      </div>
    </div>
  </section>
}
