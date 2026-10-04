// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
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
    close: vi.fn(),
    checkDevice: checkDevice as unknown as MobileSectionInjected['checkDevice'],
    checkSdk: vi.fn(async () => ({ platform: 'linux', android: { found: false, sdkPath: null, message: 'Not found' }, ios: null })),
    listMobileDevices: vi.fn(async () => ({ devices: [], available: false })),
    useMobileSettings: (selector: (snapshot: SettingsScopeSnapshot<never>) => unknown) => selector({
      status: 'ready', mode: 'host', writable: true, revision: 1,
      value: { enabled: false, defaultDeviceId: '', androidSdkPath: '' }, base: undefined, user: undefined,
    } as never),
    saveMobileSettings: vi.fn(async () => {}), resetMobileSettings: vi.fn(async () => {}),
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
  it('renders the page heading, the setup card, and the agent card', async () => {
    mount()
    expect(screen.getByRole('heading', { level: 1, name: en.mobileTitle })).toBeTruthy()
    expect(screen.getByText(en.mobileDescription)).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 2, name: en.mobileAgentControl })).toBeTruthy()
    expect(screen.getByRole('switch', { name: en.mobileEnable })).toBeTruthy()
    expect(screen.getByText(en.mobileSdkStatusTitle)).toBeTruthy()
    expect(screen.getByText('0/2')).toBeTruthy()
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
    await screen.findByRole('switch', { name: en.mobileEnable })
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
    resolved.rerender(<CapabilitySection {...{ ...resolved.props, checkDevice: () => answer.promise } as unknown as SectionProps} />)
    resolved.unmount()
    answer.resolve(undefined as never)
    await settle()

    const rejected = mount()
    const failure = Promise.withResolvers<never>()
    rejected.rerender(<CapabilitySection {...{ ...rejected.props, checkDevice: () => failure.promise } as unknown as SectionProps} />)
    rejected.unmount()
    failure.reject(new Error('late failure'))
    await settle()
  })

  it('renders the page in Chinese copy', async () => {
    mount('available', 'zh')
    expect(screen.getByRole('heading', { level: 1, name: zh.mobileTitle })).toBeTruthy()
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

  it('names the loaded provider entry the agent card reports', async () => {
    const view = mount()
    const entry = { entryId: 'row:mobile' as PluginEntryId, moduleName: '@deepseek-ai/dsh-mobile-device-adb', enabled: true, fiberPhase: 'active' as const }
    const props = { ...view.props, listProviderEntries: async () => ({ kind: 'ready' as const, entries: [entry] }) } as unknown as SectionProps satisfies SectionProps
    view.rerender(<CapabilitySection {...props} />)
    expect(await screen.findByText(en.mobileAgentStepLoaded)).toBeTruthy()
  })
})
