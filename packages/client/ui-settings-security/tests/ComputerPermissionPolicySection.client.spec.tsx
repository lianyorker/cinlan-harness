// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComputerPermissionStatus } from '@deepseek-ai/dsh-computer-use/types'
import { COMPUTER_CAPABILITY } from '../src/client/CapabilitySection.tsx'
import { ComputerPermissionPolicySection, type ComputerPermissionPolicySectionProps, type ComputerUsePermissionSettings } from '../src/client/ComputerPermissionPolicySection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

function mount(language: 'en' | 'zh' = 'en', writable = true) {
  const snapshot: SettingsScopeSnapshot<ComputerUsePermissionSettings> = {
    status: 'ready', mode: 'host', writable, revision: 4, base: undefined, user: undefined,
    value: { native: 'ask', observe: 'ask', pointer: 'ask', keyboard: 'ask', accessibilityAction: 'ask' },
  }
  const permissionSettings = {
    getSnapshot: () => snapshot, subscribe: () => () => {},
    set: vi.fn(async () => {}), mutate: vi.fn(async () => true), unset: vi.fn(async () => {}),
  } as unknown as SettingsScope<ComputerUsePermissionSettings>
  let osPermissionStatus: ComputerPermissionStatus = { kind: 'unsupported', platform: 'win32' }
  const osPermissions = {
    read: vi.fn(async () => osPermissionStatus),
    request: vi.fn(async () => osPermissionStatus),
    openScreenRecordingSettings: vi.fn(async () => true),
  }
  const props = {
    definition: COMPUTER_CAPABILITY, permissionSettings,
    osPermissions,
    hooks: { permissionSettings },
    usePermissionSettings: (selector: (value: typeof snapshot) => unknown) => selector(snapshot),
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
  } as unknown as ComputerPermissionPolicySectionProps
  return {
    ...render(<ComputerPermissionPolicySection {...props} />), permissionSettings, osPermissions,
    setOsPermissionStatus: (status: ComputerPermissionStatus) => { osPermissionStatus = status },
  }
}

describe('Computer Use permission policy settings', () => {
  it('renders five decisions and persists a changed decision through its scope', () => {
    const view = mount()
    expect(screen.getAllByRole('combobox')).toHaveLength(5)
    fireEvent.change(screen.getByRole('combobox', { name: en.computerPermissionPointer }), { target: { value: 'deny' } })
    expect(view.permissionSettings.set).toHaveBeenCalledWith('pointer', 'deny')
  })

  it('disables edits on read-only connections', () => {
    mount('en', false)
    expect(screen.getAllByRole('combobox').every(control => (control as HTMLSelectElement).disabled)).toBe(true)
  })

  it('reports a rejected policy write', async () => {
    const view = mount()
    vi.mocked(view.permissionSettings.set).mockRejectedValueOnce(new Error('conflict'))
    fireEvent.change(screen.getByRole('combobox', { name: en.computerPermissionKeyboard }), { target: { value: 'allow' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.computerPermissionSaveFailed)
  })

  it('renders the policy controls in Chinese', () => {
    mount('zh')
    expect(screen.getByRole('heading', { name: zh.computerPolicyTitle })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: zh.computerPermissionNative })).toBeTruthy()
  })

  it('shows unsupported platforms and exposes explicit macOS permission operations', async () => {
    const view = mount()
    expect(await screen.findByText(en.computerOsPermissionUnsupported)).toBeTruthy()
    view.setOsPermissionStatus({ kind: 'macos', accessibility: false, screenRecording: false })
    fireEvent.click(screen.getByRole('button', { name: en.computerOsPermissionRefresh }))
    expect(await screen.findAllByText(en.computerOsPermissionMissing)).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: en.computerOsPermissionRequest }))
    await vi.waitFor(() => expect(view.osPermissions.request).toHaveBeenCalledTimes(1))
    const settingsButton = screen.getByRole('button', { name: en.computerOsScreenRecordingSettings })
    await vi.waitFor(() => expect((settingsButton as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(settingsButton)
    await vi.waitFor(() => expect(view.osPermissions.openScreenRecordingSettings).toHaveBeenCalledTimes(1))
  })
})
