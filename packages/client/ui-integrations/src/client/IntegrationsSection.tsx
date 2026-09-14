/** Integrations settings section: GitHub, GitLab, and Gitee connection status. */
import { useEffect, useState, type ReactNode } from 'react'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IntegrationProvider, IntegrationPreflightSnapshot, IntegrationStatus } from '@deepseek-ai/dsh-api-remotes/client'
import type { IntegrationSettingsKey } from './locales.ts'
import css from './IntegrationsSection.module.css'

/** Injected face for the Integrations section. */
export interface IntegrationsSectionInjected {
  readonly check: (provider: IntegrationProvider) => Promise<IntegrationPreflightSnapshot>
  readonly t: (key: IntegrationSettingsKey, params?: Record<string, string | number>) => string
}

/** Owner props from the settings shell. */
export interface IntegrationsSectionProps extends IntegrationsSectionInjected {
  close: () => void
}

type ProviderState =
  | { phase: 'loading' }
  | { phase: 'ready'; snapshot: IntegrationPreflightSnapshot }
  | { phase: 'error' }

interface AllState {
  readonly github: ProviderState
  readonly gitlab: ProviderState
  readonly gitee: ProviderState
}

const PROVIDERS = ['github', 'gitlab', 'gitee'] as const

function usePreflight(injected: IntegrationsSectionInjected): {
  state: AllState
  refresh: () => void
} {
  const { check } = injected
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<AllState>(() => ({
    github: { phase: 'loading' },
    gitlab: { phase: 'loading' },
    gitee: { phase: 'loading' },
  }))
  useEffect(() => {
    let current = true
    for (const provider of PROVIDERS) {
      setState(prev => ({ ...prev, [provider]: { phase: 'loading' } }))
      void check(provider).then(
        (snapshot) => { if (current) setState(prev => ({ ...prev, [provider]: { phase: 'ready', snapshot } })) },
        () => { if (current) setState(prev => ({ ...prev, [provider]: { phase: 'error' } })) },
      )
    }
    return () => { current = false }
  }, [check, request])
  return { state, refresh: () => { setRequest(value => value + 1) } }
}

function statusLabel(status: IntegrationStatus, t: IntegrationsSectionInjected['t']): string {
  switch (status) {
    case 'connected': return t('statusConnected')
    case 'not-installed': return t('statusNotInstalled')
    case 'not-authenticated': return t('statusNotAuthenticated')
    case 'not-configured': return t('statusNotConfigured')
    case 'unavailable': return t('statusUnavailable')
    case 'checking': return t('statusChecking')
  }
}

function renderProvider(
  provider: IntegrationProvider,
  state: ProviderState,
  injected: IntegrationsSectionInjected,
): ReactNode {
  const { t } = injected
  const titleKey: Record<IntegrationProvider, IntegrationSettingsKey> = {
    github: 'githubTitle',
    gitlab: 'gitlabTitle',
    gitee: 'giteeTitle',
  }
  const descKey: Record<IntegrationProvider, IntegrationSettingsKey> = {
    github: 'githubDescription',
    gitlab: 'gitlabDescription',
    gitee: 'giteeDescription',
  }
  return (
    <div key={provider} className={css.providerCard} data-provider={provider}>
      <div className={css.providerHeader}>
        <div>
          <h3 className={css.providerTitle}>{t(titleKey[provider])}</h3>
          <p className={css.providerDescription}>{t(descKey[provider])}</p>
        </div>
        {state.phase === 'ready' && (
          <span className={css.badge} data-status={state.snapshot.status}>
            <span className={css.dot} aria-hidden="true" />
            {statusLabel(state.snapshot.status, t)}
          </span>
        )}
        {state.phase === 'loading' && (
          <span className={css.badge} data-status="checking">{t('statusChecking')}</span>
        )}
        {state.phase === 'error' && (
          <span className={css.badge} data-status="unavailable">{t('statusUnavailable')}</span>
        )}
      </div>
      {state.phase === 'ready' && state.snapshot.account !== null && (
        <p className={css.accountLine}>{t('accountLabel')}: <span className={css.accountValue}>{state.snapshot.account}</span></p>
      )}
      {state.phase === 'ready' && state.snapshot.status === 'not-installed' && provider === 'github' && (
        <p className={css.hint}>{t('installPrompt')} <code className={css.code}>winget install GitHub.cli</code></p>
      )}
      {state.phase === 'ready' && state.snapshot.status === 'not-installed' && provider === 'gitlab' && (
        <p className={css.hint}>{t('installPrompt')} <code className={css.code}>winget install GLab.GLab</code></p>
      )}
      {state.phase === 'ready' && state.snapshot.status === 'not-authenticated' && provider !== 'gitee' && (
        <p className={css.hint}>{t('authPrompt')} <code className={css.code}>{provider === 'github' ? 'gh auth login' : 'glab auth login'}</code></p>
      )}
      {state.phase === 'ready' && state.snapshot.status === 'not-configured' && provider === 'gitee' && (
        <p className={css.hint}>{t('tokenPrompt')}</p>
      )}
      {state.phase === 'ready' && state.snapshot.status === 'not-authenticated' && provider === 'gitee' && (
        <p className={css.hint}>{t('tokenPrompt')}</p>
      )}
      {state.phase === 'error' && (
        <p className={css.errorText}>{t('errorText')}</p>
      )}
    </div>
  )
}

/** The Integrations settings section component. */
export function IntegrationsSection(props: IntegrationsSectionProps): ReactNode {
  const { t } = props
  const { state, refresh } = usePreflight(props)
  return (
    <div className={css.section}>
      <div className={css.header}>
        <div>
          <h2 className={css.title}>{t('title')}</h2>
          <p className={css.description}>{t('description')}</p>
        </div>
        <button type="button" className={css.refreshButton} onClick={refresh}>
          <IconRefreshOutline16 size={16} />{t('refreshAll')}
        </button>
      </div>
      <div className={css.providerList}>
        {PROVIDERS.map(provider => renderProvider(provider, state[provider], props))}
      </div>
    </div>
  )
}
