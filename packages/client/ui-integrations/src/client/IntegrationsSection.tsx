/** Native provider status rows backed by cancellable Host preflight checks. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IntegrationSettingsKey } from './locales.ts'

export interface IntegrationPreflightSnapshot {
  readonly provider: 'github' | 'gitlab' | 'gitee'
  readonly status: 'connected' | 'not-installed' | 'not-authenticated' | 'not-configured' | 'unavailable' | 'checking'
  readonly reason: string | null
  readonly account: string | null
}

export interface IntegrationBudgetSnapshot {
  readonly provider: 'github' | 'gitlab' | 'gitee'
  readonly state: 'reported' | 'not-reported' | 'unsupported' | 'unavailable'
  readonly reason: string | null
  readonly remaining: number | null
  readonly limit: number | null
  readonly resetsAt: string | null
}

/**
 * Rate-limit budget of one provider, keyed by the request-window reset. A
 * window that rolled over has no budget until the next probe.
 */
interface BudgetCounts {
  readonly remaining: number
  readonly limit: number
  readonly resetsAt: string | null
}
import css from './IntegrationsSection.module.css'

/** Registration-side callback for real provider tool, authentication, and quota checks. */
export interface IntegrationsSectionInjected {
  check: (provider: 'github' | 'gitlab' | 'gitee', signal: AbortSignal) => Promise<IntegrationPreflightSnapshot>
  budget: (provider: 'github' | 'gitlab' | 'gitee', signal: AbortSignal) => Promise<IntegrationBudgetSnapshot>
}

/** Standard section owner, locale, and injected shares. */
export type IntegrationsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.integrations'> & InjectFace<IntegrationsSectionInjected>

type Provider = 'github' | 'gitlab' | 'gitee'
type CheckState = { phase: 'checking' } | { phase: 'ready'; snapshot: IntegrationPreflightSnapshot } | { phase: 'error' }
type BudgetState = { phase: 'checking' } | { phase: 'ready'; snapshot: IntegrationBudgetSnapshot } | { phase: 'error' }
const PROVIDERS = ['github', 'gitlab', 'gitee'] as const
const INITIAL: Record<Provider, CheckState> = { github: { phase: 'checking' }, gitlab: { phase: 'checking' }, gitee: { phase: 'checking' } }
const INITIAL_BUDGET: Record<Provider, BudgetState> = { github: { phase: 'checking' }, gitlab: { phase: 'checking' }, gitee: { phase: 'checking' } }

function statusKey(state: CheckState): IntegrationSettingsKey {
  if (state.phase === 'error') return 'statusUnavailable'
  if (state.phase === 'checking') return 'statusChecking'
  const keys = {
    connected: 'statusConnected', checking: 'statusChecking', unavailable: 'statusUnavailable',
    'not-configured': 'statusNotConfigured', 'not-installed': 'statusNotInstalled', 'not-authenticated': 'statusNotAuthenticated',
  } as const satisfies Record<IntegrationPreflightSnapshot['status'], IntegrationSettingsKey>
  return keys[state.snapshot.status]
}

/** Counts only when the provider reported both numbers for the current window. */
function budgetCounts(snapshot: IntegrationBudgetSnapshot): BudgetCounts | undefined {
  if (snapshot.state !== 'reported' || snapshot.remaining === null || snapshot.limit === null) return undefined
  return { remaining: snapshot.remaining, limit: snapshot.limit, resetsAt: snapshot.resetsAt }
}

