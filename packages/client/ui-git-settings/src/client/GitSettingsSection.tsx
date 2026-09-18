/** Native settings rows over the authoritative Git preferences snapshot. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GitSourceControlSettings, BranchPrefixMode, SourceControlGroupOrder } from '../types.ts'
import { hasOverride, type GitSettingsOperations } from './settings-operations.ts'
import type { GitSettingsKey } from './locales.ts'
import css from './GitSettingsSection.module.css'

/** Registration-owned data and mutations; the renderer binds useSettings. */
export interface GitSettingsSectionInjected extends GitSettingsOperations {
  hooks: { settings: HostObservable<SettingsScopeSnapshot<GitSourceControlSettings>> }
}

/** Git preferences receive the standard settings owner and locale shares. */
export type GitSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.gitSourceControl'> & InjectFace<GitSettingsSectionInjected>

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type ToggleField = 'compareAgainstUpstream' | 'enableGitHubAttribution'
const TOGGLES: readonly { field: ToggleField; titleKey: GitSettingsKey; descriptionKey: GitSettingsKey; anchor: string }[] = [
  { field: 'compareAgainstUpstream', titleKey: 'compareUpstreamTitle', descriptionKey: 'compareUpstreamDescription', anchor: 'git-upstream' },
  { field: 'enableGitHubAttribution', titleKey: 'attributionTitle', descriptionKey: 'attributionDescription', anchor: 'git-attribution' },
]

