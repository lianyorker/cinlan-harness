// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SIDEBAR_PREFS_DEFAULTS } from '@deepseek-ai/dsh-client-ui-better-sidebar/src/prefs-shared.ts'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { DeviceCapabilitySnapshot, PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { CAPABILITIES, CapabilitySection, type CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import { en, zh } from '../src/client/locales.ts'
import { BrowserTransfersPanel } from '../src/client/BrowserTransfersPanel.tsx'
import type { BrowserControlsCallbacks } from '../src/client/BrowserControls.tsx'
import type { BrowserPageId } from '@deepseek-ai/dsh-api-browser-controller/types'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (clipboardDescriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
})

function mount(status: DeviceCapabilitySnapshot['status'] = 'not-configured', language: 'en' | 'zh' = 'en', id: CapabilitySectionProps['definition']['id'] = 'computer') {
  const definition = CAPABILITIES.find(item => item.id === id)!
  const inventory: PluginInventorySnapshot = { entries: [{
    entryId: 'active-plugin' as PluginEntryId,
    moduleName: '@deepseek-ai/dsh-computer-use-cinlan',
    enabled: true,
    fiberPhase: 'active',
  }] }
  const checkDevice = vi.fn<CapabilitySectionProps['checkDevice']>(async capability => ({
    capability, status, reason: status === 'not-configured' ? 'not-configured' : status === 'unavailable' ? 'cli-missing' : null,
  }))
  const checkSdk = vi.fn<CapabilitySectionProps['checkSdk']>(async () => ({
    platform: 'linux',
    android: { found: false, sdkPath: null, message: 'Not found' },
    ios: null,
  }))
  const listMobileDevices = vi.fn<CapabilitySectionProps['listMobileDevices']>(async () => ({ devices: [], available: false }))
  const unavailable: SettingsScopeSnapshot<never> = {
    status: 'unavailable', mode: 'host', writable: false, value: undefined, base: undefined, user: undefined, revision: undefined,
  }
  const unusedHook = (): never => { throw new Error('This section does not read the standard hook') }
  const props: CapabilitySectionProps = {
    definition: { ...definition, id },
    close: vi.fn(),
    useSessions: unusedHook, useWorkspaces: unusedHook, useSessionPendingInteraction: unusedHook, useResource: unusedHook,
    list: vi.fn(async () => inventory),
    checkDevice,
    checkSdk,
    listMobileDevices,
    useMobileSettings: selector => selector({ status: 'ready', mode: 'host', writable: true, revision: 1,
      value: { enabled: false, defaultDeviceId: '', androidSdkPath: '' }, base: undefined, user: undefined }),
    saveMobileSettings: vi.fn(), resetMobileSettings: vi.fn(), resetBrowserPreferences: vi.fn(),
    useBrowserPreferences: selector => selector(unavailable),
    useBrowserRouting: selector => selector(unavailable),
    saveBrowserRouting: vi.fn<CapabilitySectionProps['saveBrowserRouting']>(async () => {}),
    resetBrowserRouting: vi.fn<CapabilitySectionProps['resetBrowserRouting']>(async () => {}),
    saveBrowserPreferences: vi.fn(),
    browserControls: undefined,
    listProviderEntries: vi.fn(async () => ({ kind: 'unavailable' as const })),
    setProviderEnabled: vi.fn(async () => ({ kind: 'unavailable' as const })),
    useBrowserResources: selector => selector({ status: 'loading' }),
    watchBrowserResources: vi.fn(() => () => {}), refreshBrowserResources: vi.fn(), runBrowserResource: vi.fn(),
    cancelBrowserResource: vi.fn(), closeBrowserRuntime: vi.fn(),
    t: language === 'en' ? makeTranslate(en, commonEn) : makeTranslate(zh, commonZh),
  }
  return { ...render(<CapabilitySection {...props} />), checkDevice, props, inventory }
}

