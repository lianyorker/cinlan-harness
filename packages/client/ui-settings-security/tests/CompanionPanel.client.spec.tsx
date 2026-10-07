// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CompanionPanel } from '../src/client/CompanionPanel.tsx'
import { CompanionSection } from '../src/client/CompanionSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(zh, commonZh)

it('opens pairing inside the workbench and returns to the mobile landing', () => {
  render(<CompanionPanel {...{ t } as Parameters<typeof CompanionPanel>[0]} />)
  expect(screen.getByRole('heading', { name: zh.companionLandingTitle })).toBeTruthy()
  expect(screen.queryByText('localhost:5174')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.companionStartPairing }))
  expect(screen.getByRole('button', { name: zh.companionGenerateQr }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('status').textContent).toBe(zh.companionUnavailableHelp)
  fireEvent.click(screen.getByRole('button', { name: zh.companionBack }))
  expect(screen.getByRole('heading', { name: zh.companionLandingTitle })).toBeTruthy()
})

it('does not invent a machine name, a selected transport, or an empty device list without Host data', () => {
  const view = render(<CompanionSection t={t} />)
  expect(screen.getByRole('textbox').getAttribute('value')).toBe('')
  expect(screen.getByRole('textbox').hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('group').hasAttribute('disabled')).toBe(true)
  expect(screen.getByText(zh.companionDevicesUnavailable)).toBeTruthy()
  expect(screen.queryByText(zh.companionNoDevices)).toBeNull()
  expect(view.container.textContent).toMatchSnapshot()
})
