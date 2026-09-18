// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceSettingsStore } from '../src/client/voice-settings.ts'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('browser-local voice preferences', () => {
  it('rehydrates every preference and resets model and device to automatic defaults', () => {
    const first = createVoiceSettingsStore()
    first.set({ enabled: false, dictationMode: 'hold', sttModel: 'chosen', microphoneDeviceId: 'browser-device' })
    const reloaded = createVoiceSettingsStore()
    expect(reloaded.getSnapshot()).toEqual({ enabled: false, dictationMode: 'hold', sttModel: 'chosen', microphoneDeviceId: 'browser-device' })
    reloaded.set({ ...reloaded.getSnapshot(), sttModel: null, microphoneDeviceId: null })
    expect(createVoiceSettingsStore().getSnapshot()).toEqual({ enabled: false, dictationMode: 'hold', sttModel: null, microphoneDeviceId: null })
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe('dsh.voice.settings')
  })

  it('validates persisted values and keeps defaults for invalid entries', () => {
    localStorage.setItem('dsh.voice.settings', JSON.stringify({ enabled: 'yes', dictationMode: 'unknown', sttModel: 123, microphoneDeviceId: [] }))
    expect(createVoiceSettingsStore().getSnapshot()).toEqual({ enabled: true, dictationMode: 'toggle', sttModel: null, microphoneDeviceId: null })
  })

  it('keeps live preferences usable when browser storage rejects writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('quota', 'QuotaExceededError') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const settings = createVoiceSettingsStore()
    settings.set({ ...settings.getSnapshot(), dictationMode: 'hold' })
    expect(settings.getSnapshot().dictationMode).toBe('hold')
    expect(console.error).toHaveBeenCalled()
  })
})
