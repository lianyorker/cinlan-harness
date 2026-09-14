// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { encodePcmBase64, startRecording } from '../src/client/dictation.ts'

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}

describe('startRecording', () => {
  it('captures PCM samples via ScriptProcessorNode and resolves resampled float32 on stop', async () => {
    const samples1 = new Float32Array([0.1, 0.2, 0.3, 0.4])
    const samples2 = new Float32Array([0.5, 0.6])
    const fakeBuffer = { getChannelData: () => samples1 }
    const fakeEvent = { inputBuffer: fakeBuffer } as unknown as AudioProcessingEvent
    const fakeProcessor = {
      onaudioprocess: null as ((event: AudioProcessingEvent) => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    }
    const fakeSource = { connect: vi.fn(), disconnect: vi.fn() }
    const fakeGain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
    const fakeDestination = {}
    const nativeRate = 48000
    class FakeAudioContext {
      sampleRate = nativeRate
      createMediaStreamSource() { return fakeSource }
      createScriptProcessor() { return fakeProcessor }
      createGain() { return fakeGain }
      get destination() { return fakeDestination }
      close() { return Promise.resolve() }
    }
    const recording = startRecording(fakeStream(), FakeAudioContext as unknown as typeof AudioContext)
    // Simulate two onaudioprocess callbacks
    fakeProcessor.onaudioprocess!(fakeEvent)
    fakeBuffer.getChannelData = () => samples2
    fakeProcessor.onaudioprocess!(fakeEvent)
    const result = await recording.stop()
    // 6 samples at 48kHz → 2 samples at 16kHz
    expect(result.length).toBe(2)
    expect(fakeSource.connect).toHaveBeenCalledWith(fakeProcessor)
    expect(fakeProcessor.connect).toHaveBeenCalledWith(fakeGain)
    expect(fakeGain.connect).toHaveBeenCalledWith(fakeDestination)
  })
})

describe('encodePcmBase64', () => {
  it('round-trips float32 samples through canonical base64', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const encoded = encodePcmBase64(samples)
    const decodedBytes = Buffer.from(encoded, 'base64')
    const decoded = new Float32Array(decodedBytes.buffer, decodedBytes.byteOffset, decodedBytes.byteLength / 4)
    expect(Array.from(decoded)).toEqual(Array.from(samples))
  })
})
