/** Native settings rows over the authoritative Git preferences snapshot. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Switch, fileSizeText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_SOURCE_CONTROL_AI_SETTINGS } from '@cinlan/git-settings/ai-author'
import type { IntegrationBudgetSnapshot } from '@cinlan/api-integration-preflight-controller/budget'
import type {
  GitSourceControlSettings,
  BranchPrefixMode,
  SourceControlGroupOrder,
  SourceControlAiActionId,
  SourceControlAiSettings,
} from '../types.ts'
import { hasOverride, type GitSettingsOperations } from './settings-operations.ts'
import type { GitSettingsKey } from './locales.ts'
import css from './GitSettingsSection.module.css'

/** Registration-owned data and mutations; the renderer binds useSettings. */
export interface GitSettingsSectionInjected extends GitSettingsOperations {
  hooks: { settings: HostObservable<SettingsScopeSnapshot<GitSourceControlSettings>> }
  /** Read one provider's API rate-limit budget through the integration preflight Remote. */
  budget: (provider: 'github' | 'gitlab', signal: AbortSignal) => Promise<IntegrationBudgetSnapshot>
}

/** Git preferences receive the standard settings owner and locale shares. */
export type GitSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.gitSourceControl'> & InjectFace<GitSettingsSectionInjected>

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
/** One provider's budget probe outcome; probing runs once per mount. */
type BudgetState =
  | { phase: 'probing' }
  | { phase: 'ready'; snapshot: IntegrationBudgetSnapshot }
  | { phase: 'error'; message: string }
type ToggleField = 'compareAgainstUpstream' | 'enableGitHubAttribution' | 'autoRenameTaskBranch' | 'refreshLocalBaseRefOnWorktreeCreate'
const TOGGLES: readonly { field: ToggleField; titleKey: GitSettingsKey; descriptionKey: GitSettingsKey; anchor: string }[] = [
  { field: 'compareAgainstUpstream', titleKey: 'compareUpstreamTitle', descriptionKey: 'compareUpstreamDescription', anchor: 'git-upstream' },
  { field: 'enableGitHubAttribution', titleKey: 'attributionTitle', descriptionKey: 'attributionDescription', anchor: 'git-attribution' },
  { field: 'autoRenameTaskBranch', titleKey: 'renameBranchTitle', descriptionKey: 'renameBranchDescription', anchor: 'git-rename-branch' },
  { field: 'refreshLocalBaseRefOnWorktreeCreate', titleKey: 'keepLocalMainTitle', descriptionKey: 'keepLocalMainDescription', anchor: 'git-update-base' },
]

