// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IntegrationsSection, type IntegrationsSectionProps, type IntegrationsSectionInjected } from '../src/client/IntegrationsSection.tsx'
import { en, zh, type IntegrationSettingsKey } from '../src/client/locales.ts'

afterEach(cleanup)
const translate = (dictionary: typeof en): IntegrationsSectionProps['t'] =>
  ((key: IntegrationSettingsKey, params?: Record<string, unknown>) => {
    const template: string = dictionary[key]
    if (params === undefined) return template
    return Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), template)
  }) as IntegrationsSectionProps['t']
const reportedBudget = { state: 'reported' as const, reason: null, remaining: 42, limit: 5000, resetsAt: null }
const noBudget: IntegrationsSectionInjected['budget'] = async provider => ({ provider, ...reportedBudget })
function setup(check: IntegrationsSectionInjected['check'], dictionary = en, budget = noBudget) {
  return render(<IntegrationsSection {...{ check, budget, t: translate(dictionary) } as IntegrationsSectionProps} />)
}
const connected: Awaited<ReturnType<IntegrationsSectionInjected['check']>> = {
  provider: 'github', status: 'connected', reason: 'connected', account: 'fixture-account',
}

describe('Integrations API budget rows', () => {
  it('shows reported counts with the reset instant and never a fabricated quota', async () => {
    setup(
      async provider => ({ provider, status: 'connected', reason: 'connected', account: null }),
      en,
      async provider => provider === 'github'
        ? { provider, state: 'reported', reason: null, remaining: 42, limit: 5000, resetsAt: '2026-10-14T16:30:00.000Z' }
        : { provider, state: 'unsupported', reason: 'budget-unsupported', remaining: null, limit: null, resetsAt: null },
    )
    await screen.findAllByText(en.statusConnected)
    expect(screen.getByText(en.budgetRemaining.replace('{remaining}', '42').replace('{limit}', '5000'))).toBeTruthy()
    expect(screen.getByText(en.budgetResets.replace('{time}', new Date('2026-10-14T16:30:00.000Z').toLocaleString()))).toBeTruthy()
    // Gitee exposes no quota: the row says so instead of showing zero.
    expect(screen.getAllByText(en.budgetUnsupported)).toHaveLength(2)
  })

  it('distinguishes an unreadable budget from a provider that reported none', async () => {
    setup(
      async provider => ({ provider, status: 'connected', reason: 'connected', account: null }),
      en,
      async provider => provider === 'github'
        ? { provider, state: 'unavailable', reason: 'cli-not-found', remaining: null, limit: null, resetsAt: null }
        : { provider, state: 'not-reported', reason: 'no-rate-limit-data', remaining: null, limit: null, resetsAt: null },
    )
    await screen.findAllByText(en.statusConnected)
    expect(screen.getByText(en.budgetUnavailable)).toBeTruthy()
    expect(screen.getAllByText(en.budgetNotReported)).toHaveLength(2)
    expect(screen.queryByText(en.budgetUnsupported)).toBeNull()
  })
})

describe('Integrations native provider rows', () => {
  it('renders real independent statuses, public search anchors, and provider-specific instructions', async () => {
    const check = vi.fn<IntegrationsSectionInjected['check']>(async (provider) => {
      if (provider === 'github') return connected
      if (provider === 'gitlab') return { provider, status: 'not-installed', reason: 'cli-not-found', account: null }
      return { provider, status: 'not-configured', reason: 'token-not-set', account: null }
    })
    const view = setup(check)
    await screen.findByText(en.statusConnected)
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual(['GitHub', 'GitLab', 'Gitee'])
    expect(screen.getByText('fixture-account', { exact: false })).toBeTruthy()
    expect(screen.getByText(en.statusNotInstalled)).toBeTruthy()
    expect(screen.getByText(en.gitlabInstallCommand)).toBeTruthy()
    expect(screen.getByText(en.tokenPrompt)).toBeTruthy()
    expect(view.container.querySelectorAll('[data-settings-anchor]')).toHaveLength(4)
    expect(check.mock.calls.map(([provider]) => provider)).toEqual(['github', 'gitlab', 'gitee'])
  })

  it('keeps failed checks distinct from unconfigured providers and retries through Refresh all', async () => {
    const check = vi.fn<IntegrationsSectionInjected['check']>().mockRejectedValue(new Error('private failure'))
    setup(check, zh)
    expect(await screen.findAllByRole('alert')).toHaveLength(3)
    expect(screen.queryByText('private failure')).toBeNull()
    expect(screen.queryByText(zh.statusNotConfigured)).toBeNull()
    check.mockImplementation(async provider => ({ ...connected, provider }))
    fireEvent.click(screen.getByRole('button', { name: zh.refreshAll }))
    expect(await screen.findAllByText(zh.statusConnected)).toHaveLength(3)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('preserves authentication and unavailable statuses without treating token presence as connected', async () => {
    setup(async provider => provider === 'gitee'
      ? { provider, status: 'not-authenticated', reason: 'token-invalid', account: null }
      : { provider, status: 'unavailable', reason: 'probe-failed', account: null })
    const gitee = screen.getByRole('region', { name: en.giteeTitle })
    await within(gitee).findByText(en.statusNotAuthenticated)
    expect(within(gitee).getByText(en.tokenPrompt)).toBeTruthy()
    expect(screen.getAllByText(en.statusUnavailable)).toHaveLength(2)
    expect(screen.queryByText(en.statusConnected)).toBeNull()
  })

  it('aborts retired checks and rejects their late results after a new check source mounts', async () => {
    const pending: Array<{ signal: AbortSignal; resolve: (value: typeof connected) => void }> = []
    const first: IntegrationsSectionInjected['check'] = (_provider, signal) => new Promise((resolve) => {
      pending.push({ signal, resolve })
    })
    const view = setup(first)
    expect(screen.getByRole('button', { name: en.refreshAll })).toHaveProperty('disabled', true)
    const next = vi.fn<IntegrationsSectionInjected['check']>(async provider => ({
      provider, status: 'not-installed', reason: 'cli-not-found', account: null,
    }))
    view.rerender(<IntegrationsSection {...{ check: next, budget: noBudget, t: translate(en) } as IntegrationsSectionProps} />)
    expect(pending.every(request => request.signal.aborted)).toBe(true)
    await screen.findAllByText(en.statusNotInstalled)
    await act(async () => { for (const request of pending) request.resolve(connected) })
    expect(screen.queryByText(en.statusConnected)).toBeNull()
    const signals = next.mock.calls.map(([, signal]) => signal)
    view.unmount()
    expect(signals.every(signal => signal.aborted)).toBe(true)
  })
})
