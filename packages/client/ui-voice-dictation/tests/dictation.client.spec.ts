// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { decodeAndResample, encodePcmBase64, startRecording } from '../src/client/dictation.ts'

/** A minimal MediaRecorder fake driving one dataavailable + stop cycle synchronously on demand. */
class FakeMediaRecorder extends EventTarget {
  mimeType = 'audio/webm'
  static instances: FakeMediaRecorder[] = []
  constructor(readonly stream: MediaStream) {
    super()
    FakeMediaRecorder.instances.push(this)
  }
  start(): void {}
  stop(): void {
    this.dispatchEvent(new Event('dataavailable'))
    this.dispatchEvent(new Event('stop'))
  }
}

function fakeStream(): MediaStream {
  const track = { stop: vi.fn() }
  return { getTracks: () => [track] } as unknown as MediaStream
}

describe('startRecording', () => {
  it('accumulates dataavailable chunks and resolves the recorded blob on stop', async () => {
    const OriginalMediaRecorder = globalThis.MediaRecorder
    // dataavailable needs a real event with .data; wire a custom dispatch below instead of the fake's plain Event.
    class RecorderWithData extends FakeMediaRecorder {
      override stop(): void {
        this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob(['abc']) }))
        this.dispatchEvent(new Event('stop'))
      }
    }
    vi.stubGlobal('MediaRecorder', RecorderWithData)
    try {
      const recording = startRecording(fakeStream())
      const blob = await recording.stop()
      expect(await blob.text()).toBe('abc')
    } finally {
      vi.stubGlobal('MediaRecorder', OriginalMediaRecorder)
    }
  })
})

describe('decodeAndResample', () => {
  it('downmixes stereo to mono and passes samples through unchanged at the target rate', async () => {
    const decoded = {
      numberOfChannels: 2,
      sampleRate: 16_000,
      length: 4,
      getChannelData: (channel: number) => channel === 0
        ? new Float32Array([1, 1, 1, 1])
        : new Float32Array([0, 0, 0, 0]),
    }
    class FakeAudioContext {
      decodeAudioData(): Promise<typeof decoded> { return Promise.resolve(decoded) }
      close(): Promise<void> { return Promise.resolve() }
    }
    const blob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as Blob
    const samples = await decodeAndResample(blob, FakeAudioContext as unknown as typeof AudioContext)
    expect(Array.from(samples)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('resamples to the 16kHz target rate when the source rate differs', async () => {
    const decoded = {
      numberOfChannels: 1,
      sampleRate: 32_000,
      length: 4,
      getChannelData: () => new Float32Array([0, 1, 0, 1]),
    }
    class FakeAudioContext {
      decodeAudioData(): Promise<typeof decoded> { return Promise.resolve(decoded) }
      close(): Promise<void> { return Promise.resolve() }
    }
    const blob = { arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as Blob
    const samples = await decodeAndResample(blob, FakeAudioContext as unknown as typeof AudioContext)
    expect(samples.length).toBe(2)
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
