// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVoiceSettingsStore } from '../src/client/voice-settings.ts'

afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('browser-local voice preferences', () => {
  it.each([
    ['zh-streaming-zipformer-14m', 'zipformer-streaming-zh-14m'],
    ['bilingual-streaming-zipformer', 'zipformer-bilingual-zh-en'],
    ['en-streaming-zipformer-20m', 'zipformer-streaming-en-20m'],
    ['bilingual-streaming-paraformer', 'paraformer-bilingual-zh-en'],
  ])('migrates the previous model selector %s without resetting other preferences', (previous, current) => {
    localStorage.setItem('dsh.voice.settings', JSON.stringify({ enabled: false, dictationMode: 'hold', sttModel: previous, microphoneDeviceId: 'desk' }))
    expect(createVoiceSettingsStore().getSnapshot()).toEqual({ enabled: false, dictationMode: 'hold', sttModel: current, microphoneDeviceId: 'desk', language: 'auto', terminalConfirmBeforeInsert: false })
    expect(JSON.parse(localStorage.getItem('dsh.voice.settings')!)).toEqual(expect.objectContaining({ sttModel: current }))
  })

  it('rehydrates every preference and resets model and device to automatic defaults', () => {
    const first = createVoiceSettingsStore()
    first.set({ enabled: false, dictationMode: 'hold', sttModel: 'chosen', microphoneDeviceId: 'browser-device', language: 'en', terminalConfirmBeforeInsert: true })
    const reloaded = createVoiceSettingsStore()
    expect(reloaded.getSnapshot()).toEqual({ enabled: false, dictationMode: 'hold', sttModel: 'chosen', microphoneDeviceId: 'browser-device', language: 'en', terminalConfirmBeforeInsert: true })
    reloaded.set({ ...reloaded.getSnapshot(), sttModel: null, microphoneDeviceId: null })
    expect(createVoiceSettingsStore().getSnapshot()).toEqual({ enabled: false, dictationMode: 'hold', sttModel: null, microphoneDeviceId: null, language: 'en', terminalConfirmBeforeInsert: true })
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe('dsh.voice.settings')
  })

  it('validates persisted values and keeps defaults for invalid entries', () => {
    localStorage.setItem('dsh.voice.settings', JSON.stringify({ enabled: 'yes', dictationMode: 'unknown', sttModel: 123, microphoneDeviceId: [] }))
    expect(createVoiceSettingsStore().getSnapshot()).toEqual({ enabled: true, dictationMode: 'toggle', sttModel: null, microphoneDeviceId: null, language: 'auto', terminalConfirmBeforeInsert: false })
  })

  it('defaults the terminal confirmation preference for older stored settings', () => {
    localStorage.setItem('dsh.voice.settings', JSON.stringify({ enabled: false }))
    expect(createVoiceSettingsStore().getSnapshot().terminalConfirmBeforeInsert).toBe(false)
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
