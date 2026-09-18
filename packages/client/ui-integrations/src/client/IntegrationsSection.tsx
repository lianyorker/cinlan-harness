/** Native provider status rows backed by cancellable Host preflight checks. */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, IconLinkOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IntegrationPreflightSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { IntegrationSettingsKey } from './locales.ts'
import css from './IntegrationsSection.module.css'

/** Registration-side callback for real provider tool and authentication checks. */
export interface IntegrationsSectionInjected {
  check: (provider: 'github' | 'gitlab' | 'gitee', signal: AbortSignal) => Promise<IntegrationPreflightSnapshot>
}

/** Standard section owner, locale, and injected shares. */
export type IntegrationsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.integrations'> & InjectFace<IntegrationsSectionInjected>

type Provider = 'github' | 'gitlab' | 'gitee'
type CheckState = { phase: 'checking' } | { phase: 'ready'; snapshot: IntegrationPreflightSnapshot } | { phase: 'error' }
const PROVIDERS = ['github', 'gitlab', 'gitee'] as const
const INITIAL: Record<Provider, CheckState> = { github: { phase: 'checking' }, gitlab: { phase: 'checking' }, gitee: { phase: 'checking' } }

function statusKey(state: CheckState): IntegrationSettingsKey {
  if (state.phase === 'error') return 'statusUnavailable'
  if (state.phase === 'checking') return 'statusChecking'
  const keys = {
    connected: 'statusConnected', checking: 'statusChecking', unavailable: 'statusUnavailable',
    'not-configured': 'statusNotConfigured', 'not-installed': 'statusNotInstalled', 'not-authenticated': 'statusNotAuthenticated',
  } as const satisfies Record<IntegrationPreflightSnapshot['status'], IntegrationSettingsKey>
  return keys[state.snapshot.status]
}

/** Render observed provider status without adding installation or authorization operations. */
export function IntegrationsSection({ check, t }: IntegrationsSectionProps): ReactNode {
  const [states, setStates] = useState<Record<Provider, CheckState>>(INITIAL)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setStates(INITIAL)
    for (const provider of PROVIDERS) {
      void check(provider, controller.signal).then((snapshot) => {
        if (!controller.signal.aborted) setStates(previous => ({ ...previous, [provider]: { phase: 'ready', snapshot } }))
      }, () => {
        if (!controller.signal.aborted) setStates(previous => ({ ...previous, [provider]: { phase: 'error' } }))
      })
    }
    return () => { controller.abort() }
  }, [check, generation])
  const checking = PROVIDERS.some(provider => states[provider].phase === 'checking')

  return <section className={css.section}>
    <header className={css.header}>
      <div className={css.intro}><h1 className={css.title}>{t('title')}</h1><p className={css.description}>{t('description')}</p></div>
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
          </div>
          <span className={css.status} role="status" data-state={status}>{t(statusKey(state))}</span>
        </section>
      })}
    </div>
  </section>
}
