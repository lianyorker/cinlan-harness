/** Settings-sized plugin lifecycle controls and feature-owned configuration slots. */

import { useEffect, useState, type ReactNode } from 'react'
import { Button, Input, Modal, StateDot, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { rowConfigKey } from './config-ledger.ts'
import { rowKey, type PackageRow, type PluginManagerFace } from './manager-store.ts'
import { managementText, noticeText, packageText } from './presentation.ts'
import { InstallDialog } from './InstallDialog.tsx'
import type { PluginManagerLocaleKey } from './locales.ts'
import type {} from './slot-contract.ts'
import css from './PluginManagerTab.module.css'

/** Props supplied by the existing Plugins tab renderer. */
export type PluginManagerTabProps = PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'pluginManager'>
  & PropsRenderSlots<'plugins.item' | 'plugins.bundle.config' | 'plugins.row.config'>
  & InjectFace<PluginManagerFace>

const PHASE_KEYS = {
  pending: 'rowPhasePending', loading: 'rowPhaseLoading', active: 'rowPhaseActive',
  failed: 'rowPhaseFailed', unloading: 'rowPhaseUnloading',
} satisfies Record<NonNullable<PackageRow['phase']>, PluginManagerLocaleKey>

/**
 * Render manager state without changing the Settings shell or document save action.
 * @param props - slot props, localized copy, configuration renderers, and manager callbacks.
 * @returns the management tab and its confirmations.
 */
export function PluginManagerTab(props: PluginManagerTabProps): ReactNode {
  const { t, renderSlot } = props
  const state = props.usePluginManager(value => value)
  const ledger = props.useConfigLedger(value => value)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => { props.ensure() }, [props.ensure])
  const ready = state.status === 'ready'
  const desktopPackages = state.packageManagement === 'desktop'
  const loading = state.status === 'idle' || state.status === 'loading'
  const packages = state.packages.filter(pkg => [pkg.name, pkg.description ?? ''].join(' ').toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className={css.section} data-settings-anchor="plugins-management" aria-busy={loading}>
      <div className={css.toolbar}>
        <p className={css.hint}>{t('intro')}</p>
        <div className={css.actions}>
          <Button className={css.control} size="sm" disabled={loading} onClick={props.refresh}>{t('refresh')}</Button>
          {ready || desktopPackages ? <Button className={css.control} size="sm" onClick={props.openInstall}>{t('addPlugin')}</Button> : null}
        </div>
      </div>
      {desktopPackages ? <p className={css.hint}>{t('desktopPackages')}</p> : null}
      {loading ? <p role="status" className={css.hint}>{t('loading')}</p> : null}
      {state.status === 'unavailable' ? <p role="status" className={css.hint}>{t('unavailable')}</p> : null}
      {state.status === 'error' ? <p role="alert" className={css.failure}>{t('error')}</p> : null}
      {state.notice === null ? null : (
        <div className={css.notice} role={state.notice.kind === 'failed' ? 'alert' : 'status'}>
          <span>{noticeText(state.notice, t)}</span>
          <Button className={css.control} size="sm" onClick={props.dismissNotice}>{t('close')}</Button>
        </div>
      )}
      {ready || state.packages.length > 0 ? (
        <>
          <Input className={css.input ?? ''} type="search" value={query} aria-label={t('partsFilter')}
            placeholder={t('partsFilter')} onChange={(event) => { setQuery(event.currentTarget.value) }} />
          {packages.length === 0 ? <p className={css.hint}>{t(state.packages.length === 0 ? 'empty' : 'partsFilterEmpty')}</p> : null}
          <ul className={css.cards}>
            {packages.map((pkg) => {
              const copy = packageText(pkg, t)
              const open = expanded === pkg.name
              const busy = state.busy.includes(pkg.name)
              return (
                <li key={pkg.name} className={css.card} data-plugin-package={pkg.name}>
                  <div className={css.row}>
                    <Button className={css.disclosure} size="sm" aria-expanded={open} aria-label={t('openDetail', { name: copy.title })}
                      onClick={() => { setExpanded(open ? null : pkg.name) }}>
                      <strong>{copy.title}</strong>
                    </Button>
                    <Tag tone={pkg.error === undefined ? pkg.enabled ? 'success' : 'neutral' : 'danger'}>
                      {t(pkg.error === undefined ? pkg.enabled ? 'enabled' : 'disabled' : 'statusProblem')}
                    </Tag>
                    <Switch checked={pkg.enabled} label={t('enableToggle', { name: copy.title })}
                      disabled={!ready || desktopPackages || busy || pkg.readOnlyReason !== undefined || pkg.error !== undefined}
                      title={desktopPackages ? t('desktopPackages') : pkg.readOnlyReason === undefined ? undefined : managementText({ code: pkg.readOnlyReason }, t)}
                      onChange={(enabled) => { props.setEnabled(pkg.name, enabled) }} />
                  </div>
                  <p className={css.packageName}>{pkg.name}{pkg.version === undefined ? '' : ' · ' + t('versionTag', { version: pkg.version })}</p>
                  {copy.description === undefined ? null : <p className={css.hint}>{copy.description}</p>}
                  {pkg.error === undefined ? null : <p role="alert" className={css.failure}>{managementText(pkg.error, t)}</p>}
                  {desktopPackages || pkg.readOnlyReason === undefined ? null
                    : <p className={css.hint}>{managementText({ code: pkg.readOnlyReason }, t)}</p>}
                  {open ? (
                    <div className={css.details}>
                      {ledger.bundles.has(pkg.name) ? renderSlot('plugins.bundle.config', { view: 'page' }, { entryKey: pkg.name }) : null}
                      <h4 className={css.heading}>{t('partsLabel')}</h4>
                      {pkg.rows.length === 0 ? <p className={css.hint}>{t('partsEmpty')}</p> : null}
                      <ul className={css.rows}>
                        {pkg.rows.map(row => (
                          <li key={row.rowId} data-plugin-row={row.rowId}>
                            <div className={css.row}>
                              <span className={css.rowTitle}>{row.rowId}</span>
                              <span className={css.phase}>
                                <StateDot state={!row.enabled || row.phase === null ? 'idle' : row.phase === 'failed' ? 'error' : row.phase === 'active' ? 'done' : row.phase === 'pending' ? 'idle' : 'ongoing'} />
                                {t(!row.enabled ? 'partOff' : row.phase === null ? 'rowStateIdle' : PHASE_KEYS[row.phase])}
                              </span>
                              <Switch checked={row.enabled} label={t('partToggle', { name: row.rowId })}
                                disabled={!ready || !pkg.enabled || busy || row.entryId === undefined
                                  || row.readOnlyReason !== undefined || state.busy.includes(rowKey(row.entryId))}
                                title={row.readOnlyReason === undefined ? undefined : managementText({ code: row.readOnlyReason }, t)}
                                onChange={(enabled) => { if (row.entryId !== undefined) props.setRowEnabled(row.entryId, enabled) }} />
                            </div>
                            <p className={css.packageName}>{row.moduleName}</p>
                            {row.readOnlyReason === undefined ? null
                              : <p className={css.hint}>{managementText({ code: row.readOnlyReason }, t)}</p>}
                            {ledger.rows.has(rowConfigKey(pkg.name, row.rowId)) ? (
                              <details className={css.config}>
                                <summary>{t('configureRow', { name: row.rowId })}</summary>
                                {renderSlot('plugins.row.config', { view: 'page' }, { entryKey: rowConfigKey(pkg.name, row.rowId) })}
                              </details>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      {!desktopPackages && pkg.removable ? <Button className={css.control} size="sm" disabled={!ready || busy}
                        aria-label={t('uninstallLabel', { name: copy.title })} onClick={() => { props.uninstall(pkg.name) }}>{t('uninstall')}</Button> : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {ledger.items.length === 0 ? null : (
        <section className={css.section}>
          <h4 className={css.heading}>{t('configurationTitle')}</h4>
          {ledger.items.map(item => (
            <details key={item.id} className={css.card}>
              <summary>{item.label}</summary>
              {renderSlot('plugins.item', { view: 'page' }, { only: item.id })}
            </details>
          ))}
        </section>
      )}
      <InstallDialog state={state.install} face={props} t={t} />
      <Modal open={state.confirm !== null} title={t('confirmUninstallTitle', { name: state.confirm?.packageName ?? '' })}
        closeLabel={t('close')} description={t('confirmUninstallDescription')} onClose={props.cancelConfirm}
        footer={<><Button className={css.control} onClick={props.cancelConfirm}>{t('cancel')}</Button>
          <Button className={css.control} onClick={props.confirm}>{t('confirmUninstall')}</Button></>} />
    </div>
  )
}
