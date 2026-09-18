// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MobilePreferences } from '../src/client/MobilePreferences.tsx'
import { en } from '../src/client/locales.ts'
import type { CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'

afterEach(cleanup)

function bench(writable = true) {
  const snapshot: SettingsScopeSnapshot<MobileDeviceSettings> = { status: 'ready', mode: 'host', writable, revision: 7,
    value: { enabled: false, androidSdkPath: 'stored-path', defaultDeviceId: 'missing-device' }, base: {}, user: {} }
  const save = vi.fn<CapabilitySectionProps['saveMobileSettings']>(async (value) => { snapshot.value = value; snapshot.revision = 8 })
  const reset = vi.fn<CapabilitySectionProps['resetMobileSettings']>(async () => {
    snapshot.value = { enabled: false, androidSdkPath: '', defaultDeviceId: '' }; snapshot.revision = 9
  })
  const checkSdk = vi.fn<CapabilitySectionProps['checkSdk']>(async () => ({ platform: 'linux', android: { found: false, sdkPath: null, message: '' }, ios: null }))
  const listMobileDevices = vi.fn<CapabilitySectionProps['listMobileDevices']>(async () => ({ available: false, devices: [] }))
  const props = { useMobileSettings: selector => selector(snapshot), saveMobileSettings: save, resetMobileSettings: reset,
    checkSdk, listMobileDevices, t: makeTranslate(en, commonEn) } satisfies Parameters<typeof MobilePreferences>[0]
  const view = render(<MobilePreferences {...props} />)
  return { ...view, props, snapshot, save, reset, checkSdk, listMobileDevices }
}

describe('Native mobile preferences', () => {
  it('keeps unavailable saved devices visible and saves the draft opening revision', async () => {
    const b = bench()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.mobileDefaultDevice }).value).toBe('missing-device')
    expect(screen.getByRole('option', { name: en.mobileSavedDeviceUnavailable })).toBeTruthy()
    expect(screen.getByText(en.mobilePreferenceConsumers)).toBeTruthy()
    expect(screen.getByText(en.mobileSdkPathHelp)).toBeTruthy()
    expect(screen.getByText(en.mobileDefaultDeviceDescription)).toBeTruthy()
    expect(b.checkSdk).not.toHaveBeenCalled()
    expect(b.listMobileDevices).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: en.mobileSdkCustomPath }), { target: { value: 'new-path' } })
    b.snapshot.revision = 10
    b.rerender(<MobilePreferences {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledWith({ enabled: false, androidSdkPath: 'new-path', defaultDeviceId: 'missing-device' }, 7)
    expect(b.checkSdk).not.toHaveBeenCalled()
    expect(b.listMobileDevices).not.toHaveBeenCalled()
  })

  it('shows a saved offline device without replacing it or checking devices on draft edits', async () => {
    const b = bench()
    b.listMobileDevices.mockResolvedValue({ available: true, devices: [
      { id: 'missing-device', name: 'Saved device', state: 'offline', isAvailable: false },
      { id: 'other-device', name: 'Another device', state: 'online', isAvailable: true },
    ] })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    await screen.findByRole('option', { name: 'Saved device' })
    expect(screen.getByRole<HTMLOptionElement>('option', { name: 'Saved device' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.mobileDefaultDevice }).value).toBe('missing-device')
    fireEvent.change(screen.getByRole('combobox', { name: en.mobileDefaultDevice }), { target: { value: 'other-device' } })
    expect(b.save).not.toHaveBeenCalled()
    expect(b.checkSdk).toHaveBeenCalledOnce()
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledWith({ enabled: false, androidSdkPath: 'stored-path', defaultDeviceId: 'other-device' }, 7)
    expect(b.checkSdk).toHaveBeenCalledOnce()
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
  })

  it('preserves a rejected draft and reloads Host defaults only after a successful reset', async () => {
    const b = bench()
    b.save.mockRejectedValueOnce(new Error('conflict'))
    fireEvent.change(screen.getByRole('textbox', { name: en.mobileSdkCustomPath }), { target: { value: 'new-path' } })
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('new-path')
    b.reset.mockRejectedValueOnce(new Error('disconnected'))
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await waitFor(() => { expect(b.reset).toHaveBeenCalledOnce() })
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('new-path')
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('')
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.mobileDefaultDevice }).value).toBe('')
  })

  it('does not write or reset on a read-only connection', () => {
    const b = bench(false)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    expect(b.save).not.toHaveBeenCalled()
    expect(b.reset).not.toHaveBeenCalled()
    expect(screen.getByText(en.preferencesReadOnly)).toBeTruthy()
  })

  it('reports SDK and device failures independently and retries without saving preferences', async () => {
    const b = bench()
    b.checkSdk.mockRejectedValueOnce(new Error('host unavailable'))
    b.listMobileDevices.mockRejectedValueOnce(new Error('device unavailable'))
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    await screen.findByText(en.mobileSdkFailed)
    await screen.findByText(en.mobileDevicesFailed)
    b.checkSdk.mockResolvedValueOnce({ platform: 'darwin',
      android: { found: false, sdkPath: '/installed/sdk', message: 'adb permission denied' },
      ios: { simctlOk: false, message: 'simctl timed out' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    await screen.findByText('Android SDK check did not succeed. Check the SDK path, tools, and permissions.')
    await screen.findByText('iOS Simulator check did not succeed. Check Xcode tools and permissions.')
    expect(screen.getByRole('link', { name: en.mobileSdkDownload }).getAttribute('href')).toBe('https://developer.android.com/studio')
    await screen.findByText(en.deviceProviderUnavailable)
    expect(b.save).not.toHaveBeenCalled()
    expect(screen.queryByText(en.mobileSdkFailed)).toBeNull()
    expect(screen.queryByText(en.mobileDevicesFailed)).toBeNull()
  })

  it('cancels pending checks when the settings view unmounts', async () => {
    const b = bench()
    let sdkSignal: AbortSignal | undefined
    let deviceSignal: AbortSignal | undefined
    b.checkSdk.mockImplementation((signal) => { sdkSignal = signal; return new Promise(() => {}) })
    b.listMobileDevices.mockImplementation((signal) => { deviceSignal = signal; return new Promise(() => {}) })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(sdkSignal?.aborted).toBe(false)
    expect(deviceSignal?.aborted).toBe(false)
    b.unmount()
    expect(sdkSignal?.aborted).toBe(true)
    expect(deviceSignal?.aborted).toBe(true)
  })
  it('runs automatic checks only after the Host accepts the page-check preference', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('switch', { name: en.mobileEnable }))
    expect(b.checkSdk).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    await screen.findByText(en.mobilePreferencesSaved)
    await waitFor(() => { expect(b.checkSdk).toHaveBeenCalledOnce() })
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
  })
  it('keeps field targets visible when the Host settings namespace is unavailable', () => {
    const b = bench()
    b.snapshot.status = 'unavailable'
    b.snapshot.value = undefined
    b.rerender(<MobilePreferences {...b.props} />)
    expect(screen.getAllByText(en.preferencesUnavailable).length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(b.container.querySelector('[data-settings-anchor="mobile-sdk-path"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    expect(b.reset).not.toHaveBeenCalled()
  })

})
