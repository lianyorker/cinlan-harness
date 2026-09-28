// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {
  AccountAuthorizationAttemptId, AccountAuthorizationMethodId, AccountAuthorizationPromptId,
} from '@deepseek-ai/dsh-api-account-controller/types'
import { AccountSettingsSection } from '../src/client/AccountSettingsSection.tsx'
import { en } from '../src/client/locales.ts'
import type { AccountReadback } from '../src/client/source.ts'
import type { AccountSettingsProps } from '../src/client/types.ts'

const KEY = credentialKey('llm-pi-ai', 'sub2api')
const OTHER_KEY = credentialKey('llm-pi-ai', 'other')
const METHOD = 'password' as AccountAuthorizationMethodId
const ATTEMPT = '11111111-1111-4111-8111-111111111111' as AccountAuthorizationAttemptId
const PROMPT = '22222222-2222-4222-8222-222222222222' as AccountAuthorizationPromptId
const flow = {
  key: KEY,
  label: 'Cinlan account',
  methods: [{ id: METHOD, label: 'Sign in to Cinlan' }],
  inFlight: false,
  credential: { configured: true, kind: 'api-key' as const, writable: true },
}
const ready: AccountReadback = {
  status: 'ready', snapshot: { flows: [flow] }, attempt: null, pendingDeletion: null,
  deletedLocally: null, readError: null, actionError: null,
}

afterEach(cleanup)

function renderAccount(state: AccountReadback) {
  const start = vi.fn(() => true)
  const answer = vi.fn(async () => true)
  const cancel = vi.fn(async () => true)
  const deleteCredential = vi.fn(async () => true)
  const retry = vi.fn()
  const dismissAttempt = vi.fn()
  const clearFeedback = vi.fn()
  const props = {
    t: (key: keyof typeof en, params?: Record<string, unknown>) => {
      const text = en[key]
      return params === undefined ? text : Object.entries(params).reduce<string>(
        (value, [name, replacement]) => value.replaceAll('{' + name + '}', String(replacement)), text)
    },
    useAccount: (selector: (value: AccountReadback) => unknown) => selector(state),
    start, answer, cancel, deleteCredential,
    retry, dismissAttempt, clearFeedback,
  } as unknown as AccountSettingsProps
  return {
    view: render(<AccountSettingsSection {...props} />),
    start, answer, cancel, deleteCredential, retry, dismissAttempt, clearFeedback,
  }
}

