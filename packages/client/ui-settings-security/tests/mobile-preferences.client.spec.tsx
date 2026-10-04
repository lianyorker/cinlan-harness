// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { MobilePreferences } from '../src/client/MobilePreferences.tsx'
import { en } from '../src/client/locales.ts'
import type { MobileSectionInjected } from '../src/client/CapabilitySection.tsx'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { MobileDeviceListSnapshot, MobileSdkSnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'

afterEach(cleanup)

function bench(writable = true) {
  const snapshot: SettingsScopeSnapshot<MobileDeviceSettings> = { status: 'ready', mode: 'host', writable, revision: 7,
    value: { enabled: false, androidSdkPath: 'stored-path', defaultDeviceId: 'missing-device' }, base: {}, user: {} }
  const save = vi.fn<MobileSectionInjected['saveMobileSettings']>(async (value) => { snapshot.value = value; snapshot.revision = 8 })
  const reset = vi.fn<MobileSectionInjected['resetMobileSettings']>(async () => {
    snapshot.value = { enabled: false, androidSdkPath: '', defaultDeviceId: '' }; snapshot.revision = 9
  })
  const checkSdk = vi.fn<MobileSectionInjected['checkSdk']>(async () => ({ platform: 'linux', android: { found: false, sdkPath: null, message: '' }, ios: null }))
  const listMobileDevices = vi.fn<MobileSectionInjected['listMobileDevices']>(async () => ({ available: false, devices: [] }))
  const refreshDevice = vi.fn()
  const availability = { status: 'not-configured' as const, statusKey: 'deviceNotConfigured' as const,
    reason: 'No device provider is mounted for this profile.', checking: false, onRefresh: refreshDevice }
  const props = { useMobileSettings: selector => selector(snapshot), saveMobileSettings: save, resetMobileSettings: reset,
    checkSdk, listMobileDevices, availability, t: makeTranslate(en, commonEn) } satisfies Parameters<typeof MobilePreferences>[0]
  const view = render(<MobilePreferences {...props} />)
  return { ...view, props, snapshot, save, reset, checkSdk, listMobileDevices, refreshDevice }
}

describe('Native mobile preferences', () => {
  it('keeps unavailable saved devices visible and saves the draft opening revision', async () => {
    const b = bench()
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.mobileDefaultDevice }).value).toBe('missing-device')
    expect(screen.getByRole('option', { name: en.mobileSavedDeviceUnavailable })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
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
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    await screen.findByText(en.mobileSdkFailed)
    await screen.findByText(en.mobileDevicesFailed)
    b.checkSdk.mockResolvedValueOnce({ platform: 'darwin',
      android: { found: false, sdkPath: '/installed/sdk', message: 'adb permission denied' },
      ios: { simctlOk: false, message: 'simctl timed out' },
    })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    await screen.findByText('Android SDK check did not succeed. Check the SDK path, tools, and permissions.')
    await screen.findByText('iOS Simulator check did not succeed. Check Xcode tools and permissions.')
    expect(screen.getByRole('link', { name: en.mobileSdkDownload }).getAttribute('href')).toBe('https://developer.android.com/studio')
    expect(screen.getByText('No device provider is mounted for this profile.')).toBeTruthy()
    expect(b.refreshDevice).toHaveBeenCalledTimes(2)
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
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
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


  it('clears the SDK path and adopts the detected one explicitly', async () => {
    const b = bench()
    b.checkSdk.mockResolvedValue({ platform: 'win32', android: { found: true, sdkPath: '/detected/sdk', message: '' }, ios: null })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    fireEvent.click(await screen.findByRole('button', { name: en.mobileSdkUseDetected }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('/detected/sdk')
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkClear }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledWith({ enabled: false, androidSdkPath: '', defaultDeviceId: 'missing-device' }, 7)
  })

  it('discards an unpublished draft without writing it', () => {
    const b = bench()
    fireEvent.change(screen.getByRole('textbox', { name: en.mobileSdkCustomPath }), { target: { value: 'draft-path' } })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.preferencesSave }).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesDiscard }))
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath }).value).toBe('stored-path')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.preferencesSave }).disabled).toBe(true)
    expect(b.save).not.toHaveBeenCalled()
  })

  it('resets overrides at the opening revision without a draft', async () => {
    const b = bench()
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    await waitFor(() => { expect(b.reset).toHaveBeenCalledExactlyOnceWith(7) })
    expect(b.save).not.toHaveBeenCalled()
    expect(await screen.findByText(en.mobilePreferencesSaved)).toBeTruthy()
  })

  it('keeps a detected SDK without a path and an empty device list honest', async () => {
    const b = bench()
    b.checkSdk.mockResolvedValue({ platform: 'darwin', android: { found: true, sdkPath: null, message: '' },
      ios: { simctlOk: true, message: '' } })
    b.listMobileDevices.mockResolvedValue({ available: true, devices: [] })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    expect(await screen.findByText(en.mobileSdkFound)).toBeTruthy()
    expect(screen.getByText(en.mobileSdkIosReady)).toBeTruthy()
    expect(await screen.findByText(en.deviceNoDevices)).toBeTruthy()
    expect(b.save).not.toHaveBeenCalled()
  })

  it('reports a single detected device without a misleading plural', async () => {
    const b = bench()
    b.listMobileDevices.mockResolvedValue({ available: true, devices: [
      { id: 'only-device', name: 'Only device', state: 'online', isAvailable: true },
    ] })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    expect(await screen.findByText(en.mobileDeviceDetectedOne)).toBeTruthy()
  })

  it('reports a detected SDK path the Host resolved', async () => {
    const b = bench()
    b.checkSdk.mockResolvedValue({ platform: 'win32', android: { found: true, sdkPath: '/detected/sdk', message: '' }, ios: null })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    expect(await screen.findByText(en.mobileSdkDetectedAt.replace('{path}', '/detected/sdk'))).toBeTruthy()
    expect(screen.getByRole('button', { name: en.mobileSdkUseDetected })).toBeTruthy()
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
  })

  it('shows the stored paths while the Host settings namespace is still loading', () => {
    const b = bench()
    b.snapshot.status = 'loading'
    b.snapshot.value = undefined
    b.rerender(<MobilePreferences {...b.props} />)
    expect(screen.getAllByText(en.preferencesLoading).length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText(en.preferencesUnavailable)).toBeNull()
  })

  it('refuses an edit dispatched to a read-only field', () => {
    const b = bench(false)
    const path = screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath })
    fireEvent.change(path, { target: { value: 'ignored-path' } })
    expect(path.value).toBe('stored-path')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.preferencesSave }).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.preferencesReset }))
    expect(b.save).not.toHaveBeenCalled()
    expect(b.reset).not.toHaveBeenCalled()
  })

  it('contains toolchain and device answers that arrive after the page left', async () => {
    const resolved = bench()
    const sdkAnswer = Promise.withResolvers<MobileSdkSnapshot>()
    const deviceAnswer = Promise.withResolvers<MobileDeviceListSnapshot>()
    resolved.checkSdk.mockReturnValueOnce(sdkAnswer.promise)
    resolved.listMobileDevices.mockReturnValueOnce(deviceAnswer.promise)
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    resolved.unmount()
    await act(async () => {
      sdkAnswer.resolve({ platform: 'linux', android: { found: true, sdkPath: '/late/sdk', message: '' }, ios: null })
      deviceAnswer.resolve({ available: true, devices: [] })
      await Promise.all([sdkAnswer.promise, deviceAnswer.promise])
    })

    const rejected = bench()
    const sdkFailure = Promise.withResolvers<MobileSdkSnapshot>()
    const deviceFailure = Promise.withResolvers<MobileDeviceListSnapshot>()
    rejected.checkSdk.mockReturnValueOnce(sdkFailure.promise)
    rejected.listMobileDevices.mockReturnValueOnce(deviceFailure.promise)
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    rejected.unmount()
    await act(async () => {
      sdkFailure.reject(new Error('toolchain offline'))
      deviceFailure.reject(new Error('devices offline'))
      await Promise.all([sdkFailure.promise.catch(() => {}), deviceFailure.promise.catch(() => {})])
    })
  })

  it('contains a preference write that settles after the page left', async () => {
    const saved = bench()
    const answer = Promise.withResolvers<undefined>()
    saved.save.mockReturnValueOnce(answer.promise)
    fireEvent.change(screen.getByRole('textbox', { name: en.mobileSdkCustomPath }), { target: { value: 'late-path' } })
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    saved.unmount()
    await act(async () => { answer.resolve(undefined); await answer.promise })

    const rejected = bench()
    const failure = Promise.withResolvers<undefined>()
    rejected.save.mockReturnValueOnce(failure.promise)
    fireEvent.change(screen.getByRole('textbox', { name: en.mobileSdkCustomPath }), { target: { value: 'late-path' } })
    fireEvent.click(screen.getByRole('button', { name: en.preferencesSave }))
    rejected.unmount()
    await act(async () => { failure.reject(new Error('conflict')); await failure.promise.catch(() => {}) })
  })

})
