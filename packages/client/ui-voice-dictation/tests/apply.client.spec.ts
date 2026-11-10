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
import { stubAudioCapture } from './audio-fixture.client.ts'

async function bench() {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const voice = createVoiceRemote()
  voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
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
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

function stubAudioContext() {
  const audio = stubAudioCapture()
  audio.processor.connect.mockImplementation(() => { audio.capture(new Float32Array(6)) })
  return audio
}

async function waitForCaptureStart(audio: ReturnType<typeof stubAudioContext>): Promise<void> {
  await vi.waitFor(() => { expect(audio.resume).toHaveBeenCalledOnce() })
}

function microphoneTrack() {
  return Object.assign(new EventTarget(), { stop: vi.fn() })
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
    expect(b.slots.entries('shell.overlay').map(entry => entry.options.id)).toEqual(['voice-dictation.indicator'])
    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('registers every contribution when Voice activates before its slots are declared', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('settings.section')).toHaveLength(0)

    const disposeDeclaration = declare(b.slots)
    expect(b.slots.entries('settings.section').map(entry => entry.options.id)).toEqual(['voice'])
    expect(b.slots.entries('conversation.input.right').map(entry => entry.options.id)).toEqual(['voice-dictation'])
    expect(b.slots.entries('shell.overlay').map(entry => entry.options.id)).toEqual(['voice-dictation.indicator'])

    await fiber.dispose()
    expect(b.slots.entries('settings.section')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
    expect(b.slots.entries('shell.overlay')).toHaveLength(0)
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
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
    const audio = stubAudioContext()

    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await waitForCaptureStart(audio)
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

  it('streams PCM to an online model and inserts only its final transcript', async () => {
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' }, { streaming: true })] } })
    const final = Promise.withResolvers<{ readonly type: 'final'; readonly text: string }>()
    const handle = Object.assign((async function* () {
      yield { type: 'partial' as const, text: 'hello' }
      yield await final.promise
    })(), {
      send: vi.fn(),
      end: vi.fn(() => final.resolve({ type: 'final', text: 'hello world' })),
      dispose: vi.fn(),
    })
    b.voice.transcribeStream.mockReturnValue(handle)
    const audio = stubAudioContext()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await waitForCaptureStart(audio)
    audio.capture(new Float32Array(4_800).fill(0.1))
    await vi.waitFor(() => { expect(handle.send).toHaveBeenCalled() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith('hello world') })
    expect(handle.send.mock.calls[0]?.[0]).toMatchObject({ pcm16kMonoBase64: expect.any(String) })
    expect(handle.end).toHaveBeenCalledOnce()
    expect(b.voice.transcribe).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    await fiber.dispose()
  })

  it.each([true, false] as const)('asks before terminal insertion and honors confirmation=%s', async (confirmed) => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), terminalConfirmBeforeInsert: true })
    const b = await bench()
    declare(b.slots)
    const terminal = document.createElement('div')
    terminal.dataset.dshTerminalTab = ''
    terminal.tabIndex = 0
    document.body.append(terminal)
    terminal.focus()
    const inserted: string[] = []
    terminal.addEventListener('dsh:voice-insert-text', (event) => {
      const detail = (event as CustomEvent<{ text: string; accept: () => void }>).detail
      inserted.push(detail.text)
      detail.accept()
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(confirmed)
    const track = microphoneTrack()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
    const audio = stubAudioContext()
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
    b.voice.transcribe.mockResolvedValue({ ok: true, value: { text: 'run status' } })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await waitForCaptureStart(audio)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(track.stop).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(confirm).toHaveBeenCalledExactlyOnceWith(en.terminalConfirmBeforeInsertMessage) })
    if (confirmed) await vi.waitFor(() => { expect(inserted).toEqual(['run status']) })
    else expect(inserted).toEqual([])
    expect(b.setDraft).not.toHaveBeenCalled()

    await fiber.dispose()
    terminal.remove()
  })

  it('inserts into a terminal without prompting when confirmation is disabled', async () => {
    const b = await bench()
    declare(b.slots)
    const terminal = document.createElement('div')
    terminal.dataset.dshTerminalTab = ''
    terminal.tabIndex = 0
    document.body.append(terminal)
    terminal.focus()
    const inserted: string[] = []
    terminal.addEventListener('dsh:voice-insert-text', (event) => {
      const detail = (event as CustomEvent<{ text: string; accept: () => void }>).detail
      inserted.push(detail.text)
      detail.accept()
    })
    const confirm = vi.spyOn(window, 'confirm')
    const track = microphoneTrack()
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } })
    const audio = stubAudioContext()
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('zh', { state: 'ready', cacheDir: '/cache/zh' })] } })
    b.voice.transcribe.mockResolvedValue({ ok: true, value: { text: 'run status' } })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await waitForCaptureStart(audio)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(track.stop).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(inserted).toEqual(['run status']) })
    expect(confirm).not.toHaveBeenCalled()

    await fiber.dispose()
    terminal.remove()
  })

  it('stops capture and preserves the draft when the microphone track ends unexpectedly', async () => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Keep this draft')
    b.setDraft.mockClear()
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await waitForCaptureStart(audio)
    track.dispatchEvent(new Event('ended'))

    await vi.waitFor(() => {
      expect(audio.close).toHaveBeenCalledOnce()
      expect(track.stop).toHaveBeenCalledOnce()
      expect(b.notify).toHaveBeenCalledWith('error', en.microphoneCaptureLost)
    })
    expect(b.voice.modelsList).toHaveBeenCalledOnce()
    expect(b.voice.transcribe).not.toHaveBeenCalled()
    expect(b.readDraft()).toBe('Keep this draft')
    expect(b.setDraft).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('rejects a microphone track that ends before capture listeners are attached', async () => {
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    Object.defineProperty(track, 'readyState', { value: 'ended' })
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await vi.waitFor(() => {
      expect(audio.close).toHaveBeenCalledOnce()
      expect(track.stop).toHaveBeenCalledOnce()
      expect(b.notify).toHaveBeenCalledWith('error', en.microphoneCaptureLost)
    })
    expect(b.voice.transcribe).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('awaits disconnected capture cleanup on disposal without publishing its late error', async () => {
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const closed = Promise.withResolvers<undefined>()
    audio.close.mockReturnValue(closed.promise)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await waitForCaptureStart(audio)
    track.dispatchEvent(new Event('ended'))
    await vi.waitFor(() => { expect(audio.close).toHaveBeenCalledOnce() })
    const disposal = fiber.dispose()
    expect(b.notify).not.toHaveBeenCalled()
    closed.resolve(undefined)
    await disposal

    expect(b.notify).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(b.voice.modelsList).toHaveBeenCalledOnce()
    expect(b.voice.transcribe).not.toHaveBeenCalled()
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
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()

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
    await waitForCaptureStart(audio)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(b.voice.transcribe).toHaveBeenCalledOnce()
    })
    const signal = b.voice.transcribe.mock.calls[0]![1]!
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    expect(b.voice.modelsList).toHaveBeenCalledOnce()
    expect(b.voice.modelsList.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)

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
    const track = microphoneTrack()
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
    if (method === 'transcribe') {
      await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
      await waitForCaptureStart(audio)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    }
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
    if (method === 'modelsList') {
      expect(track.stop).not.toHaveBeenCalled()
      expect(audio.close).not.toHaveBeenCalled()
      expect(b.voice.transcribe).not.toHaveBeenCalled()
    } else {
      expect(track.stop).toHaveBeenCalledOnce()
      expect(audio.close).toHaveBeenCalledOnce()
    }
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
      ['enabled', 'voice-enabled'], ['mode', 'voice-mode'], ['terminal-confirm', 'voice-terminal-confirm'], ['permission', 'voice-permission'],
      ['device', 'voice-device'], ['language', 'voice-language'], ['engine', 'voice-engine'], ['model', 'voice-model'], ['openai', 'voice-openai'], ['test', 'voice-test'],
    ])
    expect(JSON.stringify(items)).not.toContain('private-')
    b.locale.setLocale('zh')
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot().items[0]?.title).toBe(zh.enableDictation) })
    disposeDeclaration()
    await vi.waitFor(() => { expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] }) })
    declare(b.slots)
    expect(b.ctx.settingsMetadata.getSnapshot().items).toHaveLength(10)
    await fiber.dispose()
    expect(b.ctx.settingsMetadata.getSnapshot()).toEqual({ sections: [], items: [] })
  })

  it.each([
    ['', 'dictated words', 'dictated words'],
    ['  ', 'dictated words', '  dictated words'],
    ['Edited while transcribing', 'dictated words', 'Edited while transcribing dictated words'],
    ['Edited while transcribing ', 'dictated words', 'Edited while transcribing dictated words'],
    ['Edited while transcribing\t', 'dictated words', 'Edited while transcribing\tdictated words'],
    ['Edited while transcribing\n', 'dictated words', 'Edited while transcribing\ndictated words'],
    ['你好', '世界', '你好世界'],
    ['你好 ', '世界', '你好 世界'],
    ['hello', '.', 'hello.'],
    ['Hello.', 'World', 'Hello. World'],
    ['(', 'hello', '(hello'],
    ['𠀀', 'hello', '𠀀hello'],
  ])('uses persisted preferences and appends to the latest draft %j without sending it', async (draft, transcript, expected) => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), microphoneDeviceId: 'desk', sttModel: 'preferred' })
    const b = await bench()
    declare(b.slots)
    b.setDraft('Original draft')
    b.setDraft.mockClear()
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    onTestFinished(release)
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [
      modelRow('first', { state: 'ready', cacheDir: '/cache/first' }),
      modelRow('preferred', { state: 'ready', cacheDir: '/cache/preferred' }),
    ] } })
    b.voice.transcribe.mockImplementation(async () => {
      await pending
      return { ok: true, value: { text: `  ${transcript}  ` } }
    })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await waitForCaptureStart(audio)
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'desk' } } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(b.voice.transcribe).toHaveBeenCalledOnce()
      const signal = b.voice.modelsList.mock.calls[0]![0]!
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal.aborted).toBe(false)
      expect(b.voice.transcribe).toHaveBeenCalledExactlyOnceWith({ modelId: 'preferred', pcm16kMonoBase64: 'AAAAAAAAAAA=' }, expect.any(AbortSignal))
    })
    expect(track.stop).toHaveBeenCalledOnce()
    b.setDraft(draft)
    b.setDraft.mockClear()
    release()
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith(expected) })
    expect(b.readDraft()).toBe(expected)
    expect(b.notify).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('falls back to the system microphone when the saved device is missing and keeps the saved preference', async () => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), microphoneDeviceId: 'removed-mic' })
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    const stream = { getTracks: () => [track] }
    const getUserMedia = vi.fn()
      .mockRejectedValueOnce(new DOMException('device not found', 'NotFoundError'))
      .mockResolvedValueOnce(stream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledTimes(2) })
    await waitForCaptureStart(audio)
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'removed-mic' } },
    })
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    expect(preferences.getSnapshot().microphoneDeviceId).toBe('removed-mic')
    expect(b.notify).toHaveBeenCalledWith('info', expect.any(String))
    await fiber.dispose()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it.each(['model-list', 'no-model', 'transcribe'] as const)('preserves the original draft on %s failure and releases the microphone', async (failure) => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Do not lose this draft')
    b.setDraft.mockClear()
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const refusal = { ok: false as const, error: new RemoteError('gateway/internal', 'Host unavailable', {}) }
    if (failure === 'model-list') b.voice.modelsList.mockResolvedValue(refusal)
    else b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: failure === 'no-model'
      ? []
      : [modelRow('first', { state: 'ready', cacheDir: '/cache/first' })] } })
    b.voice.transcribe.mockResolvedValue(refusal)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    if (failure === 'transcribe') {
      await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
      await waitForCaptureStart(audio)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    }
    await vi.waitFor(() => { expect(b.notify).toHaveBeenCalledWith('error', expect.any(String)) })
    expect(b.readDraft()).toBe('Do not lose this draft')
    expect(b.setDraft).not.toHaveBeenCalled()
    if (failure === 'transcribe') expect(track.stop).toHaveBeenCalledOnce()
    else expect(getUserMedia).not.toHaveBeenCalled()
    await fiber.dispose()
  })

  it('releases a held recording when a modifier is released after switching sessions', async () => {
    const preferences = createVoiceSettingsStore()
    preferences.set({ ...preferences.getSnapshot(), dictationMode: 'hold' })
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    b.voice.modelsList.mockResolvedValue({ ok: true, value: { models: [modelRow('first', { state: 'ready', cacheDir: '/cache/first' })] } })
    b.voice.transcribe.mockResolvedValue({ ok: true, value: { text: 'held recording' } })
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await waitForCaptureStart(audio)
    b.setCurrent('s2')
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', shiftKey: true }))
    await vi.waitFor(() => { expect(b.setDraft).toHaveBeenCalledWith('held recording') })
    expect(b.sessions.scope).toHaveBeenLastCalledWith('s1')
    expect(track.stop).toHaveBeenCalledOnce()
    await fiber.dispose()
  })
  it('cancels a toggle while AudioWorklet initialization is pending', async () => {
    const b = await bench()
    declare(b.slots)
    const track = microphoneTrack()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const audio = stubAudioContext()
    const moduleLoad = Promise.withResolvers<undefined>()
    audio.addModule.mockReturnValue(moduleLoad.promise)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(audio.addModule).toHaveBeenCalledOnce() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(audio.close).toHaveBeenCalledOnce()
      expect(track.stop).toHaveBeenCalledOnce()
    })
    expect(b.readDraft()).toBe('')
    moduleLoad.resolve(undefined)
    await fiber.dispose()
  })
  it('closes active capture on plugin disposal without transcribing or modifying the draft', async () => {
    const b = await bench()
    declare(b.slots)
    b.setDraft('Keep draft')
    b.setDraft.mockClear()
    const track = microphoneTrack()
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
    expect(b.voice.modelsList).toHaveBeenCalledOnce()
    expect(b.voice.transcribe).not.toHaveBeenCalled()
    expect(b.readDraft()).toBe('Keep draft')
    expect(b.setDraft).not.toHaveBeenCalled()
  })
})
