// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CompanionPanel } from '../src/client/CompanionPanel.tsx'
import { CompanionSection } from '../src/client/CompanionSection.tsx'
import type { CompanionApi } from '../src/client/companion-api.ts'
import { AdminStateSchema } from '@cinlan/mobile-relay/protocol'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})
const t = makeTranslate(zh, commonZh)
function api(): CompanionApi {
  const state = AdminStateSchema.parse({ hostId: 'host', settings: { name: 'Desktop', mode: 'local' }, addresses: ['192.168.1.2'], port: 3081, devices: [], relayStatus: 'offline', regions: [] })
  return {
    state: vi.fn(async () => state), save: vi.fn(async settings => ({ ...state, settings })),
    pair: vi.fn(async () => ({ pairingUrl: 'cinlan://pair?code=host-issued-offer', expiresAt: Date.now() + 60000 })),
    revoke: vi.fn(async () => {}),
  }
}

it('opens pairing inside the workbench and generates a Cinlan link', async () => {
  const backend = api()
  render(<CompanionPanel {...{ t, api: backend } as Parameters<typeof CompanionPanel>[0]} />)
  expect(screen.getByRole('heading', { name: zh.companionGetAppTitle })).toBeTruthy()
  expect(screen.queryByText('localhost:5174')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.companionContinue }))
  await waitFor(() => expect(screen.getByRole('button', { name: zh.companionGenerateQr }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: zh.companionGenerateQr }))
  expect(await screen.findByRole('textbox', { name: zh.companionPairLink })).toHaveProperty('value', expect.stringMatching(/^cinlan:\/\/pair\?/u))
  const qr = await screen.findByRole('img', { name: zh.companionQrCode })
  expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/u)
  expect(backend.pair).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: zh.companionBack }))
  expect(screen.getByRole('heading', { name: zh.companionGetAppTitle })).toBeTruthy()
})

it('keeps three single-select modes and autosaves text on blur', async () => {
  const backend = api()
  const view = render(<CompanionSection t={t} api={backend} />)
  const name = screen.getByRole('textbox', { name: zh.companionHostName })
  await waitFor(() => expect(name).toHaveProperty('disabled', false))
  expect(screen.getByRole('textbox', { name: zh.companionHostName })).toHaveProperty('disabled', false)
  expect(screen.getByRole('switch', { name: zh.companionWorkspaceVisible }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('group')).toHaveProperty('disabled', false)
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  expect(screen.getAllByRole<HTMLInputElement>('radio')[0]).toHaveProperty('checked', true)
  expect(screen.getByText(zh.companionNoDevices)).toBeTruthy()
  expect(view.container.textContent).toMatchSnapshot()
  fireEvent.change(name, { target: { value: 'New desktop' } })
  expect(backend.save).not.toHaveBeenCalled()
  fireEvent.blur(name)
  await waitFor(() => expect(backend.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New desktop' })))
})

it('restores confirmed settings when autosave fails', async () => {
  const backend = api(); backend.save = vi.fn(async () => { throw new Error('offline') })
  render(<CompanionSection t={t} api={backend} />)
  const name = screen.getByRole('textbox', { name: zh.companionHostName })
  await waitFor(() => expect(name).toHaveProperty('value', 'Desktop'))
  fireEvent.change(name, { target: { value: 'Not saved' } }); fireEvent.blur(name)
  await screen.findByRole('alert')
  expect(name).toHaveProperty('value', 'Desktop')
})

it('does not invent a pairing link without the Host API', () => {
  render(<CompanionSection t={t} />)
  expect(screen.getByRole('button', { name: zh.companionGenerateQr })).toHaveProperty('disabled', true)
  expect(screen.queryByRole('textbox', { name: zh.companionPairLink })).toBeNull()
})

it('persists whether the Mobile entry is shown in the workspace', () => {
  render(<CompanionSection t={t} />)
  const toggle = screen.getByRole('switch', { name: zh.companionWorkspaceVisible })
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  expect(localStorage.getItem('cinlan-companion:visible')).toBe('false')
})