describe('Device Settings readiness', () => {
  it('never reports installation from an active Loader entry', async () => {
    mount()
    expect(await screen.findByText(en.deviceNotConfigured)).toBeTruthy()
    expect(screen.queryByText('Installed')).toBeNull()
    expect(screen.getByText('dsh --profile device-control')).toBeTruthy()
    expect(screen.queryByText(/capabilities install/)).toBeNull()
    expect(screen.getByText(en.computerObservationUnavailable)).toBeTruthy()
    expect(screen.getByText(en.computerPermissionsUnknown)).toBeTruthy()
    expect(screen.queryByText(`${en.computerScreenshot}: ${en.computerSupported}`)).toBeNull()
    expect(screen.getAllByRole('heading').map(item => item.textContent)).toEqual([
      en.computerTitle, en.providerActivation, en.computerHeroTitle, en.computerMachine, en.computerPermissions,
      en.computerHowToUse, en.computerObserveTitle, en.computerOperateTitle, en.computerVerifyTitle,
    ])
  })

  it('refreshes actual Provider failures without claiming success', async () => {
    const view = mount('unavailable')
    expect(await screen.findByText(en.deviceCliMissing)).toBeTruthy()
    view.checkDevice.mockResolvedValueOnce({ capability: 'computer', status: 'available', reason: null })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(en.deviceAvailable)).toBeTruthy()
    expect(view.checkDevice).toHaveBeenCalledTimes(2)
  })

  it.each(['en', 'zh'] as const)('renders %s Provider observations without treating support as permission', async (language) => {
    const view = mount('available', language)
    const copy = language === 'en' ? en : zh
    await screen.findByText(copy.deviceAvailable)
    expect(screen.getByText(copy.computerObservationUnavailable)).toBeTruthy()
    view.checkDevice.mockResolvedValueOnce({
      capability: 'computer', status: 'available', reason: null,
      computer: {
        kind: 'facade', platform: 'win32', provider: 'fixture-provider', providerVersion: '1.2.3', protocolVersion: 1, permissions: 'unknown',
        supports: {
          apps: { list: true, bundleIds: false, pids: true },
          windows: { list: true, targetById: true, targetByIndex: false, focus: true, moveResize: false },
          observation: { screenshot: true, annotatedScreenshot: false, elementFrames: true, ocr: false },
          actions: { click: true, typeText: true, pressKey: true, hotkey: true, pasteText: false, scroll: true,
            drag: false, setValue: false, performAction: false },
          surfaces: { menus: false, dialogs: true, dock: false, menubar: false },
        },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: copy.computerRecheck }))
    expect(await screen.findByText('fixture-provider')).toBeTruthy()
    expect(screen.getByText('win32')).toBeTruthy()
    expect(screen.getByText('1.2.3')).toBeTruthy()
    expect(screen.getByText(`${copy.computerScreenshot}: ${copy.computerSupported}`)).toBeTruthy()
    expect(screen.getByText(`${copy.computerOcr}: ${copy.computerUnsupported}`)).toBeTruthy()
    expect(screen.getByText(copy.computerPermissionsUnknown)).toBeTruthy()
    expect(screen.getByText(copy.computerPermissionsHelp)).toBeTruthy()
    view.checkDevice.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: copy.computerRecheck }))
    await screen.findByRole('alert')
    expect(screen.queryByText('fixture-provider')).toBeNull()
    expect(screen.getByText(copy.computerObservationUnavailable)).toBeTruthy()
  })

  it.each(['en', 'zh'] as const)('shows %s native tool readiness without inventing facade support or permissions', async (language) => {
    const view = mount('available', language)
    const copy = language === 'en' ? en : zh
    await screen.findByText(copy.deviceAvailable)
    view.checkDevice.mockResolvedValueOnce({
      capability: 'computer', status: 'available', reason: null,
      computer: { kind: 'tool-catalog', platform: 'win32', provider: 'cua-driver-native', state: 'ready',
        toolNames: ['cua_driver_native__list_apps'], permissions: 'unknown' },
    })
    fireEvent.click(screen.getByRole('button', { name: copy.computerRecheck }))
    expect(await screen.findByText(copy.computerCatalogReady)).toBeTruthy()
    expect(screen.getByText('cua_driver_native__list_apps')).toBeTruthy()
    expect(screen.getByText(copy.computerCatalogLimit)).toBeTruthy()
    expect(screen.getByText(copy.computerPermissionsUnknown)).toBeTruthy()
    expect(screen.queryByText(copy.computerProtocolVersion)).toBeNull()
    expect(screen.queryByText(copy.computerScreenshot)).toBeNull()
    view.checkDevice.mockResolvedValueOnce({
      capability: 'computer', status: 'unavailable', reason: 'provider-disposing',
      computer: { kind: 'tool-catalog', platform: 'win32', provider: 'cua-driver-native', state: 'disposing',
        toolNames: [], permissions: 'unknown' },
    })
    fireEvent.click(screen.getByRole('button', { name: copy.computerRecheck }))
    await screen.findByText(copy.deviceUnavailable)
    expect(screen.queryByText('cua_driver_native__list_apps')).toBeNull()
    expect(screen.getAllByText(copy.computerDisposing).length).toBeGreaterThan(0)
  })

  it('localizes readiness and preserves the command as a code token', async () => {
    mount('available', 'zh')
    expect(await screen.findByText(zh.deviceAvailable)).toBeTruthy()
    expect(screen.getByText(zh.deviceAvailableDescription)).toBeTruthy()
    expect(screen.getByRole('button', { name: zh.computerRecheck })).toBeTruthy()
  })

  it('copies the supported profile command and reports denied clipboard writes', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    mount()
    await screen.findByText(en.deviceNotConfigured)
    fireEvent.click(screen.getByRole('button', { name: en.computerCopyCommand }))
    expect(await screen.findByText(en.computerCopied)).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith('dsh --profile device-control')
    fireEvent.click(screen.getByRole('button', { name: en.computerCopyCommand }))
    expect(await screen.findByText(en.copyFailed)).toBeTruthy()
  })

  it('cancels a pending readiness call when Settings unmounts', async () => {
    const view = mount()
    await waitFor(() => { expect(view.checkDevice).toHaveBeenCalledTimes(1) })
    const signal = view.checkDevice.mock.calls[0]![1]
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('checks mobile readiness but does not probe devices for the browser section', async () => {
    const mobile = mount('unavailable', 'en', 'mobile')
    await waitFor(() => { expect(mobile.checkDevice).toHaveBeenCalledWith('mobile', expect.any(AbortSignal)) })
    mobile.unmount()
    const browser = mount('not-configured', 'en', 'browser')
    await screen.findByText(en.statusMissing)
    expect(browser.checkDevice).not.toHaveBeenCalled()
  })
})