/** Render durable Git preferences, preserving custom-prefix drafts after a rejected save. */
export function GitSettingsSection({ useSettings, save, reset, budget, t }: GitSettingsSectionProps): ReactNode {
  const snapshot = useSettings(value => value)
  const value = snapshot.value
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [customDraft, setCustomDraft] = useState<{ value: string; revision: number | undefined }>()
  const aiConfig: SourceControlAiSettings = value?.sourceControlAi ?? DEFAULT_SOURCE_CONTROL_AI_SETTINGS
  const [selectedAction, setSelectedAction] = useState<SourceControlAiActionId>('commit-message')
  const [recipeDraft, setRecipeDraft] = useState<string>()
  const [budgets, setBudgets] = useState<Record<'github' | 'gitlab', BudgetState>>({ github: { phase: 'probing' }, gitlab: { phase: 'probing' } })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const pending = saveStatus === 'saving'
  const writable = snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
  const disabled = !writable || pending

  const currentTemplate = recipeDraft !== undefined
    ? recipeDraft
    : aiConfig.recipes[selectedAction].template

  const updateAiConfig = (patch: Partial<SourceControlAiSettings>): Promise<boolean> => {
    return commit(() => save('sourceControlAi', { ...aiConfig, ...patch }))
  }

  const handleSaveRecipe = async (): Promise<void> => {
    const nextRecipes = {
      ...aiConfig.recipes,
      [selectedAction]: {
        ...aiConfig.recipes[selectedAction],
        template: currentTemplate,
      },
    }
    const saved = await updateAiConfig({ recipes: nextRecipes })
    if (saved && mounted.current) setRecipeDraft(undefined)
  }

  const handleResetRecipe = async (): Promise<void> => {
    const defaultRecipe = DEFAULT_SOURCE_CONTROL_AI_SETTINGS.recipes[selectedAction]
    const nextRecipes = {
      ...aiConfig.recipes,
      [selectedAction]: defaultRecipe,
    }
    const saved = await updateAiConfig({ recipes: nextRecipes })
    if (saved && mounted.current) setRecipeDraft(undefined)
  }
  // API 预算是集成页同一探测的只读镜像：挂载时探一次，失败就留在错误态，不参与设置保存状态机。
  // 用局部 alive 标志（同 ui-integrations 的模式）而不是共享 mounted ref：React 18 的挂载期
  // 重放（StrictMode/并发特性下 effects 会 mount→cleanup→再 mount）会让跨挂载的 ref 判活失真。
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    for (const provider of ['github', 'gitlab'] as const) {
      budget(provider, controller.signal).then((snapshot) => {
        if (alive && !controller.signal.aborted) {
          setBudgets(previous => ({ ...previous, [provider]: { phase: 'ready', snapshot } }))
        }
      }, (reason: unknown) => {
        if (alive && !controller.signal.aborted) {
          setBudgets(previous => ({
            ...previous,
            [provider]: { phase: 'error', message: reason instanceof Error ? reason.message : String(reason) },
          }))
        }
      })
    }
    return () => { alive = false; controller.abort() }
  }, [])
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

          <div className={css.row} data-settings-anchor="git-ai-author">
            <div className={css.copy}>
              <h2 className={css.label}>{t('sourceControlAiTitle')}</h2>
              <p className={css.help}>{t('sourceControlAiDescription')}</p>
            </div>
            <div className={css.controls}>
              <Switch checked={aiConfig.enabled} label={t('sourceControlAiEnabled')} disabled={disabled}
                onChange={(enabled) => { void updateAiConfig({ enabled }) }} />
              {resetButton('sourceControlAi', 'sourceControlAiTitle')}
            </div>
          </div>

          {aiConfig.enabled && (
            <>
              <div className={css.row} data-settings-anchor="git-ai-sensitive-filter">
                <div className={css.copy}>
                  <h2 className={css.label}>{t('sourceControlAiFilterSensitiveTitle')}</h2>
                  <p className={css.help}>{t('sourceControlAiFilterSensitiveDesc')}</p>
                </div>
                <div className={css.controls}>
                  <Switch checked={aiConfig.filterSensitiveFiles} label={t('sourceControlAiFilterSensitiveTitle')} disabled={disabled}
                    onChange={(filterSensitiveFiles) => { void updateAiConfig({ filterSensitiveFiles }) }} />
                </div>
              </div>

              <div className={css.row} data-settings-anchor="git-ai-max-diff">
                <div className={css.copy}>
                  <label className={css.label} htmlFor="git-ai-max-diff-select">{t('sourceControlAiMaxDiffTitle')}</label>
                  <p className={css.help}>{t('sourceControlAiMaxDiffDesc')}</p>
                </div>
                <div className={css.controls}>
                  <select id="git-ai-max-diff-select" className={css.select} value={aiConfig.maxDiffBytes} disabled={disabled}
                    onChange={(e) => { void updateAiConfig({ maxDiffBytes: parseInt(e.target.value, 10) }) }}>
                    <option value={16 * 1024}>{fileSizeText(16 * 1024)}</option>
                    <option value={32 * 1024}>{fileSizeText(32 * 1024)}</option>
                    <option value={64 * 1024}>{fileSizeText(64 * 1024)}</option>
                    <option value={128 * 1024}>{fileSizeText(128 * 1024)}</option>
                  </select>
                </div>
              </div>

              <div className={css.row} data-settings-anchor="git-ai-recipe-defaults">
                <div className={css.copy}>
                  <label className={css.label} htmlFor="git-ai-action-select">{t('recipeActionLabel')}</label>
                  <p className={css.help}>{t('sourceControlAiDescription')}</p>

                  <div className={css.recipeCard}>
                    <div className={css.buttonRow}>
                      <select id="git-ai-action-select" className={css.select} value={selectedAction} disabled={disabled}
                        onChange={(e) => {
                          setSelectedAction(e.target.value as SourceControlAiActionId)
                          setRecipeDraft(undefined)
                        }}>
                        <option value="commit-message">{t('recipeCommitMessageTitle')}</option>
                        <option value="diff-review">{t('recipeDiffReviewTitle')}</option>
                        <option value="pr-description">{t('recipePrDescriptionTitle')}</option>
                      </select>
                      <Switch checked={aiConfig.recipes[selectedAction].enabled} label={t('recipeEnabledLabel')}
                        disabled={disabled}
                        onChange={(enabled) => {
                          const nextRecipes = {
                            ...aiConfig.recipes,
                            [selectedAction]: { ...aiConfig.recipes[selectedAction], enabled },
                          }
                          void updateAiConfig({ recipes: nextRecipes })
                        }} />
                      <Button disabled={disabled || !aiConfig.recipes[selectedAction].enabled}
                        onClick={() => { setRecipeDraft(prev => (prev ?? currentTemplate) + ' {{diff}}') }}>
                        {t('recipeInsertDiff')}
                      </Button>
                      <Button disabled={disabled || !aiConfig.recipes[selectedAction].enabled}
                        onClick={() => { setRecipeDraft(prev => (prev ?? currentTemplate) + ' {{branch}}') }}>
                        {t('recipeInsertBranch')}
                      </Button>
                      <Button disabled={disabled || !aiConfig.recipes[selectedAction].enabled}
                        onClick={() => { setRecipeDraft(prev => (prev ?? currentTemplate) + ' {{stagedFiles}}') }}>
                        {t('recipeInsertFiles')}
                      </Button>
                    </div>

                    <textarea className={css.recipeTextarea} value={currentTemplate} aria-label={t('recipeTemplateLabel')}
                      disabled={disabled || !aiConfig.recipes[selectedAction].enabled} rows={3}
                      onChange={(e) => { setRecipeDraft(e.target.value) }} />

                    <div className={css.buttonRow}>
                      {recipeDraft !== undefined && (
                        <>
                          <Button variant="outline" disabled={disabled} onClick={() => { void handleSaveRecipe() }}>
                            {t('save')}
                          </Button>
                          <Button disabled={pending} onClick={() => { setRecipeDraft(undefined) }}>
                            {t('discard')}
                          </Button>
                        </>
                      )}
                      <Button disabled={disabled} onClick={() => { void handleResetRecipe() }}>
                        {t('reset')}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
          {(['github', 'gitlab'] as const).map((provider) => {
            const state = budgets[provider]
            const providerTitle = provider === 'github' ? t('budgetGitHubTitle') : t('budgetGitLabTitle')
            let detail: string
            if (state.phase === 'probing') detail = t('budgetProbing')
            else if (state.phase === 'error') detail = t('budgetError').replace('{message}', state.message)
            else if (state.snapshot.state === 'reported') {
              detail = t('budgetReported')
                .replace('{remaining}', String(state.snapshot.remaining))
                .replace('{limit}', String(state.snapshot.limit))
                + (state.snapshot.resetsAt === null ? '' : ' ' + t('budgetResets').replace('{time}', state.snapshot.resetsAt))
            } else if (state.snapshot.state === 'unsupported') detail = t('budgetUnsupported')
            else if (state.snapshot.state === 'not-reported') detail = t('budgetNotReported')
            else detail = t('budgetUnavailable').replace('{message}', state.snapshot.reason ?? '')
            return <div key={provider} className={css.row} data-settings-anchor={`git-budget-${provider}`}>
              <div className={css.copy}>
                <h2 className={css.label}>{providerTitle}</h2>
                <p className={css.help}>{t('budgetDescription')}</p>
              </div>
              <div className={css.controls}>
                <p className={css.help} role="status">{detail}</p>
              </div>
            </div>
          })}
        </div>
        <p className={css.message} role="status" data-state={saveStatus}>
          {saveStatus === 'saving' ? t('settingsSaving') : saveStatus === 'saved' ? t('settingsSaved')
            : saveStatus === 'error' ? t('settingsSaveFailed') : ''}
        </p>
      </>}
  </section>
}
