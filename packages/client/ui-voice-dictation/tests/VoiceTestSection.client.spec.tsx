// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { VoiceTestSection } from '../src/client/VoiceTestSection.tsx'
import { en } from '../src/client/locales.ts'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { createVoiceCallbacks } from './voice-fixtures.client.ts'

const settings = { enabled: true, dictationMode: 'toggle' as const, sttModel: null, microphoneDeviceId: 'chosen-mic' }
const t = makeTranslate(en, commonEn)

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })

function media(failSetup = false) {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const getUserMedia = vi.fn(async () => stream)
  const close = vi.fn(async () => {})
  const disconnect = vi.fn()
  const processor = {
    onaudioprocess: null as ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
    connect: vi.fn(), disconnect,
  }
  class AudioContextMock {
    sampleRate = 48_000
    destination = {}
    createMediaStreamSource() { return { connect: vi.fn(), disconnect } }
    createScriptProcessor() {
      if (failSetup) throw new Error('audio setup failed')
      return processor
    }
    createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect } }
    close = close
  }
  vi.stubGlobal('AudioContext', AudioContextMock)
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
  return { stop, stream, getUserMedia, close, processor, disconnect,
    capture: (samples: Float32Array) => processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } }),
  }
}

async function start() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.testStart })) })
}

describe('settings microphone test', () => {
  it('captures only after a click and transcribes the resampled captured samples after releasing tracks', async () => {
    const mic = media()
    const callbacks = createVoiceCallbacks()
    callbacks.transcribe.mockImplementation(async (_model, encoded) => {
      expect(mic.stop).toHaveBeenCalledOnce()
      expect(mic.close).toHaveBeenCalledOnce()
      const bytes = Buffer.from(encoded, 'base64')
      expect(Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4))).toEqual([0.25, -0.5])
      return { text: 'A captured voice sample.' }
    })
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    expect(mic.getUserMedia).not.toHaveBeenCalled()
    await start()
    expect(mic.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: { deviceId: { exact: 'chosen-mic' }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    act(() => { mic.capture(new Float32Array([0.25, 0.75, 1, -0.5, -0.25, 0])) })
    expect(screen.getByRole('meter').getAttribute('value')).not.toBe('0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.testStop })) })
    expect(screen.getByLabelText(en.testTranscript).textContent).toBe('A captured voice sample.')
    expect(callbacks.transcribe.mock.calls[0]?.[0]).toBe('ready-model')
    expect(mic.processor.onaudioprocess).toBeNull()
  })

  it.each(['cancel', 'unmount'] as const)('releases a permission result arriving after %s without recording', async (action) => {
    const mic = media()
    let grant!: (stream: MediaStream) => void
    mic.getUserMedia.mockImplementation(() => new Promise((resolve) => { grant = resolve }))
    const callbacks = createVoiceCallbacks()
    const view = render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: en.testCancel }))
    else view.unmount()
    await act(async () => { grant(mic.stream) })
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(mic.close).not.toHaveBeenCalled()
    expect(callbacks.transcribe).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'unmount', 'disable'] as const)('stops active recording on %s without transcription', async (action) => {
    const mic = media()
    const callbacks = createVoiceCallbacks()
    const view = render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    await act(async () => {
      if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: en.testCancel }))
      else if (action === 'unmount') view.unmount()
      else view.rerender(<VoiceTestSection settings={{ ...settings, enabled: false }} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    })
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(mic.close).toHaveBeenCalledOnce()
    expect(mic.disconnect).toHaveBeenCalledTimes(3)
    expect(callbacks.transcribe).not.toHaveBeenCalled()
  })

  it('aborts pending transcription and ignores its late result', async () => {
    const mic = media()
    const callbacks = createVoiceCallbacks()
    let complete!: (value: { text: string }) => void
    callbacks.transcribe.mockImplementation(() => new Promise((resolve) => { complete = resolve }))
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    act(() => { mic.capture(new Float32Array([0.5, 0.5, 0.5])) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.testStop })) })
    fireEvent.click(screen.getByRole('button', { name: en.testCancel }))
    expect(callbacks.transcribe.mock.calls[0]?.[2]?.aborted).toBe(true)
    await act(async () => { complete({ text: 'discard this result' }) })
    expect(screen.queryByText('discard this result')).toBeNull()
    expect(screen.getByText(en.testCancelled)).not.toBeNull()
  })

  it('bounds captured samples even if the wall clock timer is delayed', async () => {
    const mic = media()
    const callbacks = createVoiceCallbacks()
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    await act(async () => { mic.capture(new Float32Array(48_000 * 11).fill(0.125)) })
    expect(Buffer.from(callbacks.transcribe.mock.calls[0]![1], 'base64').length).toBe(16_000 * 10 * 4)
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(screen.getByText(en.testComplete)).not.toBeNull()
  })

  it('stops on the wall clock bound when audio callbacks stop arriving', async () => {
    vi.useFakeTimers()
    const mic = media()
    const callbacks = createVoiceCallbacks()
    callbacks.transcribe.mockResolvedValue({ text: '' })
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(screen.getByText(en.testEmpty)).not.toBeNull()
  })

  it.each(['NotAllowedError', 'NotFoundError'] as const)('localizes %s instead of exposing browser error text', async (name) => {
    const mic = media()
    mic.getUserMedia.mockRejectedValue(new DOMException('raw browser detail', name))
    const callbacks = createVoiceCallbacks()
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    expect(screen.getByRole('alert').textContent).toBe(name === 'NotAllowedError' ? en.testPermissionDenied : en.testCaptureFailed)
    expect(callbacks.transcribe).not.toHaveBeenCalled()
  })

  it('closes partially constructed capture and tracks when audio setup fails', async () => {
    const mic = media(true)
    const callbacks = createVoiceCallbacks()
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(mic.close).toHaveBeenCalledOnce()
    expect(mic.disconnect).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert').textContent).toBe(en.testCaptureFailed)
    expect(callbacks.transcribe).not.toHaveBeenCalled()
  })

  it('localizes Host transcription failure after releasing capture', async () => {
    const mic = media()
    const callbacks = createVoiceCallbacks()
    callbacks.transcribe.mockRejectedValue(new Error('native detail'))
    render(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    await start()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: en.testStop })) })
    expect(mic.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert').textContent).toBe(en.testTranscribeFailed)
  })

  it('disables capture without a ready model or microphone support', () => {
    const callbacks = createVoiceCallbacks()
    media()
    const view = render(<VoiceTestSection settings={settings} modelId={null} transcribe={callbacks.transcribe} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.testStart }).disabled).toBe(true)
    vi.stubGlobal('navigator', {})
    view.rerender(<VoiceTestSection settings={settings} modelId="ready-model" transcribe={callbacks.transcribe} t={t} />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en.testStart }).disabled).toBe(true)
  })
})
