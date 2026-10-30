// @vitest-environment jsdom
/** Notification controls drive real local preferences and never claim system push delivery. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { NotificationsSettingsScreen } from '../src/screens/Settings/NotificationsSettingsScreen'
import { VoiceSettingsScreen } from '../src/screens/Settings/VoiceSettingsScreen'
import { NotificationsScreen } from '../src/screens/Notifications/NotificationsScreen'
import { EnableNotificationModal } from '../src/components/EnableNotificationModal'
import zh from '../src/locales/zh-CN.json'
import en from '../src/locales/en-US.json'

let language: 'zh-CN' | 'en-US' = 'zh-CN'
const notice = vi.fn()
const translate = (key: string): string => {
  const [group, item] = key.split('.')
  const dictionary: Record<string, Record<string, string>> = language === 'zh-CN' ? zh : en
  return dictionary[group]?.[item] ?? key
}
vi.mock('../src/context/ThemeLanguageContext', () => ({
  useAppConfig: () => ({ language, t: translate, showNotice: notice }),
}))
beforeEach(() => { language = 'zh-CN' })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear() })

it.each(['zh-CN', 'en-US'] as const)('describes online-only reminders and unavailable dictation in %s', (locale) => {
  language = locale
  const view = render(<NotificationsSettingsScreen onBack={vi.fn()} />)
  expect(screen.getAllByRole('switch')).toHaveLength(2)
  expect(view.container.textContent).toMatchSnapshot('notification-settings')
  view.rerender(<VoiceSettingsScreen onBack={vi.fn()} />)
  expect(screen.queryByRole('switch')).toBeNull()
  expect(view.container.textContent).toMatchSnapshot('voice-settings')
})

it('persists mute and enable controls and shows a real in-app test reminder', () => {
  render(<NotificationsSettingsScreen onBack={vi.fn()} />)
  fireEvent.click(screen.getByRole('switch', { name: zh.notifications.focused }))
  expect(localStorage.getItem('cinlan-mobile:notifications-focused')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.test }))
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ message: zh.notifications.test_message }))
  fireEvent.click(screen.getByRole('switch', { name: zh.notifications.enabled }))
  expect(localStorage.getItem('cinlan-mobile:notifications-enabled')).toBe('false')
  expect(screen.getByRole('switch', { name: zh.notifications.focused })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: zh.notifications.test })).toHaveProperty('disabled', true)
})

it('keeps the accepted preference when storage rejects a write', () => {
  render(<NotificationsSettingsScreen onBack={vi.fn()} />)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable') })
  fireEvent.click(screen.getByRole('switch', { name: zh.notifications.enabled }))
  expect(screen.getByRole('switch', { name: zh.notifications.enabled }).getAttribute('aria-checked')).toBe('true')
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ message: zh.notifications.save_failed }))
})

it.each(['screen', 'modal'])('enables %s reminders without requesting system notification permission', (kind) => {
  const requestPermission = vi.fn()
  vi.stubGlobal('Notification', { permission: 'denied', requestPermission })
  const enabled = vi.fn()
  render(kind === 'screen'
    ? <NotificationsScreen onEnableNotifications={enabled} onSkip={vi.fn()} />
    : <EnableNotificationModal isOpen onEnable={enabled} onClose={vi.fn()} onSkip={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.enable }))
  expect(localStorage.getItem('cinlan-mobile:notifications-enabled')).toBe('true')
  expect(enabled).toHaveBeenCalledOnce()
  expect(requestPermission).not.toHaveBeenCalled()
})

it('does not read or overwrite unused legacy voice and notification preferences', () => {
  const keys = ['cinlan-mobile:voice-enabled', 'cinlan-mobile:voice-mode', 'cinlan-mobile:notifications-away', 'cinlan-mobile:notifications-sound']
  for (const key of keys) localStorage.setItem(key, 'retained')
  const view = render(<VoiceSettingsScreen onBack={vi.fn()} />)
  view.rerender(<NotificationsSettingsScreen onBack={vi.fn()} />)
  expect(keys.map(key => localStorage.getItem(key))).toEqual(keys.map(() => 'retained'))
})

it.each(['screen', 'modal'])('persists declining %s reminders and keeps the prompt open when saving fails', (kind) => {
  const skipped = vi.fn()
  render(kind === 'screen'
    ? <NotificationsScreen onEnableNotifications={vi.fn()} onSkip={skipped} />
    : <EnableNotificationModal isOpen onEnable={vi.fn()} onClose={vi.fn()} onSkip={skipped} />)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage unavailable') })
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.skip }))
  expect(skipped).not.toHaveBeenCalled()
  expect(notice).toHaveBeenCalledWith(expect.objectContaining({ message: zh.notifications.save_failed }))
  fireEvent.click(screen.getByRole('button', { name: zh.notifications.skip }))
  expect(localStorage.getItem('cinlan-mobile:notifications-enabled')).toBe('false')
  expect(skipped).toHaveBeenCalledOnce()
})

it('closes the notification modal on Escape and restores focus to the opener', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const close = vi.fn()
  render(<EnableNotificationModal isOpen onEnable={vi.fn()} onClose={close} onSkip={vi.fn()} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: zh.notifications.dismiss }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  cleanup()
  expect(document.activeElement).toBe(opener)
  opener.remove()
})

it('keeps Tab focus inside the notification modal', () => {
  render(<EnableNotificationModal isOpen onEnable={vi.fn()} onClose={vi.fn()} onSkip={vi.fn()} />)
  const controls = screen.getAllByRole('button')
  controls.at(-1)?.focus()
  const event = createEvent.keyDown(document, { key: 'Tab' })
  fireEvent(document, event)
  expect(event.defaultPrevented).toBe(true)
  expect(document.activeElement).toBe(controls[0])
})
