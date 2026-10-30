/** Width controls over the frame-owned, current-window layout store. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createLayoutStore } from './stores.ts'
import { clampWidth, RIGHTBAR_DEFAULT_RATIO, RIGHTBAR_MAX_RATIO, RIGHTBAR_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from './columns.ts'
import css from './LayoutSettings.module.css'

type LayoutSettingsProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.layout'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

/**
 * Render live widths without persisting preferences or changing panel selection.
 * @param props - localized copy and the same store instance used by AppFrame.
 * @returns accessible range controls and a geometry-only reset action.
 */
export function LayoutSettings({ t, useStore, actions }: LayoutSettingsProps): ReactNode {
  const layout = useStore(state => state.layoutInfo)
  const rightMax = Math.max(RIGHTBAR_MIN, Math.floor(layout.viewportWidth * RIGHTBAR_MAX_RATIO))
  const rightWidth = clampWidth(
    layout.rightbar ?? Math.max(RIGHTBAR_MIN, Math.round(layout.viewportWidth * RIGHTBAR_DEFAULT_RATIO)), RIGHTBAR_MIN, rightMax,
  )
  const controls = [
    { id: 'sidebar', title: t('sidebar'), description: t('sidebarDescription'), min: SIDEBAR_MIN, max: SIDEBAR_MAX, value: layout.sidebar || SIDEBAR_DEFAULT, change: actions.setSidebar },
    { id: 'rightbar', title: t('rightbar'), description: t('rightbarDescription'), min: RIGHTBAR_MIN, max: rightMax, value: rightWidth, change: actions.setRightbar },
  ]
  return <section className={css.section} aria-label={t('nav')}>
    <p className={css.notice}>{t('scope')}</p>
    {controls.map(control => <div className={css.row} key={control.id} data-settings-anchor={'layout-' + control.id}>
      <div className={css.copy}>
        <label className={css.title} htmlFor={'layout-' + control.id}>{control.title}</label>
        <p className={css.description} id={'layout-' + control.id + '-description'}>{control.description}</p>
      </div>
      <div className={css.control}>
        <input id={'layout-' + control.id} type="range" min={control.min} max={control.max} step={1}
          value={control.value} aria-describedby={'layout-' + control.id + '-description'}
          aria-valuetext={t('pixels', { value: control.value })}
          onChange={(event) => { control.change(event.currentTarget.valueAsNumber) }} />
        <output htmlFor={'layout-' + control.id}>{t('pixels', { value: control.value })}</output>
      </div>
    </div>)}
    <p className={css.notice}>{t('responsive')}</p>
    <div className={css.row} data-settings-anchor="layout-reset">
      <p className={css.description}>{t('resetDescription')}</p>
      <Button variant="outline" onClick={() => { actions.resetWidths() }}>{t('reset')}</Button>
    </div>
  </section>
}
