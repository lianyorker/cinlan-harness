/* oxlint-disable sonarjs/no-identical-functions -- repeated fixtures isolate independent lifecycle operations. */
// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/apply.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const scope = new Context()
  let current = 's1'
  const sessions = {
    list: { getSnapshot: () => ({ current }) },
    scope: vi.fn(() => scope),
  }
  ctx.provide('sessions', sessions as never)
  const setDraft = vi.fn()
  ctx.provide('conversation', {
    input: { for: vi.fn(() => ({ state: { getSnapshot: () => ({ draft: '' }) }, setDraft })) },
  } as never)
  return {
    ctx,
    setDraft,
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

describe('ui-voice-dictation apply', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('declares only the services it drives', () => {
    expect(inject).toEqual(['slots', 'locale', 'sessions', 'conversation'])
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
    class FakeMediaRecorder extends EventTarget {
      mimeType = 'audio/webm'
      start(): void {}
      stop(): void {
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['abc']) }))
        this.dispatchEvent(new Event('stop'))
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/voice/api/models.list') {
        return new Response(JSON.stringify({
          ok: true,
          value: { models: [{ definition: { id: 'zh' }, status: { state: 'ready' } }] },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true, value: { text: 'hello world' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    class FakeAudioContext {
      decodeAudioData() {
        return Promise.resolve({
          numberOfChannels: 1, sampleRate: 16_000, length: 2, getChannelData: () => new Float32Array([0, 0]),
        })
      }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

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
    class FakeMediaRecorder extends EventTarget {
      mimeType = 'audio/webm'
      start(): void {}
      stop(): void {
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['abc']) }))
        this.dispatchEvent(new Event('stop'))
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
    class FakeAudioContext {
      decodeAudioData() {
        return Promise.resolve({
          numberOfChannels: 1, sampleRate: 16_000, length: 2, getChannelData: () => new Float32Array([0, 0]),
        })
      }
      close() { return Promise.resolve() }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)

    let releaseTranscribe!: () => void
    const transcribeGate = new Promise<void>((resolve) => { releaseTranscribe = resolve })
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/voice/api/models.list') {
        return new Response(JSON.stringify({
          ok: true,
          value: { models: [{ definition: { id: 'zh' }, status: { state: 'ready' } }] },
        }), { status: 200 })
      }
      await transcribeGate
      return new Response(JSON.stringify({ ok: true, value: { text: 'must not publish' } }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => { expect(getUserMedia).toHaveBeenCalledOnce() })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, shiftKey: true }))
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(call => call[0] === '/voice/api/transcribe')).toBe(true)
    })

    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    releaseTranscribe()
    await disposal

    expect(b.setDraft).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })
})
