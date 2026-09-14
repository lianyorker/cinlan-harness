/** Git and source control settings section: branch prefix, keep local main, group order, upstream comparison, attribution. */
import { useEffect, useState, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GitSourceControlSettings, BranchPrefixMode, SourceControlGroupOrder } from '../types.ts'
import type { GitSettingsKey } from './locales.ts'
import css from './GitSettingsSection.module.css'

/** Injected face for the Git settings section. */
export interface GitSettingsSectionInjected {
  readonly settings: SettingsScope<GitSourceControlSettings>
  readonly t: (key: GitSettingsKey, params?: Record<string, string | number>) => string
}

/** Owner props from the settings shell. */
export interface GitSettingsSectionProps extends GitSettingsSectionInjected {
  close: () => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; value: GitSourceControlSettings; revision: number | undefined }
  | { phase: 'error'; message: string }

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

function useSettings(scope: SettingsScope<GitSourceControlSettings>): {
  state: LoadState
  update: (field: keyof GitSourceControlSettings, value: unknown) => Promise<void>
  saveStatus: SaveStatus
} {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')

  useEffect(() => {
    const sync = () => {
      const snapshot = scope.getSnapshot()
      if (snapshot.status === 'ready' && snapshot.value !== undefined) {
        setState({ phase: 'ready', value: snapshot.value, revision: snapshot.revision })
      } else if (snapshot.status === 'unavailable') {
        setState({ phase: 'error', message: 'unavailable' })
      }
    }
    sync()
    return scope.subscribe(() => { sync() })
  }, [scope])

  const update = async (field: keyof GitSourceControlSettings, value: unknown): Promise<void> => {
    setSaveStatus('saving')
    try {
      await scope.set(field as string, value)
      setSaveStatus('saved')
      setTimeout(() => { setSaveStatus('idle') }, 2000)
    } catch {
      setSaveStatus('error')
    }
  }

  return { state, update, saveStatus }
}

function BranchPrefixCard(props: {
  value: GitSourceControlSettings
  t: GitSettingsSectionInjected['t']
  update: (field: keyof GitSourceControlSettings, value: unknown) => Promise<void>
}): ReactNode {
  const { value, t, update } = props
  const modes: { mode: BranchPrefixMode; labelKey: GitSettingsKey; descKey: GitSettingsKey }[] = [
    { mode: 'git-username', labelKey: 'branchPrefixGitUsername', descKey: 'branchPrefixGitUsernameDesc' },
    { mode: 'custom', labelKey: 'branchPrefixCustom', descKey: 'branchPrefixCustomDesc' },
    { mode: 'none', labelKey: 'branchPrefixNone', descKey: 'branchPrefixNoneDesc' },
  ]
  const preview = value.branchPrefix === 'git-username'
    ? '<git-username>/'
    : value.branchPrefix === 'custom'
      ? value.branchPrefixCustom || '(empty)'
      : '(no prefix)'

  return <div className={css.card}>
    <h2 className={css.cardTitle}>{t('branchPrefixTitle')}</h2>
    <p className={css.cardDescription}>{t('branchPrefixDescription')}</p>
    <div className={css.optionGroup}>
      {modes.map(({ mode, labelKey, descKey }) => (
        <label
          key={mode}
          className={`${css.optionRow} ${value.branchPrefix === mode ? css.optionRowSelected : ''}`}
        >
          <input
            type="radio"
            name="branchPrefix"
            className={css.optionRadio}
            checked={value.branchPrefix === mode}
            onChange={() => { void update('branchPrefix', mode) }}
          />
          <span className={css.optionContent}>
            <span className={css.optionLabel}>{t(labelKey)}</span>
            <span className={css.optionDesc}>{t(descKey)}</span>
          </span>
        </label>
      ))}
    </div>
    {value.branchPrefix === 'custom' && (
      <>
        <input
          type="text"
          className={css.customInput}
          placeholder={t('branchPrefixCustomPlaceholder')}
          value={value.branchPrefixCustom}
          onChange={(e) => { void update('branchPrefixCustom', e.target.value) }}
          aria-label={t('branchPrefixCustomLabel')}
        />
      </>
    )}
    <p className={css.preview}>{t('branchPrefixPreview', { value: preview })}</p>
  </div>
}