describe('AccountSettingsSection', () => {
  it('presents the Cinlan account card and keeps sign-out local', () => {
    const rendered = renderAccount(ready)
    expect(screen.getByRole('heading', { level: 3, name: en.cinlanAccount })).toBeTruthy()
    expect(screen.queryByText(/provider/i)).toBeNull()
    expect(screen.queryByText(/model/i)).toBeNull()
    expect(screen.queryByText(/QR/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))

    const group = screen.getByRole('group', { name: en.confirmTitle })
    expect(group.textContent).toContain('does not revoke access on the Cinlan service')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.keep }))
    expect(screen.queryByRole('group', { name: en.confirmTitle })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.signOut }))
    fireEvent.click(within(screen.getByRole('group', { name: en.confirmTitle })).getByRole('button', { name: en.remove }))
    expect(rendered.deleteCredential).toHaveBeenCalledWith(KEY)
  })

  it('masks a secret prompt and clears its local value after the one-way answer call', async () => {
    const state: AccountReadback = {
      ...ready,
      attempt: {
        key: KEY, attemptId: ATTEMPT, phase: 'running', notices: [], pendingAnswer: false, failure: null,
        prompt: { id: PROMPT, kind: 'secret', message: 'Cinlan account password', autocomplete: 'current-password' },
      },
    }
    const rendered = renderAccount(state)
    const input = screen.getByLabelText('Cinlan account password') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('current-password')
    fireEvent.change(input, { target: { value: 'component-secret' } })
    expect(rendered.view.container.textContent).not.toContain('component-secret')
    fireEvent.click(screen.getByRole('button', { name: en.submit }))
    await waitFor(() => { expect(rendered.answer).toHaveBeenCalledWith(PROMPT, 'component-secret') })
    expect(input.value).toBe('')
  })

  it('submits visible text prompts without password autofill', async () => {
    const rendered = renderAccount({
      ...ready,
      attempt: {
        key: KEY, attemptId: ATTEMPT, phase: 'running', notices: [], pendingAnswer: false, failure: null,
        prompt: { id: PROMPT, kind: 'text', message: 'Email address', placeholder: 'person@example.test', autocomplete: 'username' },
      },
    })
    const input = screen.getByRole('textbox', { name: 'Email address' })
    expect(input.getAttribute('type')).toBe('email')
    expect(input.getAttribute('autocomplete')).toBe('username')
    fireEvent.change(input, { target: { value: 'person@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: en.submit }))
    await waitFor(() => { expect(rendered.answer).toHaveBeenCalledWith(PROMPT, 'person@example.test') })
  })

  it('uses one-time-code autofill semantics for a conditional TOTP prompt', () => {
    renderAccount({
      ...ready,
      attempt: {
        key: KEY, attemptId: ATTEMPT, phase: 'running', notices: [], pendingAnswer: false, failure: null,
        prompt: { id: PROMPT, kind: 'secret', message: 'Verification code', autocomplete: 'one-time-code' },
      },
    })
    const input = screen.getByLabelText('Verification code') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.getAttribute('autocomplete')).toBe('one-time-code')
    expect(input.getAttribute('inputmode')).toBe('numeric')
  })

  it('renders only HTTP(S) notice links even for a forged client snapshot', () => {
    const state: AccountReadback = {
      ...ready,
      attempt: {
        key: KEY, attemptId: ATTEMPT, phase: 'running', prompt: null, pendingAnswer: false, failure: null,
        notices: [
          { message: 'No continuation' },
          { message: 'Malformed continuation', url: 'not a URL' },
          { message: 'Unsafe continuation', url: 'javascript:alert(1)' },
          { message: 'Credential URL', url: 'https://user:pass@accounts.example.test/continue' },
          { message: 'Safe continuation', url: 'https://accounts.example.test/continue', code: 'VERIFY-123' },
        ],
      },
    }
    const rendered = renderAccount(state)
    const links = screen.getAllByRole('link', { name: en.openPage })
    expect(links).toHaveLength(1)
    expect(links[0]?.getAttribute('href')).toBe('https://accounts.example.test/continue')
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(screen.getByText('VERIFY-123')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(rendered.cancel).toHaveBeenCalledOnce()
  })

  it('renders connection states and only exposes the Cinlan account flow', () => {
    const loading = renderAccount({ ...ready, status: 'loading', snapshot: null })
    expect(screen.getByRole('status').textContent).toContain(en.loading)
    loading.view.unmount()

    const offline = renderAccount({ ...ready, status: 'offline', snapshot: null })
    expect(screen.getByRole('status').textContent).toContain(en.offline)
    offline.view.unmount()

    const error = renderAccount({ ...ready, status: 'error', snapshot: null, readError: 'network' })
    expect(screen.getByRole('alert').textContent).toContain(en.unavailable)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(error.retry).toHaveBeenCalledOnce()
    error.view.unmount()

    const staleError = renderAccount({ ...ready, status: 'error', readError: 'network' })
    expect(screen.queryByRole('button', { name: en.signInAgain })).toBeNull()
    expect(screen.queryByRole('button', { name: en.signOut })).toBeNull()
    staleError.view.unmount()

    const empty = renderAccount({ ...ready, snapshot: { flows: [] } })
    expect(screen.getByText(en.empty)).toBeTruthy()
    empty.view.unmount()

    const hidden = renderAccount({
      ...ready,
      snapshot: { flows: [{ ...flow, key: OTHER_KEY }] },
    })
    expect(screen.getByText(en.empty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.signIn })).toBeNull()
    hidden.view.unmount()

    const available = renderAccount({
      ...ready,
      snapshot: { flows: [{ ...flow, credential: { configured: false, writable: true } }] },
    })
    fireEvent.click(screen.getByRole('button', { name: en.signIn }))
    expect(available.start).toHaveBeenCalledWith(KEY, METHOD)
    available.view.unmount()

    renderAccount({
      ...ready,
      snapshot: { flows: [{ ...flow, inFlight: true }] },
      pendingDeletion: KEY,
    })
    expect(screen.getByText(en.inProgress)).toBeTruthy()
    const loginButton = screen.getByRole('button', { name: en.signInAgain })
    expect(loginButton instanceof HTMLButtonElement && loginButton.disabled).toBe(true)
    const removeButton = screen.getByRole('button', { name: en.deleting })
    expect(removeButton instanceof HTMLButtonElement && removeButton.disabled).toBe(true)
  })

  it('drives select prompts and prevents empty or pending submissions', async () => {
    const state: AccountReadback = {
      ...ready,
      attempt: {
        key: KEY, attemptId: ATTEMPT, phase: 'running', pendingAnswer: false, failure: null, notices: [],
        prompt: {
          id: PROMPT, kind: 'select', message: 'Choose account', options: [
            { id: 'first', label: 'First option' },
            { id: 'second', label: 'Second option', description: 'With details' },
          ],
        },
      },
    }
    const rendered = renderAccount(state)
    const select = screen.getByLabelText('Choose account') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'Second option - With details' })).toBeTruthy()
    const submitButton = screen.getByRole('button', { name: en.submit })
    expect(submitButton instanceof HTMLButtonElement && submitButton.disabled).toBe(true)
    const form = select.closest('form')
    if (form === null) throw new Error('select prompt has no form')
    fireEvent.submit(form)
    expect(rendered.answer).not.toHaveBeenCalled()
    fireEvent.change(select, { target: { value: 'second' } })
    fireEvent.submit(form)
    await waitFor(() => { expect(rendered.answer).toHaveBeenCalledWith(PROMPT, 'second') })
    rendered.view.unmount()

    const pending = renderAccount({
      ...state,
      attempt: { ...state.attempt!, pendingAnswer: true, prompt: { id: PROMPT, kind: 'secret', message: 'Password' } },
    })
    const input = screen.getByLabelText('Password') as HTMLInputElement
    expect(input.disabled).toBe(true)
    const pendingForm = input.closest('form')
    if (pendingForm === null) throw new Error('secret prompt has no form')
    fireEvent.submit(pendingForm)
    expect(pending.answer).not.toHaveBeenCalled()
  })

  it('renders action and authorization failures with dismiss controls', () => {
    const state: AccountReadback = {
      ...ready,
      deletedLocally: KEY,
      actionError: 'network',
      attempt: {
        key: OTHER_KEY, attemptId: ATTEMPT, phase: 'failed', pendingAnswer: false, failure: 'rejected',
        prompt: null, notices: [],
      },
    }
    const rendered = renderAccount(state)
    expect(screen.getByText(en.deletedLocal)).toBeTruthy()
    expect(screen.getByText(en['error.network'])).toBeTruthy()
    expect(screen.getByText(en['error.rejected'])).toBeTruthy()
    const dismiss = screen.getAllByRole('button', { name: en.dismiss })
    expect(dismiss).toHaveLength(3)
    fireEvent.click(dismiss[0]!)
    fireEvent.click(dismiss[1]!)
    fireEvent.click(dismiss[2]!)
    expect(rendered.clearFeedback).toHaveBeenCalledTimes(2)
    expect(rendered.dismissAttempt).toHaveBeenCalledOnce()
  })
})
