// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { NativeDirectoryFlow } from '../../ui-directory-picker-native/src/client/flow.ts'
import { MobilePreferences } from '../src/client/MobilePreferences.tsx'
import { en } from '../src/client/locales.ts'
import type { MobileSectionInjected } from '../src/client/CapabilitySection.tsx'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { MobileDeviceListSnapshot, MobileSdkSnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'

afterEach(cleanup)

function bench(writable = true, enabled = false) {
  const snapshot: SettingsScopeSnapshot<MobileDeviceSettings> = { status: 'ready', mode: 'host', writable, revision: 7,
    value: { enabled, androidSdkPath: 'stored-path', defaultDeviceId: 'missing-device' }, base: {}, user: {} }
  const save = vi.fn<MobileSectionInjected['saveMobileSettings']>(async (value, revision) => {
    snapshot.value = value; snapshot.revision = revision + 1; return revision + 1
  })
  const checkSdk = vi.fn<MobileSectionInjected['checkSdk']>(async () => ({ platform: 'linux', android: { found: false, sdkPath: null, message: '' }, ios: null }))
  const listMobileDevices = vi.fn<MobileSectionInjected['listMobileDevices']>(async () => ({ available: false, devices: [] }))
  const refreshDevice = vi.fn()
  const pick = vi.fn<() => Promise<string | null>>(async () => null)
  const renderFactorySlot: PropsRenderFactories['renderFactorySlot'] = vi.fn((_name, owner) =>
    <NativeDirectoryFlow {...owner as DirectoryFlowOwnerProps} pick={pick} />)
  const openSdkDirectory = vi.fn<MobileSectionInjected['openSdkDirectory']>(async () => {})
  const availability = { status: 'not-configured' as const, statusKey: 'deviceNotConfigured' as const,
    reason: 'No device provider is mounted for this profile.', checking: false, onRefresh: refreshDevice }
  const props = { useMobileSettings: selector => selector(snapshot), saveMobileSettings: save,
    checkSdk, listMobileDevices, renderFactorySlot, openSdkDirectory, availability,
    t: makeTranslate(en, commonEn) } satisfies Parameters<typeof MobilePreferences>[0]
  return { ...render(<MobilePreferences {...props} />), props, snapshot, save, checkSdk,
    listMobileDevices, pick, openSdkDirectory, refreshDevice }
}

const pathInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: en.mobileSdkCustomPath })
const editPath = (value: string) => fireEvent.change(pathInput(), { target: { value } })

