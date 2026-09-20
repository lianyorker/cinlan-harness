// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { SettingsMetadataService } from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-metadata.ts'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/apply.ts'
import { createVoiceSettingsStore } from '../src/client/voice-settings.ts'
import { en, zh } from '../src/client/locales.ts'
import { createVoiceRemote, modelRow } from './voice-fixtures.client.ts'

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const voice = createVoiceRemote()
  new TestRemote(ctx, { voice })
  new SettingsMetadataService(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const scope = new Context()
  onTestFinished(async () => { await scope.fiber.dispose() })
  let current = 's1'
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    scope: vi.fn(() => scope),
  }
  ctx.provide('sessions', sessions as never)
  let draft = ''
  const setDraft = vi.fn((text: string) => { draft = text })
  const notify = vi.fn()
  ctx.provide('conversation', {
    input: { for: vi.fn(() => ({ state: { getSnapshot: () => ({ draft }) }, setDraft, notify })) },
  } as never)
  return {
    ctx,
    voice,
    setDraft,
    notify,
    readDraft: () => draft,
    locale,
    sessions,
    slots: ctx.get('slots') as SlotRegistry,
    setCurrent: (sessionId: string) => { current = sessionId },
  }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'conversation.input.right': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
}

function stubAudioContext(): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => {})
  const processor = {
    onaudioprocess: null as ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null,
    connect: () => {
      processor.onaudioprocess?.({
        inputBuffer: { getChannelData: () => new Float32Array([0, 0]) },
      })
    },
    disconnect: vi.fn(),
  }
  class FakeAudioContext {
    sampleRate = 16_000
    destination = {}
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
    createScriptProcessor() { return processor }
    createGain() { return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() } }
    close() { return close() }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  return { close }
}