describe('provider activation through exact Loader entries', () => {
  it.each(['computer', 'browser'] as const)('enables and disables configured %s without implicit input or launch', async (capability) => {
    const b = mount('not-configured', 'en', capability)
    const entry = { entryId: 'include/profile/provider-7' as PluginEntryId,
      moduleName: capability === 'computer' ? '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native' : '@deepseek-ai/dsh-browser-playwright',
      enabled: false, fiberPhase: null, patchId: 'provider-7' }
    const listProviderEntries = vi.fn<CapabilitySectionProps['listProviderEntries']>(async () => ({ kind: 'ready', entries: [entry] }))
    const setProviderEnabled = vi.fn<CapabilitySectionProps['setProviderEnabled']>(async () => ({ kind: 'result', result: { changed: true, application: 'applied', stage: 'enable', target: entry.entryId } }))
    b.rerender(<CapabilitySection {...b.props} listProviderEntries={listProviderEntries} setProviderEnabled={setProviderEnabled} />)
    fireEvent.click(await screen.findByRole('button', { name: en.providerEnable }))
    await waitFor(() => { expect(setProviderEnabled).toHaveBeenCalledWith(entry.entryId, true) })
    await screen.findByText(en.providerApplied)
    expect(screen.getByText(en.providerDisabled)).toBeTruthy()
    expect(b.props.runBrowserResource).not.toHaveBeenCalled()
    listProviderEntries.mockResolvedValue({ kind: 'ready', entries: [{ ...entry, enabled: true, fiberPhase: 'active' }] })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    fireEvent.click(await screen.findByRole('button', { name: en.providerDisable }))
    await waitFor(() => { expect(setProviderEnabled).toHaveBeenLastCalledWith(entry.entryId, false) })
  })

  it.each(['en', 'zh'] as const)('renders %s pending and typed outcomes without fabricating enablement', async (language) => {
    const b = mount('not-configured', language)
    const copy = language === 'en' ? en : zh
    const entry = { entryId: 'native-row' as PluginEntryId, moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', enabled: false, fiberPhase: null, patchId: 'native-row' }
    const release = Promise.withResolvers<Awaited<ReturnType<CapabilitySectionProps['setProviderEnabled']>>>()
    const setProviderEnabled = vi.fn<CapabilitySectionProps['setProviderEnabled']>(() => release.promise)
    const listProviderEntries = vi.fn<CapabilitySectionProps['listProviderEntries']>(async () => ({ kind: 'ready', entries: [entry] }))
    b.rerender(<CapabilitySection {...b.props} listProviderEntries={listProviderEntries} setProviderEnabled={setProviderEnabled} />)
    fireEvent.click(await screen.findByRole('button', { name: copy.providerEnable }))
    expect(screen.getByRole<HTMLButtonElement>('button', { name: copy.providerChanging }).disabled).toBe(true)
    release.resolve({ kind: 'result', result: { changed: true, application: 'restart-required', stage: 'enable', target: entry.entryId } })
    expect(await screen.findByText(copy.providerRestartRequired)).toBeTruthy()
    expect(screen.getByText(copy.providerDisabled)).toBeTruthy()
    setProviderEnabled.mockResolvedValue({ kind: 'result', result: { changed: false, application: 'failed', stage: 'enable', target: entry.entryId, error: { code: 'operation-error' } } })
    fireEvent.click(screen.getByRole('button', { name: copy.providerEnable }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', copy.providerFailed)
    setProviderEnabled.mockResolvedValue({ kind: 'rejected' })
    fireEvent.click(screen.getByRole('button', { name: copy.providerEnable }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(copy.providerRejected) })
  })

  it('keeps unavailable management and read-only entries non-actionable', async () => {
    const b = mount()
    await screen.findByText(en.providerManagementUnavailable)
    expect(screen.queryByRole('button', { name: en.providerEnable })).toBeNull()
    const listProviderEntries = vi.fn<CapabilitySectionProps['listProviderEntries']>(async () => ({ kind: 'ready', entries: [{
      entryId: 'protected-row' as PluginEntryId, moduleName: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
      enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required',
    }] }))
    b.rerender(<CapabilitySection {...b.props} listProviderEntries={listProviderEntries} />)
    expect((await screen.findByRole<HTMLButtonElement>('button', { name: en.providerDisable })).disabled).toBe(true)
    expect(screen.getByText(en.providerReadOnly)).toBeTruthy()
    expect(b.props.setProviderEnabled).not.toHaveBeenCalled()
    expect(screen.getByText(en.computerNativePrerequisite)).toBeTruthy()
    expect(screen.queryByText(en.devicePrerequisite)).toBeNull()
  })
})

describe('capability reference pages', () => {
  it('keeps browser preferences searchable and actions unavailable without a configured Provider', async () => {
    mount('not-configured', 'en', 'browser')
    await screen.findByText(en.statusMissing)
    expect(screen.getByText(en.browserCookieDescription)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.getByText(en.browserActionsUnavailable)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: en.browserTitle })).toBeTruthy()
  })

  it('edits sidebar link routing when Browser Provider preferences are unavailable', async () => {
    const view = mount('not-configured', 'en', 'browser')
    await screen.findByText(en.statusMissing)
    view.rerender(<CapabilitySection {...view.props} useBrowserRouting={selector => selector({
      status: 'ready', mode: 'host', writable: true, revision: 12, base: undefined, user: undefined,
      value: { ...SIDEBAR_PREFS_DEFAULTS, browserInterceptLinks: true, browserInterceptHttp: true, browserInterceptHttps: false },
    })} />)
    const routing = within(screen.getByRole('form', { name: en.browserRoutingTitle }))
    fireEvent.click(routing.getByRole('switch', { name: en.browserRouteHttps }))
    fireEvent.click(routing.getByRole('button', { name: en.browserRoutingSave }))
    expect(await routing.findByText(en.browserRoutingSaved)).toBeTruthy()
    expect(view.props.saveBrowserRouting).toHaveBeenCalledWith({ browserInterceptHttps: true }, 12)
    fireEvent.click(routing.getByRole('button', { name: en.preferencesReset }))
    expect(await routing.findByText(en.browserRoutingReset)).toBeTruthy()
    expect(view.props.resetBrowserRouting).toHaveBeenCalledWith(12)
    expect(view.props.saveBrowserPreferences).not.toHaveBeenCalled()
    expect(view.checkDevice).not.toHaveBeenCalled()
    expect(screen.getByText(en.browserActionsUnavailable)).toBeTruthy()
  })

  it('keeps stored mobile preferences visible without claiming SDK checks have run', async () => {
    mount('available', 'zh', 'mobile')
    await screen.findByText(zh.deviceAvailable)
    expect(screen.getByText(zh.mobileEnable)).toBeTruthy()
    expect(screen.getByText(zh.mobileSdkAndroid)).toBeTruthy()
    expect(screen.getByText(zh.mobileDefaultDevice)).toBeTruthy()
    expect(screen.getAllByText(zh.mobileNotChecked)).toHaveLength(2)
  })

  it.each([
    ['protocol-error', en.deviceProtocolError],
    ['provider-unavailable', en.deviceProviderUnavailable],
    ['probe-failed', en.deviceCheckFailed],
    ['no-devices', en.deviceNoDevices],
  ] as const)('renders the %s readiness category', async (reason, text) => {
    const view = mount('unavailable', 'en', 'mobile')
    view.checkDevice.mockResolvedValue({ capability: 'mobile', status: 'unavailable', reason })
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.queryByText(en.deviceAvailable)).toBeNull()
  })

  it('retains the page and recheck action after a failed Host read', async () => {
    const view = mount('not-configured', 'en', 'browser')
    await screen.findByText(en.statusMissing)
    vi.mocked(view.props.list).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(en.browserHeroTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(en.statusMissing)).toBeTruthy()
  })
})

