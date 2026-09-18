/** New-session default controls over the shared catalog and authoritative settings scope. */
import { useId } from 'react'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelCatalogState } from './catalog.ts'
import { hasDefaultModelOverrides, type DefaultModelWriteState } from './default-settings.ts'
import css from './DefaultModelSettings.module.css'

/** Registration-side observations and explicit default-setting actions. */
export interface DefaultModelSettingsInjected {
  hooks: {
    /** Shared Host-generation catalog, also consumed by Session selectors. */
    catalog: ObservableSnapshot<ModelCatalogState>
    /** Effective defaults and user-layer presence from the settings owner. */
    defaults: ObservableSnapshot<SettingsScopeSnapshot<ModelSelection>>
    /** Feedback for the active defaults editor. */
    write: ObservableSnapshot<DefaultModelWriteState>
  }
  /** Persist one complete route and optional reasoning choice. */
  select: (selection: ModelSelection) => Promise<void>
  /** Remove provider, model, and effort overrides. */
  reset: () => Promise<void>
  /** Retry the failed write using the latest recovered revision. */
  retry: () => Promise<void>
  /** Refresh the shared catalog after a failed or partial load. */
  reload: () => void
}

/** Props derive from the root slot, locale seat, and injected observations. */
export type DefaultModelSettingsProps = PropsRuntime<'settings.models.defaults'>
  & PropsLocale<'model'> & InjectFace<DefaultModelSettingsInjected>

/**
 * Render default model and route-specific reasoning controls without a Session dependency.
 * @param props - slot-bound snapshots and mutation callbacks.
 * @returns the two anchored settings rows and their save feedback.
 */
export function DefaultModelSettings({
  t, useCatalog, useDefaults, useWrite, select, reset, retry, reload,
}: DefaultModelSettingsProps) {
  const id = useId()
  const catalog = useCatalog(state => state)
  const defaults = useDefaults(state => state)
  const write = useWrite(state => state)
  const groups = catalog.value?.groups ?? []
  const partialCatalog = (catalog.value?.failures.length ?? 0) > 0
  const choices = groups.flatMap(group => group.models.map(model => ({
    key: JSON.stringify([group.id, model.id]), provider: group.id, model,
  })))
  const current = defaults.value
  const selected = choices.find(choice => current !== undefined
    && choice.provider === current.provider && choice.model.id === current.model)
  const efforts = selected?.model.reasoning?.efforts ?? []
  const busy = write.status === 'saving'
  const writable = defaults.status === 'ready' && defaults.writable && !busy
  const selectable = writable && catalog.status === 'ready' && choices.length > 0
  const effortKnown = current?.reasoningEffort === undefined
    || efforts.some(effort => effort.id === current.reasoningEffort)
  const placeholder = current === undefined ? t('trigger.fallback')
    : t('defaults.unlisted', { model: current.model })

  return (
    <section className={css.section} aria-label={t('defaults.title')} aria-busy={busy}>
      <div className={css.row} data-settings-anchor="default-model">
        <div className={css.copy}>
          <label className={css.label} htmlFor={id + '-model'}>{t('defaults.model')}</label>
          <p className={css.help} id={id + '-scope'}>{t('defaults.scope')}</p>
        </div>
        <select
          id={id + '-model'}
          className={css.select}
          aria-describedby={id + '-scope'}
          value={selected?.key ?? ''}
          disabled={!selectable}
          onChange={(event) => {
            const choice = choices.find(candidate => candidate.key === event.target.value)
            if (choice !== undefined) void select({ provider: choice.provider, model: choice.model.id })
          }}
        >
          {selected === undefined && <option value="" disabled>{placeholder}</option>}
          {groups.map(group => (
            <optgroup key={group.id} label={group.name}>
              {group.models.map(model => (
                <option key={model.id} value={JSON.stringify([group.id, model.id])}>{model.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className={css.row} data-settings-anchor="default-reasoning">
        <div className={css.copy}>
          <label className={css.label} htmlFor={id + '-effort'}>{t('defaults.reasoning')}</label>
          <p className={css.help}>{t('defaults.reasoningDescription')}</p>
        </div>
        <select
          id={id + '-effort'}
          className={css.select}
          value={current?.reasoningEffort ?? ''}
          disabled={!selectable || selected === undefined || efforts.length === 0}
          onChange={(event) => {
            if (current !== undefined) void select({
              provider: current.provider, model: current.model,
              ...(event.target.value === '' ? {} : { reasoningEffort: event.target.value }),
            })
          }}
        >
          <option value="">{t('effort.providerDefault')}</option>
          {!effortKnown && <option value={current.reasoningEffort} disabled>
            {t('defaults.unlisted', { model: current.reasoningEffort })}
          </option>}
          {efforts.map(effort => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
        </select>
      </div>
      {defaults.status === 'unavailable' && <p className={css.help}>{t('defaults.unavailable')}</p>}
      {defaults.status === 'ready' && !defaults.writable && <p className={css.help}>{t('defaults.readOnly')}</p>}
      {defaults.status === 'loading' && <p className={css.help} role="status">{t('defaults.loading')}</p>}
      {catalog.status === 'loading' && <p className={css.help} role="status">{t('status.loading')}</p>}
      {(catalog.status === 'error' || (catalog.status === 'ready' && partialCatalog)) && <div className={css.feedback} role="alert">
        <span>{t(catalog.status === 'error' ? 'defaults.catalogError' : 'defaults.catalogPartial')}</span>
        <Button onClick={reload}>{t('action.reload')}</Button>
      </div>}
      {catalog.status === 'ready' && choices.length === 0 && <p className={css.help}>{t('empty.models')}</p>}
      {selected !== undefined && efforts.length === 0 && <p className={css.help}>{t('empty.efforts')}</p>}
      <div className={css.actions}>
        <Button variant="outline" disabled={!writable || !hasDefaultModelOverrides(defaults.user)} onClick={() => { void reset() }}>
          {t('defaults.reset')}
        </Button>
        {write.status === 'saving' && <span className={css.help} role="status">{t('defaults.saving')}</span>}
        {write.status === 'saved' && <span className={css.help} role="status">{t('defaults.saved')}</span>}
        {(write.status === 'failed' || write.status === 'conflict') && <div className={css.feedback} role="alert">
          <span>{t(write.status === 'conflict' ? 'defaults.conflict' : 'defaults.failed')}</span>
          {write.canRetry && <Button disabled={!writable} onClick={() => { void retry() }}>{t('defaults.retry')}</Button>}
        </div>}
      </div>
    </section>
  )
}
