// @vitest-environment jsdom
import { useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { en, type VoiceSettingsKey } from '../src/client/locales.ts'
import { VoiceSettingsSection, type VoiceSettingsSectionProps } from '../src/client/VoiceSettingsSection.tsx'
import type { VoiceSettings } from '../src/client/voice-settings.ts'
import type { VoiceApi, VoiceModelRow } from '../src/client/api.ts'
import { createVoiceCallbacks, modelRow } from './voice-fixtures.client.ts'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

type SettingsCallbacks = Pick<VoiceApi, 'engineStatus' | 'modelsList' | 'modelsDownload' | 'modelsRemove'>

const DEFAULT_SETTINGS: VoiceSettings = { enabled: true, dictationMode: 'toggle', sttModel: null, microphoneDeviceId: null }

function Harness({ callbacks, initialSettings = DEFAULT_SETTINGS, onSettingsChange = () => {}, target }: {
  callbacks: SettingsCallbacks
  initialSettings?: VoiceSettings
  onSettingsChange?: (patch: Partial<VoiceSettings>) => void
  target?: VoiceSettingsSectionProps['target']
}): ReactNode {
  const [settings, setSettings] = useState<VoiceSettings>(initialSettings)
  const injected = {
    ...callbacks,
    target,
    t: (key: VoiceSettingsKey, params?: Record<string, string | number>) =>
      en[key].replace(/\{(\w+)\}/g, (token, name: string) => String(params?.[name] ?? token)),
    useSettings: (selector: (value: VoiceSettings) => unknown) => selector(settings),
    updateSettings: (patch: Partial<VoiceSettings>) => { onSettingsChange(patch); setSettings(current => ({ ...current, ...patch })) },
  } as unknown as VoiceSettingsSectionProps
  return <VoiceSettingsSection {...injected} />
}

describe('VoiceSettingsSection', () => {
  it('renders the shipped model roster with download controls and status', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsList.mockResolvedValue({ models: [
      modelRow('zh', { state: 'not-downloaded' }, { approximateBytes: 74_004_050 }),
      modelRow('bi', { state: 'ready', cacheDir: '/cache/bi' }, { name: 'bilingual-model', approximateBytes: 511_274_346 }),
    ] })
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineOk)
    const resources = within(await screen.findByRole('list', { name: en.modelsSectionTitle }))
    expect(resources.getByText('zh-model')).not.toBeNull()
    expect(resources.getByText('bilingual-model')).not.toBeNull()
    expect(screen.getByText(text => text.includes(en.modelReady))).not.toBeNull()
    expect(screen.getAllByRole('button', { name: en.modelDownload })).toHaveLength(1)
    expect(screen.getByRole('button', { name: en.modelRemove })).not.toBeNull()
  })

  it('confirms and removes a ready model', async () => {
    let removed = false
    const callbacks = createVoiceCallbacks()
    callbacks.modelsRemove.mockImplementation(async () => { removed = true; return {} })
    callbacks.modelsList.mockImplementation(async () => ({ models: [
      modelRow('zh', removed ? { state: 'not-downloaded' } : { state: 'ready', cacheDir: '/cache/zh' }),
    ] }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineOk)

    fireEvent.click(await screen.findByRole('button', { name: en.modelRemove }))

    await waitFor(() => { expect(callbacks.modelsRemove).toHaveBeenCalledExactlyOnceWith('zh') })
    await screen.findByRole('button', { name: en.modelDownload })
    expect(window.confirm).toHaveBeenCalledWith(en.removeConfirm)
  })

  it('shows the load-failed message when models.list rejects', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsList.mockRejectedValue(new Error('Host unavailable'))
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.loadFailed)
  })

  it('starts a download and refreshes on click', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsList.mockResolvedValue({ models: [modelRow('zh')] })
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineOk)
    const download = await screen.findByRole('button', { name: en.modelDownload })
    fireEvent.click(download)
    await waitFor(() => {
      expect(callbacks.modelsDownload).toHaveBeenCalledExactlyOnceWith('zh')
      expect(callbacks.modelsList).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps model rows and surfaces the download failure when the terminal refresh fails', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsDownload.mockRejectedValue(new Error('archive corrupt'))
    callbacks.modelsList
      .mockResolvedValueOnce({ models: [modelRow('zh')] })
      .mockRejectedValue(new Error('status unavailable'))
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineOk)
    fireEvent.click(await screen.findByRole('button', { name: en.modelDownload }))
    await screen.findByText(text => text.includes('archive corrupt'))
    expect(screen.queryByText(en.loadFailed)).toBeNull()
    expect(within(screen.getByRole('list', { name: en.modelsSectionTitle })).getByText('zh-model')).not.toBeNull()
  })

  it('requests microphone permission and restores it after the settings section remounts', async () => {
    const callbacks = createVoiceCallbacks()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const view = render(<Harness callbacks={callbacks} />)
    expect(screen.getByText(en.micUnknown)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.micRequest }))
    await screen.findByText(en.micGranted)
    view.unmount()
    vi.stubGlobal('navigator', {})
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.micGranted)
  })

  it('shows installing after download bytes complete and then converges to ready', async () => {
    let modelPhase: 'not-downloaded' | 'downloading' | 'extracting' | 'ready' = 'not-downloaded'
    vi.useFakeTimers()
    const callbacks = createVoiceCallbacks()
    callbacks.modelsDownload.mockImplementation(async () => { modelPhase = 'downloading'; return { cacheDir: '/cache/zh' } })
    callbacks.modelsList.mockImplementation(async () => {
      const status: VoiceModelRow['status'] = modelPhase === 'not-downloaded'
        ? { state: 'not-downloaded' }
        : modelPhase === 'downloading'
          ? { state: 'downloading', receivedBytes: 100, totalBytes: 100 }
          : modelPhase === 'extracting'
            ? { state: 'extracting', receivedBytes: 100, totalBytes: 100 }
            : { state: 'ready', cacheDir: '/cache/zh' }
      return { models: [modelRow('zh', status)] }
    })
    await act(async () => { render(<Harness callbacks={callbacks} />) })
    expect(screen.getByText(en.engineOk)).not.toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.modelDownload })) })
    expect(screen.getByText(text => text.includes(en.downloading))).not.toBeNull()
    modelPhase = 'extracting'
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(callbacks.modelsList.mock.calls.length).toBeGreaterThan(1)
    expect(screen.getAllByText(text => text.includes(en.installing)).length).toBeGreaterThan(0)
    modelPhase = 'ready'
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByText(text => text.includes(en.modelReady))).not.toBeNull()
  })

  it('shows the engine ready state under the Engine sub-section', async () => {
    const callbacks = createVoiceCallbacks()
    render(<Harness callbacks={callbacks} />)
    expect(await screen.findByText(en.engineSectionTitle)).not.toBeNull()
    await screen.findByText(en.engineOk)
  })

  it('shows a copyable repair command when the engine is degraded', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.engineStatus.mockResolvedValue({
      ok: false,
      cause: 'Cannot find module sherpa-onnx-node',
      command: 'dsh plugin --profile "web" install',
      profile: null,
      note: 'If pnpm blocked the sherpa-onnx-node native build scripts, set `allowBuilds: sherpa-onnx-node: true`.',
    })
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineDegraded)
    expect(screen.getByText('dsh plugin --profile "web" install')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.copyCommand }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('dsh plugin --profile "web" install') })
    await screen.findByText(en.copyCommandCopied)
  })
  it('keeps searchable fields visible and inert when dictation is disabled', async () => {
    const callbacks = createVoiceCallbacks()
    const onSettingsChange = vi.fn()
    const { container } = render(<Harness callbacks={callbacks} initialSettings={{ ...DEFAULT_SETTINGS, enabled: false }}
      onSettingsChange={onSettingsChange} target={{ itemId: 'device', anchorId: 'voice-device' }} />)
    await screen.findByText(en.engineOk)
    expect(screen.getByRole('heading', { level: 1, name: en.title })).not.toBeNull()
    expect([...container.querySelectorAll('[data-settings-anchor]')].map(row => row.getAttribute('data-settings-anchor'))).toEqual([
      'voice-enabled', 'voice-mode', 'voice-permission', 'voice-device', 'voice-engine', 'voice-model',
    ])
    expect((screen.getByRole<HTMLSelectElement>('combobox', { name: en.microphoneDevice })).disabled).toBe(true)
    expect((screen.getByRole<HTMLInputElement>('radio', { name: en.modeHold })).disabled).toBe(true)
    expect(onSettingsChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('switch', { name: en.enableDictation }))
    expect(onSettingsChange).toHaveBeenCalledWith({ enabled: true })
  })

  it('selects only ready models and restores automatic selection', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsList.mockResolvedValue({ models: [
      modelRow('ready', { state: 'ready', cacheDir: '/cache/ready' }, { name: 'Ready model', recommended: true }),
      modelRow('missing', { state: 'not-downloaded' }, { name: 'Missing model' }),
    ] })
    const onSettingsChange = vi.fn()
    render(<Harness callbacks={callbacks} onSettingsChange={onSettingsChange} />)
    await screen.findByRole('list', { name: en.modelsSectionTitle })
    const model = screen.getByRole('combobox', { name: en.selectModel })
    expect((screen.getByRole<HTMLOptionElement>('option', { name: 'Missing model' })).disabled).toBe(true)
    fireEvent.change(model, { target: { value: 'ready' } })
    expect(onSettingsChange).toHaveBeenLastCalledWith({ sttModel: 'ready' })
    fireEvent.change(model, { target: { value: '' } })
    expect(onSettingsChange).toHaveBeenLastCalledWith({ sttModel: null })
    fireEvent.click(screen.getByRole('radio', { name: en.modeHold }))
    expect(onSettingsChange).toHaveBeenLastCalledWith({ dictationMode: 'hold' })
  })

  it('refreshes device labels after permission and retains unavailable device preferences', async () => {
    const callbacks = createVoiceCallbacks()
    let granted = false
    let connected = true
    const deviceChange = new EventTarget()
    const stop = vi.fn()
    const enumerateDevices = vi.fn(async () => connected
      ? [{ kind: 'audioinput', deviceId: 'mic-one', label: granted ? 'Desk microphone' : '' }, { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }]
      : [])
    vi.stubGlobal('navigator', { mediaDevices: {
      enumerateDevices,
      getUserMedia: vi.fn(async () => { granted = true; return { getTracks: () => [{ stop }] } }),
      addEventListener: deviceChange.addEventListener.bind(deviceChange),
      removeEventListener: deviceChange.removeEventListener.bind(deviceChange),
    } })
    const onSettingsChange = vi.fn()
    render(<Harness callbacks={callbacks} onSettingsChange={onSettingsChange} />)
    await screen.findByRole('option', { name: 'Device 1' })
    expect(screen.queryByRole('option', { name: 'Camera' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.micRequest }))
    await screen.findByRole('option', { name: 'Desk microphone' })
    expect(stop).toHaveBeenCalledOnce()
    const device = screen.getByRole<HTMLSelectElement>('combobox', { name: en.microphoneDevice })
    fireEvent.change(device, { target: { value: 'mic-one' } })
    expect(onSettingsChange).toHaveBeenLastCalledWith({ microphoneDeviceId: 'mic-one' })
    connected = false
    deviceChange.dispatchEvent(new Event('devicechange'))
    await screen.findByRole('option', { name: en.microphoneDeviceUnavailable })
    expect(device.value).toBe('mic-one')
    fireEvent.change(device, { target: { value: '' } })
    expect(onSettingsChange).toHaveBeenLastCalledWith({ microphoneDeviceId: null })
  })

  it('shows denied and unsupported microphone availability without changing preferences', async () => {
    const callbacks = createVoiceCallbacks()
    vi.stubGlobal('navigator', { mediaDevices: {
      getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') }),
    } })
    const onSettingsChange = vi.fn()
    const view = render(<Harness callbacks={callbacks} onSettingsChange={onSettingsChange} />)
    fireEvent.click(screen.getByRole('button', { name: en.micRequest }))
    await screen.findByText(en.micDenied)
    view.unmount()
    vi.stubGlobal('navigator', {})
    render(<Harness callbacks={callbacks} onSettingsChange={onSettingsChange} />)
    expect((screen.getByRole<HTMLButtonElement>('button', { name: en.micRequest })).disabled).toBe(true)
    expect(screen.getByText(en.microphoneUnavailable)).not.toBeNull()
    expect(onSettingsChange).not.toHaveBeenCalled()
  })

  it('retries host engine and model status without inventing a ready state', async () => {
    const callbacks = createVoiceCallbacks()
    callbacks.engineStatus.mockRejectedValueOnce(new Error('Host unavailable'))
    callbacks.modelsList.mockRejectedValueOnce(new Error('Host unavailable'))
    render(<Harness callbacks={callbacks} />)
    await screen.findByText(en.engineLoadFailed)
    await screen.findByText(en.loadFailed)
    expect(screen.queryByText(en.engineOk)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.refreshStatus }))
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByText(en.engineOk)
    await screen.findByText(en.noModelReady)
  })
  it.each(['ready', 'downloading'] as const)('retains real %s status when a confirmed removal fails', async (state) => {
    const callbacks = createVoiceCallbacks()
    callbacks.modelsRemove.mockRejectedValue(new Error('Model is busy'))
    callbacks.modelsList.mockResolvedValue({ models: [modelRow(
      'zh',
      state === 'ready' ? { state, cacheDir: '/cache/zh' } : { state, receivedBytes: 10, totalBytes: 100 },
      { name: 'Local model' },
    )] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Harness callbacks={callbacks} />)
    const label = state === 'ready' ? en.modelRemove : en.modelCancel
    fireEvent.click(await screen.findByRole('button', { name: label }))
    expect(callbacks.modelsRemove).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: label }))
    await screen.findByText('Model is busy')
    expect(screen.getByRole('button', { name: label })).not.toBeNull()
    expect(screen.queryByRole('button', { name: en.modelDownload })).toBeNull()
  })
})
