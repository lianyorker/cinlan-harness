// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import type { DeviceCapabilitySnapshot, PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { CAPABILITIES, CapabilitySection, type CapabilitySectionProps } from '../src/client/CapabilitySection.tsx'
import { en, zh } from '../src/client/locales.ts'

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
afterEach(() => {
  cleanup()
  if (clipboardDescriptor === undefined) Reflect.deleteProperty(navigator, 'clipboard')
  else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
})

function mount(status: DeviceCapabilitySnapshot['status'] = 'not-configured', language: 'en' | 'zh' = 'en', id = 'computer') {
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
  const describeSecurity = vi.fn<CapabilitySectionProps['describeSecurity']>(async () => ({
    status: 'not-configured', preset: { present: true, trust: 'system' },
    scope: { present: true, state: 'empty', targetCount: 0, actionCount: 0,
      executionHostCount: 0, egressCount: 0, credentialCount: 0 },
    components: { assessmentScope: true, findings: true, artifacts: true,
      vulnerabilityKnowledgeBase: true, securitySkills: true, workflowPrompt: true, findingTools: true },
    skillCount: 24, skillsComplete: true,
  }))
  const props = {
    definition,
    list: vi.fn(async () => inventory),
    checkDevice,
    describeSecurity,
    useBrowserPreferences: (selector: (value: unknown) => unknown) => selector({ status: 'unavailable', mode: 'host', writable: false }),
    useSecurityScope: (select: (value: unknown) => unknown) => select({ status: 'unavailable', mode: 'host', writable: false }),
    saveSecurityScope: vi.fn(),
    saveBrowserPreferences: vi.fn(),
    browserControls: undefined,
    t: key => ((language === 'en' ? en : zh) as Record<string, string>)[key] ?? key,
  } as CapabilitySectionProps
  return { ...render(<CapabilitySection {...props} />), checkDevice, describeSecurity, props }
}

describe('Device Settings readiness', () => {
  it('never reports installation from an active Loader entry', async () => {
    mount()
    expect(await screen.findByText(en.deviceNotConfigured)).toBeTruthy()
    expect(screen.queryByText('Installed')).toBeNull()
    expect(screen.getByText('dsh --profile device-control')).toBeTruthy()
    expect(screen.queryByText(/capabilities install/)).toBeNull()
    expect(screen.getAllByRole('heading').map(item => item.textContent)).toEqual([
      'Computer use', 'Computer use capability', 'How to use', 'Observe applications and windows', 'Perform desktop actions', 'Verify operation results',
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

  it('checks mobile readiness but does not probe devices for unrelated capability sections', async () => {
    const mobile = mount('unavailable', 'en', 'mobile')
    await waitFor(() => { expect(mobile.checkDevice).toHaveBeenCalledWith('mobile', expect.any(AbortSignal)) })
    mobile.unmount()
    const security = mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    expect(security.describeSecurity).toHaveBeenCalledOnce()
    expect(security.checkDevice).not.toHaveBeenCalled()
  })
})


describe('capability reference pages', () => {
  it('keeps Design informational while installation versus replacement is undecided', async () => {
    mount('not-configured', 'zh', 'design')
    await screen.findByText(zh.statusMissing)
    expect(screen.getByText(zh.designPending)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull()
    expect(screen.getAllByRole('article')).toHaveLength(3)
  })

  it('shows browser setup steps but never offers a fake Cookie importer or enable switch', async () => {
    mount('not-configured', 'en', 'browser')
    await screen.findByText(en.statusMissing)
    expect(screen.getByText(en.browserCookieDescription)).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import' })).toBeNull()
    expect(screen.getByRole('list').children).toHaveLength(3)
  })

  it('does not interpret an absent SDK API as a missing SDK', async () => {
    mount('available', 'zh', 'mobile')
    await screen.findByText(zh.deviceAvailable)
    expect(screen.getByText(zh.mobileSdkDescription)).toBeTruthy()
    expect(screen.getByText(zh.mobileDefaultDescription)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
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
    const view = mount('not-configured', 'en', 'design')
    await screen.findByText(en.statusMissing)
    vi.mocked(view.props.list).mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(en.designHeroTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(en.statusMissing)).toBeTruthy()
  })
})

describe('Security Research status details', () => {
  it.each([
    ['configured', en.securityScopeConfigured], ['empty', en.securityScopeEmpty],
    ['missing', en.securityScopeMissing], ['expired', en.securityScopeExpired],
    ['not-yet-valid', en.securityScopeFuture],
  ] as const)('renders the %s scope without treating it as installation evidence', async (state, label) => {
    const view = mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    const snapshot = await view.describeSecurity(new AbortController().signal)
    view.describeSecurity.mockResolvedValue({ ...snapshot, scope: { ...snapshot.scope, state } })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(label)).toBeTruthy()
    expect(screen.getByText(en.securityExecutionCaveat)).toBeTruthy()
  })

  it('reports failed and incomplete security reads instead of successful configuration', async () => {
    const view = mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    view.describeSecurity.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    await screen.findByRole('alert')
    expect(screen.queryByText(en.securityConfigured)).toBeNull()
    expect(screen.getAllByText(en.securityReadFailed).length).toBeGreaterThan(0)
  })

  it('shows the install card and hides the scope editor when the preset is missing', async () => {
    const view = mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    const snapshot = await view.describeSecurity(new AbortController().signal)
    view.describeSecurity.mockResolvedValue({ ...snapshot, preset: { present: false }, status: 'not-configured' })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(en.securityInstallTitle)).toBeTruthy()
    expect(screen.getByText(en.securityCommand)).toBeTruthy()
    expect(screen.queryByText(en.securityScopeUnavailable)).toBeNull()
  })

  it('shows the broken preset card and hides the scope editor when the preset is broken', async () => {
    const view = mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    const snapshot = await view.describeSecurity(new AbortController().signal)
    view.describeSecurity.mockResolvedValue({ ...snapshot, preset: { present: true, trust: 'system', broken: 'preset-invalid' }, status: 'attention' })
    fireEvent.click(screen.getByRole('button', { name: en.computerRecheck }))
    expect(await screen.findByText(en.securityPresetBrokenTitle)).toBeTruthy()
    expect(screen.queryByText(en.securityScopeUnavailable)).toBeNull()
    expect(screen.queryByText(en.securityInstallTitle)).toBeNull()
  })

  it('shows the scope editor when the preset is present and not broken', async () => {
    mount('not-configured', 'en', 'security')
    await screen.findByText(en.securityNotConfigured)
    expect(screen.getByText(en.securityScopeUnavailable)).toBeTruthy()
    expect(screen.queryByText(en.securityInstallTitle)).toBeNull()
    expect(screen.queryByText(en.securityPresetBrokenTitle)).toBeNull()
  })
})