describe('mobile preference autosave', () => {
  it('links to Android Studio and removes the manual save, discard, and reset controls', () => {
    bench()
    expect(screen.getByRole('link', { name: en.mobileSdkDownload }).getAttribute('href')).toBe('https://developer.android.com/studio')
    for (const name of [en.preferencesSave, en.preferencesDiscard, en.preferencesReset]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('saves a changed path on blur with its opening revision and rechecks the SDK', async () => {
    const b = bench()
    editPath('new-path')
    expect(b.save).not.toHaveBeenCalled()
    expect(screen.getByText(en.mobileSdkDraft)).toBeTruthy()
    b.snapshot.revision = 12
    b.rerender(<MobilePreferences {...b.props} />)
    fireEvent.blur(pathInput())
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledExactlyOnceWith({ enabled: false, androidSdkPath: 'new-path', defaultDeviceId: 'missing-device' }, 7)
    expect(b.checkSdk).toHaveBeenCalledOnce()
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
    expect(b.refreshDevice).toHaveBeenCalledOnce()
    fireEvent.blur(pathInput())
    expect(b.save).toHaveBeenCalledOnce()
  })

  it('serializes two blurred edits and fences the second with the accepted revision', async () => {
    const b = bench()
    const first = Promise.withResolvers<number>()
    b.save.mockImplementationOnce(async (value) => {
      const revision = await first.promise
      b.snapshot.value = value; b.snapshot.revision = revision
      return revision
    })
    editPath('first-path'); fireEvent.blur(pathInput())
    editPath('second-path'); fireEvent.blur(pathInput())
    expect(pathInput().disabled).toBe(false)
    expect(b.save).toHaveBeenCalledOnce()
    await act(async () => { first.resolve(8); await first.promise })
    await waitFor(() => { expect(b.save).toHaveBeenCalledTimes(2) })
    expect(b.save).toHaveBeenLastCalledWith({ enabled: false, androidSdkPath: 'second-path', defaultDeviceId: 'missing-device' }, 8)
    expect(pathInput().value).toBe('second-path')
  })

  it('keeps an in-focus later edit when the preceding write settles', async () => {
    const b = bench()
    const first = Promise.withResolvers<number>()
    b.save.mockReturnValueOnce(first.promise)
    editPath('first-path'); fireEvent.blur(pathInput())
    editPath('still-editing')
    await act(async () => { first.resolve(8); await first.promise })
    expect(pathInput().value).toBe('still-editing')
    expect(b.save).toHaveBeenCalledOnce()
    fireEvent.blur(pathInput())
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenLastCalledWith({ enabled: false, androidSdkPath: 'still-editing', defaultDeviceId: 'missing-device' }, 8)
  })

  it('retains a rejected value and retries on the next blur', async () => {
    const b = bench()
    b.save.mockRejectedValueOnce(new Error('conflict'))
    editPath('new-path'); fireEvent.blur(pathInput())
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.preferencesFailed)
    expect(pathInput().value).toBe('new-path')
    fireEvent.blur(pathInput())
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledTimes(2)
    expect(pathInput().value).toBe('new-path')
  })

  it('uses the shared picker and saves a selected folder without another gesture', async () => {
    const b = bench()
    b.pick.mockResolvedValue('/selected/sdk')
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(pathInput().value).toBe('/selected/sdk')
    expect(b.save).toHaveBeenCalledExactlyOnceWith({ enabled: false, androidSdkPath: '/selected/sdk', defaultDeviceId: 'missing-device' }, 7)
    expect(b.checkSdk).toHaveBeenCalledOnce()
  })

  it('does not discard the draft on picker cancellation or failure', async () => {
    const b = bench()
    editPath('draft-path')
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.mobileSdkLocate })).toHaveProperty('disabled', false) })
    b.pick.mockRejectedValueOnce(new Error('no chooser'))
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.mobileSdkPickFailed)
    expect(pathInput().value).toBe('draft-path')
    expect(b.save).not.toHaveBeenCalled()
  })

  it('allows manual input again when the picker factory is missing', async () => {
    const b = bench()
    b.rerender(<MobilePreferences {...b.props} renderFactorySlot={(_name, _owner, options) => options?.fallback} />)
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    expect(screen.getByRole('alert')).toHaveProperty('textContent', en.mobileSdkPickFailed)
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkCancel }))
    expect(pathInput().disabled).toBe(false)
  })

  it.each(['resolve', 'reject'] as const)('ignores a late picker %s after leaving', async (outcome) => {
    const b = bench()
    const selection = Promise.withResolvers<string | null>()
    b.pick.mockReturnValue(selection.promise)
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    expect(pathInput().disabled).toBe(true)
    b.unmount()
    await act(async () => {
      if (outcome === 'resolve') selection.resolve('/late/sdk')
      else selection.reject(new Error('late failure'))
      await Promise.allSettled([selection.promise])
    })
    expect(b.save).not.toHaveBeenCalled()
  })

  it('opens only the detected SDK and hides opening while the path is unverified', async () => {
    const b = bench()
    b.checkSdk.mockResolvedValue({ platform: 'win32', android: { found: true, sdkPath: 'C:\\Android\\Sdk\\platform-tools\\adb.exe', message: '' }, ios: null })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    fireEvent.click(await screen.findByRole('button', { name: en.mobileSdkOpen }))
    await waitFor(() => { expect(b.openSdkDirectory).toHaveBeenCalledWith('C:\\Android\\Sdk\\platform-tools\\adb.exe', expect.any(AbortSignal)) })
    await waitFor(() => { expect(screen.getByRole('button', { name: en.mobileSdkOpen })).toHaveProperty('disabled', false) })
    b.openSdkDirectory.mockRejectedValueOnce(new Error('no desktop'))
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkOpen }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.mobileSdkOpenFailed)
    editPath('/unverified')
    expect(screen.queryByRole('button', { name: en.mobileSdkOpen })).toBeNull()
  })

  it('keeps refresh and opening available without allowing writes on read-only connections', async () => {
    const b = bench(false)
    editPath('ignored-path'); fireEvent.blur(pathInput())
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkLocate }))
    expect(pathInput().value).toBe('stored-path')
    expect(b.pick).not.toHaveBeenCalled()
    b.checkSdk.mockResolvedValue({ platform: 'linux', android: { found: true, sdkPath: '/sdk', message: '' }, ios: null })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    fireEvent.click(await screen.findByRole('button', { name: en.mobileSdkOpen }))
    await waitFor(() => { expect(b.openSdkDirectory).toHaveBeenCalledOnce() })
    expect(b.save).not.toHaveBeenCalled()
    expect(screen.queryByText(en.preferencesReadOnly)).toBeNull()
  })

  it('keeps the offline default visible and saves a different device on blur', async () => {
    const b = bench()
    expect(screen.getByRole('option', { name: en.mobileSavedDeviceUnavailable })).toBeTruthy()
    b.listMobileDevices.mockResolvedValue({ available: true, devices: [
      { id: 'missing-device', name: 'Saved device', state: 'offline', isAvailable: false },
      { id: 'other-device', name: 'Another device', state: 'online', isAvailable: true },
    ] })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    await screen.findByRole('option', { name: 'Saved device' })
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: en.mobileDefaultDevice })
    expect(select.value).toBe('missing-device')
    expect(screen.getByRole('option', { name: 'Saved device' })).toHaveProperty('disabled', true)
    fireEvent.change(select, { target: { value: 'other-device' } })
    expect(b.save).not.toHaveBeenCalled()
    fireEvent.blur(select)
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledWith({ enabled: false, androidSdkPath: 'stored-path', defaultDeviceId: 'other-device' }, 7)
    expect(b.checkSdk).toHaveBeenCalledOnce()
  })

  it('honors configured automatic checks without rendering a check switch', async () => {
    const b = bench(true, true)
    expect(screen.queryByRole('switch')).toBeNull()
    expect(b.container.querySelector('[data-settings-anchor="mobile-enabled"]')).toBeNull()
    await screen.findByText(en.mobileSdkAndroidNotFound)
    expect(b.checkSdk).toHaveBeenCalledOnce()
    expect(b.listMobileDevices).toHaveBeenCalledOnce()
    editPath('new-path'); fireEvent.blur(pathInput())
    await screen.findByText(en.mobilePreferencesSaved)
    expect(b.save).toHaveBeenCalledExactlyOnceWith({ enabled: true, androidSdkPath: 'new-path', defaultDeviceId: 'missing-device' }, 7)
  })

  it('saves detected-path and clear actions immediately', async () => {
    const b = bench()
    b.checkSdk.mockResolvedValue({ platform: 'win32', android: { found: true, sdkPath: '/detected/sdk', message: '' }, ios: null })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    fireEvent.click(await screen.findByRole('button', { name: en.mobileSdkUseDetected }))
    await screen.findByText(en.mobilePreferencesSaved)
    expect(pathInput().value).toBe('/detected/sdk')
    fireEvent.click(screen.getByRole('button', { name: en.mobileSdkClear }))
    await waitFor(() => { expect(b.save).toHaveBeenCalledTimes(2) })
    expect(b.save).toHaveBeenLastCalledWith({ enabled: false, androidSdkPath: '', defaultDeviceId: 'missing-device' }, 8)
  })

  it('reports failed SDK and device checks and retries without a preference write', async () => {
    const b = bench()
    b.checkSdk.mockRejectedValueOnce(new Error('host unavailable'))
    b.listMobileDevices.mockRejectedValueOnce(new Error('device unavailable'))
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    await screen.findByText(en.mobileSdkFailed); await screen.findByText(en.mobileDevicesFailed)
    b.checkSdk.mockResolvedValueOnce({ platform: 'darwin', android: { found: true, sdkPath: null, message: '' }, ios: { simctlOk: true, message: '' } })
    b.listMobileDevices.mockResolvedValueOnce({ available: true, devices: [] })
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    await screen.findByText(en.mobileSdkFound); await screen.findByText(en.mobileSdkIosReady)
    await screen.findByText(en.deviceNoDevices)
    expect(b.save).not.toHaveBeenCalled()
  })

  it.each(['loading', 'unavailable'] as const)('keeps field targets when the scope is %s', (status) => {
    const b = bench()
    b.snapshot.status = status; b.snapshot.value = undefined
    b.rerender(<MobilePreferences {...b.props} />)
    expect(screen.getAllByText(status === 'loading' ? en.preferencesLoading : en.preferencesUnavailable).length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('combobox', { name: en.mobileDefaultDevice })).toHaveProperty('disabled', true)
    expect(screen.getByRole('option', { name: en.mobileDefaultDeviceAuto })).toBeTruthy()
    expect(b.container.querySelector('[data-settings-anchor="mobile-sdk-path"]')).not.toBeNull()
  })

  it('cancels pending checks and ignores their answers on unmount', async () => {
    const b = bench()
    const sdk = Promise.withResolvers<MobileSdkSnapshot>()
    const devices = Promise.withResolvers<MobileDeviceListSnapshot>()
    b.checkSdk.mockReturnValueOnce(sdk.promise); b.listMobileDevices.mockReturnValueOnce(devices.promise)
    fireEvent.click(screen.getByRole('button', { name: en.mobileAgentRecheck }))
    b.unmount()
    expect(b.checkSdk.mock.calls[0]![0].aborted).toBe(true)
    expect(b.listMobileDevices.mock.calls[0]![0].aborted).toBe(true)
    await act(async () => {
      sdk.resolve({ platform: 'linux', android: { found: true, sdkPath: '/late/sdk', message: '' }, ios: null })
      devices.reject(new Error('late check'))
      await Promise.allSettled([sdk.promise, devices.promise])
    })
  })

  it.each(['resolve', 'reject'] as const)('ignores a late preference %s and abandons queued writes on unmount', async (outcome) => {
    const b = bench()
    const answer = Promise.withResolvers<number>()
    b.save.mockReturnValueOnce(answer.promise)
    editPath('late-path'); fireEvent.blur(pathInput())
    editPath('queued-path'); fireEvent.blur(pathInput())
    b.unmount()
    await act(async () => {
      if (outcome === 'resolve') answer.resolve(8)
      else answer.reject(new Error('late failure'))
      await Promise.allSettled([answer.promise])
    })
    expect(b.save).toHaveBeenCalledOnce()
  })
})