/** Render observed provider status without adding installation or authorization operations. */
export function IntegrationsSection({ check, budget, t }: IntegrationsSectionProps): ReactNode {
  const [states, setStates] = useState<Record<Provider, CheckState>>(INITIAL)
  const [budgets, setBudgets] = useState<Record<Provider, BudgetState>>(INITIAL_BUDGET)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStates(INITIAL)
    setBudgets(INITIAL_BUDGET)
    for (const provider of PROVIDERS) {
      void check(provider, controller.signal).then((snapshot) => {
        if (!controller.signal.aborted) setStates(previous => ({ ...previous, [provider]: { phase: 'ready', snapshot } }))
      }, () => {
        if (!controller.signal.aborted) setStates(previous => ({ ...previous, [provider]: { phase: 'error' } }))
      })
      void budget(provider, controller.signal).then((snapshot) => {
        if (!controller.signal.aborted) setBudgets(previous => ({ ...previous, [provider]: { phase: 'ready', snapshot } }))
      }, () => {
        if (!controller.signal.aborted) setBudgets(previous => ({ ...previous, [provider]: { phase: 'error' } }))
      })
    }
    return () => { controller.abort() }
  }, [check, budget, generation])
  const checking = PROVIDERS.some(provider => states[provider].phase === 'checking')

  /** One provider's budget line, rendered only when it has something true to say. */
  const budgetLine = (provider: Provider): ReactNode => {
    const state = budgets[provider]
    if (state.phase === 'checking') return <p className={css.detail} role="status">{t('budgetChecking')}</p>
    if (state.phase === 'error') return <p className={css.detail} role="status">{t('budgetUnavailable')}</p>
    const snapshot = state.snapshot
    if (snapshot.state === 'unsupported') return <p className={css.detail} role="status">{t('budgetUnsupported')}</p>
    if (snapshot.state === 'unavailable') return <p className={css.detail} role="status">{t('budgetUnavailable')}</p>
    const counts = budgetCounts(snapshot)
    if (counts === undefined) return <p className={css.detail} role="status">{t('budgetNotReported')}</p>
    return <div className={css.budget} role="status">
      <p className={css.detail}>{t('budgetRemaining', { remaining: counts.remaining, limit: counts.limit })}</p>
      {counts.resetsAt !== null && <p className={css.detail}>{t('budgetResets', { time: new Date(counts.resetsAt).toLocaleString() })}</p>}
    </div>
  }

  return <section className={css.section}>
    <p className={css.help}>{t('scopeNote')}</p>
    <header className={css.header}>
      <Button className={css.refresh} variant="outline" disabled={checking} data-settings-anchor="integrations-refresh"
        onClick={() => { setGeneration(value => value + 1) }}>{t('refreshAll')}</Button>
    </header>
    <div className={css.providers} aria-busy={checking}>
      {PROVIDERS.map((provider) => {
        const state = states[provider]
        const snapshot = state.phase === 'ready' ? state.snapshot : undefined
        const reason = snapshot?.reason
        const status = state.phase === 'ready' ? state.snapshot.status : state.phase
        return <section key={provider} className={css.provider} data-settings-anchor={'integrations-' + provider}
          aria-labelledby={'integration-name-' + provider}>
          <span className={css.symbol} aria-hidden="true"><IconLinkOutline16 size={18} /></span>
          <div className={css.copy}>
            <h2 id={'integration-name-' + provider} className={css.label}>{t(`${provider}Title`)}</h2>
            <p className={css.help}>{t(provider === 'github' ? 'githubDescription' : provider === 'gitlab' ? 'gitlabDescription' : 'giteeDescription')}</p>
            {snapshot?.account != null && <p className={css.detail}>{t('accountLabel')}: {snapshot.account}</p>}
            {state.phase === 'error' && <p className={css.error} role="alert">{t('errorText')}</p>}
            {reason === 'cli-not-found' && provider !== 'gitee' && <p className={css.detail}>
              {t('installPrompt')} <code>{t(provider === 'github' ? 'githubInstallCommand' : 'gitlabInstallCommand')}</code>
            </p>}
            {reason === 'cli-auth-failed' && provider !== 'gitee' && <p className={css.detail}>
              {t('authPrompt')} <code>{t(provider === 'github' ? 'authCommand' : 'gitlabAuthCommand')}</code>
            </p>}
            {(reason === 'token-not-set' || reason === 'token-invalid') && <p className={css.detail}>{t('tokenPrompt')}</p>}
            {reason === 'probe-failed' && <p className={css.error}>{t('authUnavailableHint')}</p>}
            {budgetLine(provider)}
          </div>
          <span className={css.status} role="status" data-state={status}>{t(statusKey(state))}</span>
        </section>
      })}
    </div>
  </section>
}
