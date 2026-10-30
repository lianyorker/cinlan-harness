// @vitest-environment jsdom
/** Pairing pages show the reminder choice once and preserve an explicit disabled choice. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ManualPairScreen } from '../src/screens/ManualPair/ManualPairScreen'
import { ConnectDesktopScreen } from '../src/screens/ConnectDesktop/ConnectDesktopScreen'
import zh from '../src/locales/zh-CN.json'

vi.mock('../src/context/ThemeLanguageContext', () => ({
  useAppConfig: () => ({
    language: 'zh-CN',
    t: (path: string) => {
      const [group, key] = path.split('.')
      return (zh as Record<string, Record<string, string>>)[group]?.[key] ?? path
    },
    showNotice: vi.fn(),
  }),
}))

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

it('asks once, saves an explicit skip, and continues the manual pairing flow', () => {
  const pair = vi.fn()
  render(<ManualPairScreen onPairSuccess={pair} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '使用配对码连接' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pairing-code' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
  expect(screen.getByRole('dialog', { name: zh.notifications.title })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.skip }))
  expect(localStorage.getItem('cinlan-mobile:notifications-enabled')).toBe('false')
  expect(pair).toHaveBeenCalledWith('pairing-code')
})

it('does not reopen the reminder prompt after an explicit disabled choice', () => {
  localStorage.setItem('cinlan-mobile:notifications-enabled', 'false')
  const pair = vi.fn()
  render(<ManualPairScreen onPairSuccess={pair} onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '使用配对码连接' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pairing-code' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
  expect(screen.queryByRole('dialog', { name: zh.notifications.title })).toBeNull()
  expect(pair).toHaveBeenCalledWith('pairing-code')
})

it('does not prompt when reminders were explicitly enabled', () => {
  localStorage.setItem('cinlan-mobile:notifications-enabled', 'true')
  const pair = vi.fn()
  render(<ManualPairScreen onPairSuccess={pair} onBack={vi.fn()} initialCode="pairing-code" />)
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
  expect(screen.queryByRole('dialog', { name: zh.notifications.title })).toBeNull()
  expect(pair).toHaveBeenCalledWith('pairing-code')
})

it('uses the saved choice on the connection page and prompts only before the first choice', () => {
  const pair = vi.fn()
  const props = {
    onStartPairing: vi.fn(), onOpenManualPair: vi.fn(), onOpenSettings: vi.fn(), onPairSuccess: pair,
  }
  const view = render(<ConnectDesktopScreen {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '使用配对码连接' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pairing-code' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
  expect(screen.getByRole('dialog', { name: zh.notifications.title })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.skip }))
  expect(localStorage.getItem('cinlan-mobile:notifications-enabled')).toBe('false')
  expect(pair).toHaveBeenCalledWith('pairing-code')

  view.unmount()
  pair.mockClear()
  render(<ConnectDesktopScreen {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '使用配对码连接' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next-code' } })
  fireEvent.click(screen.getByRole('button', { name: '保存并连接' }))
  expect(screen.queryByRole('dialog', { name: zh.notifications.title })).toBeNull()
  expect(pair).toHaveBeenCalledWith('next-code')
})