function ToggleCard(props: {
  titleKey: GitSettingsKey
  descKey: GitSettingsKey
  checked: boolean
  t: GitSettingsSectionInjected['t']
  update: (field: keyof GitSourceControlSettings, value: unknown) => Promise<void>
  field: keyof GitSourceControlSettings
  hintKey?: GitSettingsKey
}): ReactNode {
  const { titleKey, descKey, checked, t, update, field, hintKey } = props
  return <div className={css.card}>
    <h2 className={css.cardTitle}>{t(titleKey)}</h2>
    <p className={css.cardDescription}>{t(descKey)}</p>
    <div className={css.toggleRow}>
      <span className={css.optionDesc}>{checked ? 'On' : 'Off'}</span>
      <button
        type="button"
        className={`${css.toggle} ${checked ? css.toggleChecked : ''}`}
        onClick={() => { void update(field, !checked) }}
        aria-pressed={checked}
        aria-label={t(titleKey)}
      >
        <span className={css.toggleKnob} />
      </button>
    </div>
    {hintKey && <p className={css.hint}>{t(hintKey)}</p>}
  </div>
}

function GroupOrderCard(props: {
  value: GitSourceControlSettings
  t: GitSettingsSectionInjected['t']
  update: (field: keyof GitSourceControlSettings, value: unknown) => Promise<void>
}): ReactNode {
  const { value, t, update } = props
  const orders: { order: SourceControlGroupOrder; labelKey: GitSettingsKey }[] = [
    { order: 'changes-first', labelKey: 'groupOrderChangesFirst' },
    { order: 'staged-first', labelKey: 'groupOrderStagedFirst' },
    { order: 'untracked-first', labelKey: 'groupOrderUntrackedFirst' },
  ]
  return <div className={css.card}>
    <h2 className={css.cardTitle}>{t('groupOrderTitle')}</h2>
    <p className={css.cardDescription}>{t('groupOrderDescription')}</p>
    <div className={css.segmentGroup}>
      {orders.map(({ order, labelKey }) => (
        <button
          key={order}
          type="button"
          className={`${css.segmentButton} ${value.sourceControlGroupOrder === order ? css.segmentButtonSelected : ''}`}
          onClick={() => { void update('sourceControlGroupOrder', order) }}
        >
          {t(labelKey)}
        </button>
      ))}
    </div>
  </div>
}

/** The Git settings section component. */
export function GitSettingsSection(props: GitSettingsSectionProps): ReactNode {
  const { t, settings } = props
  const { state, update, saveStatus } = useSettings(settings)

  if (state.phase === 'loading') {
    return <div className={css.section}><p className={css.loadingText}>{t('settingsLoading')}</p></div>
  }
  if (state.phase === 'error') {
    return <div className={css.section}><p className={css.errorText}>{t('settingsError')}</p></div>
  }

  const { value } = state

  return <div className={css.section}>
    <BranchPrefixCard value={value} t={t} update={update} />
    <ToggleCard
      titleKey="keepLocalMainTitle"
      descKey="keepLocalMainDescription"
      checked={value.refreshLocalBaseRefOnWorktreeCreate}
      t={t}
      update={update}
      field="refreshLocalBaseRefOnWorktreeCreate"
    />
    <GroupOrderCard value={value} t={t} update={update} />
    <ToggleCard
      titleKey="compareUpstreamTitle"
      descKey="compareUpstreamDescription"
      checked={value.compareAgainstUpstream}
      t={t}
      update={update}
      field="compareAgainstUpstream"
    />
    <ToggleCard
      titleKey="attributionTitle"
      descKey="attributionDescription"
      checked={value.enableGitHubAttribution}
      t={t}
      update={update}
      field="enableGitHubAttribution"
      hintKey="attributionKeywordHint"
    />
    <p className={`${css.saveStatus} ${saveStatus === 'error' ? css.saveStatusError : ''} ${saveStatus === 'saved' ? css.saveStatusOk : ''}`}>
      {saveStatus === 'saving' ? '…' : saveStatus === 'error' ? t('settingsSaveFailed') : saveStatus === 'saved' ? t('settingsSaved') : ''}
    </p>
  </div>
}
