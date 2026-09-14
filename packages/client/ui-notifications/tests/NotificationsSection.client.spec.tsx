// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { NotificationSettings } from '@deepseek-ai/dsh-notifications/types'
import { NotificationsSection } from '../src/client/NotificationsSection.tsx'
import type { NotificationsSectionProps } from '../src/client/NotificationsSection.tsx'
import { en, type NotificationsKey } from '../src/client/locales.ts'
import type { NotificationRuntimeFace } from '../src/client/runtime.ts'

const settingsValue: NotificationSettings = {
  enabled: false, agentCompletion: false, terminalBell: false,
  sound: 'system', suppressWhenFocused: false, customSoundName: '',
}
function scope(): SettingsScope<NotificationSettings> {
  const snapshot: SettingsScopeSnapshot<NotificationSettings> = {
    status: 'ready', value: settingsValue, base: undefined, user: undefined,
    revision: 0, writable: true, mode: 'host',
  }
  return {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    mutate: vi.fn(() => Promise.resolve()),
    set: vi.fn(() => Promise.resolve()),
    unset: vi.fn(() => Promise.resolve()),
  }
}
function runtime(): NotificationRuntimeFace {
  return {
    notify: vi.fn(() => Promise.resolve(true)),
    test: vi.fn(() => Promise.resolve(true)),
    registerCustomSound: vi.fn(),
    dispose: vi.fn(),
  }
}
function props(): NotificationsSectionProps {
  return {
    close: vi.fn(),
    t: (key: NotificationsKey) => en[key],
    settings: scope(),
    runtime: runtime(),
  } as unknown as NotificationsSectionProps
}

afterEach(cleanup)

describe('NotificationsSection', () => {
  it('matches the settings screenshot structure and labels', () => {
    render(<NotificationsSection {...props()} />)
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Enable notifications' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Agent task completed' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Terminal bell' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Suppress while focused' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send test notification' })).toBeTruthy()
  })

  it('keeps dependent controls disabled until notifications are enabled', () => {
    render(<NotificationsSection {...props()} />)
    expect((screen.getByRole('switch', { name: 'Agent task completed' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('switch', { name: 'Terminal bell' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Notification sound' }) as HTMLSelectElement).disabled).toBe(true)
  })
})