describe('capability search targets', () => {
  it('reveals targeted component diagnostics without rechecking capability status', async () => {
    const b = mount()
    await screen.findByText(en.deviceNotConfigured)
    const details = b.container.querySelector('details')
    expect(details?.open).toBe(false)
    b.rerender(<CapabilitySection {...b.props} target={{ itemId: 'components', anchorId: 'computer-components' }} />)
    expect(details?.open).toBe(true)
    expect(b.checkDevice).toHaveBeenCalledOnce()
  })

  it('reveals targeted browser transfers without observing or transferring files', () => {
    const unexpected = vi.fn(async () => { throw new Error('navigation must not perform a browser action') })
    const callbacks: BrowserControlsCallbacks = {
      pages: unexpected, open: unexpected, importCookies: unexpected, history: unexpected, network: unexpected,
      snapshot: unexpected, upload: unexpected, downloads: unexpected, download: unexpected,
    }
    const props = { pageId: 'page-id' as BrowserPageId, maxFileBytes: 1024, callbacks,
      t: makeTranslate(en, commonEn) } satisfies Parameters<typeof BrowserTransfersPanel>[0]
    const view = render(<BrowserTransfersPanel {...props} />)
    expect(view.container.querySelector('details')?.open).toBe(false)
    view.rerender(<BrowserTransfersPanel {...props} target={{ itemId: 'browserTransfers', anchorId: 'browser-transfers' }} />)
    expect(view.container.querySelector('details')?.open).toBe(true)
    expect(screen.getByRole('button', { name: en.browserObserveInputs })).toBeTruthy()
    expect(unexpected).not.toHaveBeenCalled()
  })

})
