// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en, type VoiceSettingsKey } from '../src/client/locales.ts'
import { VoiceSettingsSection, type VoiceSettingsSectionProps } from '../src/client/VoiceSettingsSection.tsx'

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals() })

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function props(): VoiceSettingsSectionProps {
  return { t: (key: VoiceSettingsKey) => en[key] } as unknown as VoiceSettingsSectionProps
}

/** Dispatch by URL: engine.status defaults to ok unless overridden. */
function fetchDispatcher(overrides: {
  engineStatus?: unknown
  modelsList?: unknown[]
  modelsDownload?: unknown
  modelsRemove?: unknown
} = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url === '/voice/api/engine.status') {
      return jsonResponse({ ok: true, value: overrides.engineStatus ?? { ok: true } })
    }
    if (url === '/voice/api/models.download') {
      return jsonResponse({ ok: true, value: overrides.modelsDownload ?? { cacheDir: '/cache/x' } })
    }
    if (url === '/voice/api/models.remove') {
      return jsonResponse({ ok: true, value: overrides.modelsRemove ?? {} })
    }
    return jsonResponse({ ok: true, value: { models: overrides.modelsList ?? [] } })
  })
}

describe('VoiceSettingsSection', () => {
  it('renders the shipped model roster with download controls and status', async () => {
    vi.stubGlobal('fetch', fetchDispatcher({
      modelsList: [
        {
          definition: { id: 'zh', name: 'zh-model', approximateBytes: 74_004_050 },
          status: { state: 'not-downloaded' },
        },
        {
          definition: { id: 'bi', name: 'bilingual-model', approximateBytes: 511_274_346 },
          status: { state: 'ready', cacheDir: '/cache/bi' },
        },
      ],
    }))
    render(<VoiceSettingsSection {...props()} />)
    await screen.findByText('zh-model')
    const panel = document.querySelector('[data-voice-settings-panel="true"]')
    expect(panel).not.toBeNull()
    expect(panel?.querySelector('[data-model-count="2"]')).not.toBeNull()
    expect(screen.getByText('bilingual-model')).not.toBeNull()
    expect(screen.getByRole('button', { name: en.download })).not.toBeNull()
    expect(screen.getByText(text => text.includes(en.statusReady))).not.toBeNull()
    // The ready model has no download button; only the not-downloaded one does.
    expect(screen.getAllByRole('button', { name: en.download })).toHaveLength(1)
    expect(screen.getByRole('button', { name: en.remove })).not.toBeNull()
    await screen.findByText(en.engineOk)
  })


  it('confirms and removes a ready model', async () => {
    let removed = false
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/voice/api/engine.status') return jsonResponse({ ok: true, value: { ok: true } })
      if (url === '/voice/api/models.remove') {
        removed = true
        return jsonResponse({ ok: true, value: {} })
      }
      const status = removed ? { state: 'not-downloaded' } : { state: 'ready', cacheDir: '/cache/zh' }
      return jsonResponse({ ok: true, value: { models: [{ definition: { id: 'zh', name: 'zh-model', approximateBytes: 100 }, status }] } })
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<VoiceSettingsSection {...props()} />)

    fireEvent.click(await screen.findByRole('button', { name: en.remove }))

    await waitFor(() => { expect(fetchMock).toHaveBeenCalledWith('/voice/api/models.remove', expect.anything()) })
    await screen.findByRole('button', { name: en.download })
    expect(window.confirm).toHaveBeenCalledWith(en.removeConfirm)
  })

  it('shows the load-failed message when models.list rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/voice/api/engine.status') return jsonResponse({ ok: true, value: { ok: true } })
      return new Response('boom', { status: 500 })
    }))
    render(<VoiceSettingsSection {...props()} />)
    await screen.findByText(en.loadFailed)
  })

  it('starts a download and refreshes on click', async () => {
    const fetchMock = fetchDispatcher({
      modelsList: [{ definition: { id: 'zh', name: 'zh-model', approximateBytes: 100 }, status: { state: 'not-downloaded' } }],
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<VoiceSettingsSection {...props()} />)
    const download = await screen.findByRole('button', { name: en.download })
    fireEvent.click(download)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/voice/api/models.download', expect.anything())
    })
  })

  it('keeps model rows and surfaces the download failure when the terminal refresh fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/voice/api/engine.status') return jsonResponse({ ok: true, value: { ok: true } })
      if (url === '/voice/api/models.download') {
        return new Response(JSON.stringify({ ok: false, error: { code: 'download-failed', message: 'archive corrupt' } }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (fetchMock.mock.calls.filter(call => call[0] === '/voice/api/models.list').length > 1) {
        return new Response('status unavailable', { status: 500 })
      }
      return jsonResponse({
        ok: true,
        value: { models: [{ definition: { id: 'zh', name: 'zh-model', approximateBytes: 100 }, status: { state: 'not-downloaded' } }] },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<VoiceSettingsSection {...props()} />)
    fireEvent.click(await screen.findByRole('button', { name: en.download }))
    await screen.findByText(text => text.includes('archive corrupt'))
    expect(screen.queryByText(en.loadFailed)).toBeNull()
    expect(screen.getByText('zh-model')).not.toBeNull()
  })

  it('requests microphone permission and restores it after the settings section remounts', async () => {
    vi.stubGlobal('fetch', fetchDispatcher())
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const view = render(<VoiceSettingsSection {...props()} />)
    expect(screen.getByText(en.micUnknown)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.micRequest }))
    await screen.findByText(en.micGranted)
    view.unmount()
    vi.stubGlobal('navigator', {})
    render(<VoiceSettingsSection {...props()} />)
    await screen.findByText(en.micGranted)
  })

  it('shows installing after download bytes complete and then converges to ready', async () => {
    let modelPhase: 'downloading' | 'extracting' | 'ready' = 'downloading'
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/voice/api/engine.status') return jsonResponse({ ok: true, value: { ok: true } })
      if (url === '/voice/api/models.download') return jsonResponse({ ok: true, value: { cacheDir: '/cache/zh' } })
      const status = modelPhase === 'downloading'
        ? { state: 'downloading', receivedBytes: 100, totalBytes: 100 }
        : modelPhase === 'extracting'
          ? { state: 'extracting', receivedBytes: 100, totalBytes: 100 }
          : { state: 'ready', cacheDir: '/cache/zh' }
      return jsonResponse({ ok: true, value: { models: [{ definition: { id: 'zh', name: 'zh-model', approximateBytes: 100 }, status }] } })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<VoiceSettingsSection {...props()} />)
    await screen.findByText(text => text.includes(en.downloading))
    modelPhase = 'extracting'
    await waitFor(() => { expect(fetchMock.mock.calls.filter(call => call[0] === '/voice/api/models.list').length).toBeGreaterThan(1) }, { timeout: 2500 })
    await waitFor(() => {
      expect(screen.getAllByText(text => text.includes(en.installing)).length).toBeGreaterThan(0)
    }, { timeout: 2500 })
    modelPhase = 'ready'
    await screen.findByText(text => text.includes(en.statusReady), {}, { timeout: 2500 })
  })

  it('shows the engine ready state under the Engine sub-section', async () => {
    vi.stubGlobal('fetch', fetchDispatcher())
    render(<VoiceSettingsSection {...props()} />)
    expect(await screen.findByText(en.engineSectionTitle)).not.toBeNull()
    await screen.findByText(en.engineOk)
  })

  it('shows a copyable repair command when the engine is degraded', async () => {
    vi.stubGlobal('fetch', fetchDispatcher({
      engineStatus: {
        ok: false,
        cause: 'Cannot find module sherpa-onnx-node',
        command: 'dsh plugin --profile "web" install',
        profile: null,
        note: 'If pnpm blocked the sherpa-onnx-node native build scripts, set `allowBuilds: sherpa-onnx-node: true`.',
      },
    }))
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<VoiceSettingsSection {...props()} />)
    await screen.findByText(en.engineDegraded)
    expect(screen.getByText('dsh plugin --profile "web" install')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.copyCommand }))
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('dsh plugin --profile "web" install') })
    await screen.findByText(en.copyCommandCopied)
  })
})