/** Render durable Git preferences, preserving custom-prefix drafts after a rejected save. */
export function GitSettingsSection({ useSettings, save, reset, t }: GitSettingsSectionProps): ReactNode {
  const snapshot = useSettings(value => value)
  const value = snapshot.value
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [customDraft, setCustomDraft] = useState<{ value: string; revision: number | undefined }>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const pending = saveStatus === 'saving'
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const disabled = !writable || pending
  const commit = async (operation: () => Promise<boolean>): Promise<boolean> => {
    if (disabled) return false
    setSaveStatus('saving')
    const saved = await operation()
    if (mounted.current) setSaveStatus(saved ? 'saved' : 'error')
    return saved
  }
  const resetButton = (field: keyof GitSourceControlSettings, titleKey: GitSettingsKey): ReactNode =>
    hasOverride(snapshot.user, field) && <Button
      disabled={disabled} onClick={() => {
        void commit(() => reset(field)).then((saved) => {
          if (saved && field === 'branchPrefixCustom' && mounted.current) setCustomDraft(undefined)
        })
      }}
      aria-label={t('resetField', { field: t(titleKey) })}
    >{t('reset')}</Button>

  return <section className={css.section}>
    <header className={css.header}>
      <h1 className={css.title}>{t('nav')}</h1>
      <p className={css.description}>{t('description')}</p>
    </header>
    <p className={css.notice}>{t('runtimeNotice')}</p>
    {snapshot.status !== 'ready' || value === undefined
      ? <p className={css.message} role="status">{t(snapshot.mode === 'memory' ? 'readOnly'
        : snapshot.status === 'unavailable' ? 'settingsError' : 'settingsLoading')}</p>
      : <>
        {!writable && <p className={css.notice} role="status">{t('readOnly')}</p>}
        <div className={css.rows} aria-busy={pending}>
          <div className={css.row} data-settings-anchor="git-branch-prefix">
            <div className={css.copy}>
              <label className={css.label} htmlFor="git-branch-prefix">{t('branchPrefixTitle')}</label>
              <p className={css.help}>{t('branchPrefixDescription')}</p>
              <p className={css.help}>{value.branchPrefix === 'git-username'
                ? t('branchPrefixGitUsernameDesc')
                : t('branchPrefixPreview', { value: value.branchPrefix === 'custom'
                  ? value.branchPrefixCustom.length === 0 ? t('branchPrefixEmpty')
                    : value.branchPrefixCustom + (value.branchPrefixCustom.endsWith('/') ? '' : '/') + 'dsh/task/<uuid>'
                  : 'dsh/task/<uuid>' })}</p>
            </div>
            <div className={css.controls}>
              <select id="git-branch-prefix" className={css.select} value={value.branchPrefix} disabled={disabled}
                onChange={(event) => { void commit(() => save('branchPrefix', event.target.value as BranchPrefixMode)) }}>
                <option value="git-username">{t('branchPrefixGitUsername')}</option>
                <option value="custom">{t('branchPrefixCustom')}</option>
                <option value="none">{t('branchPrefixNone')}</option>
              </select>
              {resetButton('branchPrefix', 'branchPrefixTitle')}
            </div>
          </div>
          <div className={css.row} data-settings-anchor="git-custom-prefix">
            <div className={css.copy}>
              <label className={css.label} htmlFor="git-custom-prefix">{t('branchPrefixCustomLabel')}</label>
              <p className={css.help}>{t(value.branchPrefix === 'custom' ? 'branchPrefixCustomDesc' : 'customInactive')}</p>
            </div>
            <div className={css.controls}>
              <form className={css.prefixForm} onSubmit={(event) => {
                event.preventDefault()
                if (customDraft === undefined || value.branchPrefix !== 'custom') return
                const draft = customDraft
                void commit(() => save('branchPrefixCustom', draft.value, draft.revision)).then((saved) => {
                  if (saved && mounted.current) setCustomDraft(undefined)
                })
              }}>
                <Input id="git-custom-prefix" className={css.input ?? ''} value={customDraft?.value ?? value.branchPrefixCustom}
                  placeholder={t('branchPrefixCustomPlaceholder')} disabled={disabled || value.branchPrefix !== 'custom'}
                  onChange={(event) => {
                    const text = event.target.value
                    setCustomDraft(previous => ({ value: text, revision: previous?.revision ?? snapshot.revision }))
                  }} />
                {customDraft !== undefined && <>
                  <Button type="submit" variant="outline" disabled={disabled || value.branchPrefix !== 'custom'}>{t('save')}</Button>
                  <Button disabled={pending} onClick={() => { setCustomDraft(undefined) }}>{t('discard')}</Button>
                </>}
              </form>
              {resetButton('branchPrefixCustom', 'branchPrefixCustomLabel')}
            </div>
          </div>
          <div className={css.row} data-settings-anchor="git-update-base">
            <div className={css.copy}>
              <h2 className={css.label}>{t('keepLocalMainTitle')}</h2>
              <p className={css.help}>{t('keepLocalMainDescription')}</p>
            </div>
            <div className={css.controls}>
              <Switch checked={value.refreshLocalBaseRefOnWorktreeCreate} label={t('keepLocalMainTitle')}
                title={t('keepLocalMainDescription')} disabled onChange={() => {}} />
              {resetButton('refreshLocalBaseRefOnWorktreeCreate', 'keepLocalMainTitle')}
            </div>
          </div>
          <div className={css.row} data-settings-anchor="git-group-order">
            <div className={css.copy}>
              <label className={css.label} htmlFor="git-group-order">{t('groupOrderTitle')}</label>
              <p className={css.help}>{t('groupOrderDescription')}</p>
            </div>
            <div className={css.controls}>
              <select id="git-group-order" className={css.select} value={value.sourceControlGroupOrder} disabled={disabled}
                onChange={(event) => { void commit(() => save('sourceControlGroupOrder', event.target.value as SourceControlGroupOrder)) }}>
                <option value="changes-first">{t('groupOrderChangesFirst')}</option>
                <option value="staged-first">{t('groupOrderStagedFirst')}</option>
                <option value="untracked-first">{t('groupOrderUntrackedFirst')}</option>
              </select>
              {resetButton('sourceControlGroupOrder', 'groupOrderTitle')}
            </div>
          </div>
          {TOGGLES.map(({ field, titleKey, descriptionKey, anchor }) =>
            <div key={field} className={css.row} data-settings-anchor={anchor}>
              <div className={css.copy}><h2 className={css.label}>{t(titleKey)}</h2><p className={css.help}>{t(descriptionKey)}</p></div>
              <div className={css.controls}>
                <Switch checked={value[field]} label={t(titleKey)} disabled={disabled}
                  onChange={(value) => { void commit(() => save(field, value)) }} />
                {resetButton(field, titleKey)}
              </div>
            </div>)}
        </div>
        <p className={css.message} role="status" data-state={saveStatus}>
          {saveStatus === 'saving' ? t('settingsSaving') : saveStatus === 'saved' ? t('settingsSaved')
            : saveStatus === 'error' ? t('settingsSaveFailed') : ''}
        </p>
      </>}
  </section>
}
