// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { DeviceCapabilitySnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'
import { MOBILE_CAPABILITY, CapabilitySection, type MobileSectionInjected } from '../src/client/CapabilitySection.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 0) }) }

type SectionProps = Parameters<typeof CapabilitySection>[0]

function mount(status: DeviceCapabilitySnapshot['status'] = 'not-configured', language: 'en' | 'zh' = 'en') {
  const checkDevice = vi.fn(async (capability: 'mobile', _signal: AbortSignal) => ({
    capability, status, reason: status === 'not-configured' ? 'not-configured' as const : status === 'unavailable' ? 'cli-missing' as const : null,
  }))
  const unavailable: SettingsScopeSnapshot<never> = {
    status: 'unavailable', mode: 'host', writable: false, value: undefined, base: undefined, user: undefined, revision: undefined,
  }
  const props = {
    definition: MOBILE_CAPABILITY,
    renderFactorySlot: vi.fn(() => null),
    close: vi.fn(),
    checkDevice: checkDevice as unknown as MobileSectionInjected['checkDevice'],
    checkSdk: vi.fn(async () => ({ platform: 'linux', android: { found: false, sdkPath: null, message: 'Not found' }, ios: null })),
    listMobileDevices: vi.fn(async () => ({ devices: [], available: false })),
    pickSdkDirectory: vi.fn(async () => null), openSdkDirectory: vi.fn(async () => {}),
    useMobileSettings: (selector: (snapshot: SettingsScopeSnapshot<never>) => unknown) => selector({
      status: 'ready', mode: 'host', writable: true, revision: 1,
      value: { enabled: false, defaultDeviceId: '', androidSdkPath: '' }, base: undefined, user: undefined,
    } as never),
    saveMobileSettings: vi.fn(async () => 2), resetMobileSettings: vi.fn(async () => {}),
    listProviderEntries: vi.fn(async () => ({ kind: 'unavailable' as const })),
    setProviderEnabled: vi.fn(async () => ({ kind: 'unavailable' as const })),
    useMobileResources: (selector: (snapshot: { status: string }) => unknown) => selector({ status: 'loading' }),
    watchMobileResources: vi.fn(() => () => {}),
    refreshMobileResources: vi.fn(),
    runMobileResource: vi.fn(async () => {}),
    cancelMobileResource: vi.fn(async () => {}),
    startMobileMirror: vi.fn(async () => {}),
    closeMobileMirror: vi.fn(async () => {}),
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
  } as unknown as SectionProps
  return { ...render(<CapabilitySection {...props} />), props, checkDevice, unavailable }
}

describe('mobile emulator settings page', () => {
  it('keeps preferences, commands, and examples without capability controls or resources', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: en.mobileCommandsTitle })).toBeTruthy()
    expect(screen.getByRole('heading', { name: en.examplesTitle })).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText(en.mobileSdkStatusTitle)).toBeTruthy()
    expect(screen.getByRole('combobox', { name: en.mobileDefaultDevice })).toBeTruthy()
    expect(screen.getByRole('option', { name: en.mobileDefaultDeviceAuto })).toBeTruthy()
    expect(screen.queryByText(en.preferencesReadOnly)).toBeNull()
    expect(screen.queryByText('0/2')).toBeNull()
    expect(screen.queryByText(en.mobileAgentControl)).toBeNull()
    expect(screen.queryByText(en.mobileResourcesTitle)).toBeNull()
    for (const name of [en.preferencesSave, en.preferencesDiscard, en.preferencesReset]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
  })

  it('reports the probed availability and its localized reason', async () => {
    mount('unavailable')
    expect(await screen.findByText(en.deviceUnavailable)).toBeTruthy()
    expect(screen.getByText(en.deviceCliMissing)).toBeTruthy()
  })

  it('reports an unreadable device probe instead of claiming availability', async () => {
    const view = mount()
    view.checkDevice.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click((await screen.findAllByRole('button', { name: en.mobileAgentRecheck }))[0]!)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', en.loadFailed)
    expect(screen.getByText(en.deviceCheckFailed)).toBeTruthy()
  })

  it('re-probes the device when the availability control is used', async () => {
    const view = mount()
    await screen.findByText(en.deviceNotConfigured)
    fireEvent.click(screen.getAllByRole('button', { name: en.mobileAgentRecheck })[0]!)
    await waitFor(() => { expect(view.checkDevice).toHaveBeenCalledTimes(2) })
  })

  it('cancels a pending device probe when the page unmounts', async () => {
    const view = mount()
    await waitFor(() => { expect(view.checkDevice).toHaveBeenCalledTimes(1) })
    const signal = view.checkDevice.mock.calls[0]![1]
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('ignores a device probe that settles after the page left', async () => {
    const resolved = mount()
    const answer = Promise.withResolvers<never>()
    resolved.rerender(<CapabilitySection {...resolved.props} checkDevice={() => answer.promise} />)
    resolved.unmount()
    answer.resolve(undefined as never)
    await settle()

    const rejected = mount()
    const failure = Promise.withResolvers<never>()
    rejected.rerender(<CapabilitySection {...rejected.props} checkDevice={() => failure.promise} />)
    rejected.unmount()
    failure.reject(new Error('late failure'))
    await settle()
  })

  it('renders the page in Chinese copy', async () => {
    mount('available', 'zh')
    expect(await screen.findByText(zh.deviceAvailable)).toBeTruthy()
  })

  it('keeps the section available when the settings scope is unavailable', async () => {
    const view = mount()
    const useMobileSettings = (selector: (snapshot: SettingsScopeSnapshot<never>) => unknown) => selector(view.unavailable)
    const props = { ...view.props, useMobileSettings } as unknown as SectionProps
    view.rerender(<CapabilitySection {...props} />)
    expect(await screen.findByText(en.preferencesUnavailable)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('does not reveal removed runtime controls for an old settings-search target', () => {
    const view = mount()
    view.rerender(<CapabilitySection {...view.props} target={{ itemId: 'resources', anchorId: 'mobile-resources' }} />)
    expect(view.container.querySelector('details')).toBeNull()
  })
})