describe('ui-voice-dictation apply', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('declares only the services it drives', () => {
    expect(inject).toEqual(['settingsMetadata', 'slots', 'locale', 'sessions', 'conversation', 'remote', 'remote.voice'])
  })

  it('registers the Voice settings page once declared', async () => {
    const b = await bench()
    declare(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const sections = b.slots.entries('settings.section')
    expect(sections).toHaveLength(1)
    expect(sections[0]?.options.id).toBe('voice')
    expect(b.slots.entries('conversation.input.right').map(entry => entry.options.id)).toEqual(['voice-dictation'])
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
  })

  it('registers every contribution when Voice activates before its slots are declared', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const disposeDeclaration = declare(b.slots)
    expect(b.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['voice'])
    expect(b.slots.entries('conversation.input.right').map(entry => entry.options.id)).toEqual(['voice-dictation'])

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
    disposeDeclaration()
  })

  it('installs a document keydown listener and removes it on dispose', async () => {
    const b = await bench()
    declare(b.slots)
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    await fiber.dispose()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
  })

  it('Ctrl+Shift+E requests the microphone, and a second Ctrl+Shift+E stops the recording and transcribes into the draft', async () => {
    const b = await bench()
    declare(b.slots)
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
    stubAudioContext()

    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    b.setCurrent('s2')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    expect(b.setDraft).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    b.setCurrent('s1')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith('hello world') })
    expect(track.stop).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('keeps Ctrl+E refresh available and ignores Ctrl+Shift+E in editable, repeated, composing, or preempted events', async () => {
    const b = await bench()
    declare(b.slots)
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, repeat: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, isComposing: true }))
    const preempted = new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true, cancelable: true })
    preempted.preventDefault()
    document.dispatchEvent(preempted)
    expect(getUserMedia).not.toHaveBeenCalled()

    await fiber.dispose()
    input.remove()
  })

  it('awaits in-flight transcription on dispose without publishing its result', async () => {
    const b = await bench()
    declare(b.slots)
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudioContext()

    let releaseTranscribe!: () => void
    const transcribeGate = new Promise<void>((resolve) => { releaseTranscribe = resolve })
    onTestFinished(releaseTranscribe)
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
    b.voice.transcribe.mockImplementation(async () => {
      await transcribeGate
      return { ok: true, value: { text: 'must not publish' } }
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(b.voice.transcribe).toHaveBeenCalledOnce()
    })
    const signal = b.voice.transcribe.mock.calls[0]![1]!
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(b.voice.modelsList).toHaveBeenCalledExactlyOnceWith(signal)

    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await vi.waitFor(() => { expect(signal.aborted).toBe(true) })
    expect(disposed).toBe(false)
    releaseTranscribe()
    await disposal

    expect(b.setDraft).not.toHaveBeenCalled()
    expect(b.notify).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })
  it.each(['modelsList', 'transcribe'] as const)('aborts pending %s on dispose and awaits settlement without draft or error publication', async (method) => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Keep this draft')
    b.setDraft.mockClear()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const entered = Promise.withResolvers<AbortSignal>()
    const aborted = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    onTestFinished(() => { release.resolve(undefined) })
    const cancelled = async (signal?: AbortSignal) => {
      if (signal === undefined) throw new Error('voice Remote call has no cancellation signal')
      signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
      entered.resolve(signal)
      await aborted.promise
      await release.promise
      return { ok: false as const, error: new RemoteError('gateway/cancelled', 'Remote invocation was aborted', {}) }
    }
    if (method === 'modelsList') b.voice.modelsList.mockImplementation(cancelled)
    else {
      b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
      b.voice.transcribe.mockImplementation((_request, signal) => cancelled(signal))
    }
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    const signal = await entered.promise
    expect(signal.aborted).toBe(false)
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await aborted.promise
    expect(signal.aborted).toBe(true)
    expect(disposed).toBe(false)
    release.resolve(undefined)
    await disposal
    expect(b.readDraft()).toBe('Keep this draft')
    expect(b.setDraft).not.toHaveBeenCalled()
    expect(b.notify).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
    if (method === 'modelsList') expect(b.voice.transcribe).not.toHaveBeenCalled()
  })

  it('registers localized public metadata with its section declaration lifetime', async () => {
    localStorage.setItem('dsh.voice.settings', JSON.stringify({ enabled: true, sttModel: 'private-model', microphoneDeviceId: 'private-device', dictationMode: 'hold' }))
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.ctx.settingsMetadata.getSnapshot().items).toEqual([])
    const disposeDeclaration = declare(b.slots)
    b.locale.setLocale('en')
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(en.enableDictation) })
    const items = b.ctx.settingsMetadata.getSnapshot().items
    expect(items.map(item => [item.id, item.anchorId])).toEqual([
      ['enabled', 'voice-enabled'], ['mode', 'voice-mode'], ['permission', 'voice-permission'],
      ['device', 'voice-device'], ['engine', 'voice-engine'], ['model', 'voice-model'], ['test', 'voice-test'],
    ])
    expect(JSON.stringify(items)).not.toContain('private-')
    b.locale.setLocale('zh')
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.enableDictation) })
    disposeDeclaration()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] }) })
    declare(b.slots)
    expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(7)
    await fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  })

  it('uses persisted device and model preferences and appends to the latest draft without sending it', async () => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), microphoneDeviceId: 'desk', sttModel: 'preferred' })
    const b = await bench()
    declare(b.slots)
    b.setDraft('Original draft')
    b.setDraft.mockClear()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudioContext()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    onTestFinished(release)
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [
      modelRow('first', { state: 'ready', cacheDir: '/cache/first' }),
      modelRow('preferred', { state: 'ready', cacheDir: '/cache/preferred' }),
    ] } })
    b.voice.transcribe.mockImplementation(async () => {
      await pending
      return { ok: true, value: { text: '  dictated words  ' } }
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'desk' } } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(b.voice.transcribe).toHaveBeenCalledOnce()
      const signal = b.voice.modelsList.mock.calls[0]![0]!
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
      expect(b.voice.transcribe).toHaveBeenCalledExactlyOnceWith({ modelId: 'preferred', pcm16kMonoBase64: 'AAAAAAAAAAA=' }, signal)
    })
    expect(track.stop).toHaveBeenCalledOnce()
    b.setDraft('Edited while transcribing')
    b.setDraft.mockClear()
    release()
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith('Edited while transcribing dictated words') })
    expect(b.readDraft()).toBe('Edited while transcribing dictated words')
    expect(b.notify).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it.each(['model-list', 'no-model', 'transcribe'] as const)('preserves the original draft on %s failure and releases the microphone', async (failure) => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Do not lose this draft')
    b.setDraft.mockClear()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudioContext()
    const refusal = { ok: false as const, error: new RemoteError('gateway/internal', 'Host unavailable', {}) }
    if (failure === 'model-list') b.voice.modelsList.mockResolvedValue(refusal)
    else b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: failure === 'no-model'
      ? []
      : [modelRow('first', { state: 'ready', cacheDir: '/cache/first' })] } })
    b.voice.transcribe.mockResolvedValue(refusal)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledWith('error', expect.any(String)) })
    expect(b.readDraft()).toBe('Do not lose this draft')
    expect(b.setDraft).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it('releases a held recording when a modifier is released after switching sessions', async () => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), dictationMode: 'hold' })
    const b = await bench()
    declare(b.slots)
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    stubAudioContext()
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('first', { state: 'ready', cacheDir: '/cache/first' })] } })
    b.voice.transcribe.mockResolvedValue({ ok: true, value: { text: 'held recording' } })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    b.setCurrent('s2')
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', shiftKey: true }))
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith('held recording') })
    expect(b.sessions.scope).toHaveBeenLastCalledWith('s1')
    expect(track.stop).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
  it('closes active capture on plugin disposal without transcribing or modifying the draft', async () => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Keep draft')
    b.setDraft.mockClear()
    const track = { stop: vi.fn() }
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await fiber.dispose()
    expect(audio.close).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(b.voice.modelsList).not.toHaveBeenCalled()
    expect(b.voice.transcribe).not.toHaveBeenCalled()
    expect(b.readDraft()).toBe('Keep draft')
    expect(b.setDraft).not.toHaveBeenCalled()
  })
})
