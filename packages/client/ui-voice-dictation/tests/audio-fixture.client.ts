/** External Web Audio replacements; production capture, resampling and cleanup stay real. */
import { vi } from 'vitest'

/** @returns Observable context, processor and module-loading controls for one capture. */
export function stubAudioCapture() {
  const disconnect = vi.fn()
  const close = vi.fn(async () => {})
  const resume = vi.fn(async () => {})
  const addModule = vi.fn(async (_url: string) => {})
  const source = { connect: vi.fn(), disconnect }
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect }
  const processor = {
    port: { onmessage: null as ((event: { data: Float32Array }) => void) | null, close: vi.fn() },
    onprocessorerror: null as (() => void) | null,
    connect: vi.fn(() => { processor.port.onmessage?.({ data: new Float32Array([0, 0]) }) }),
    disconnect,
  }
  class FakeAudioContext {
    sampleRate = 48_000
    destination = {}
    audioWorklet = { addModule }
    createMediaStreamSource() { return source }
    createGain() { return gain }
    resume = resume
    close = close
  }
  const constructNode = vi.fn(function () { return processor })
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:clh-dictation-fixture')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('AudioWorkletNode', constructNode)
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createObjectURL
    static override revokeObjectURL = revokeObjectURL
  })
  return { close, resume, addModule, source, gain, processor, disconnect, constructNode, createObjectURL, revokeObjectURL,
    capture: (samples: Float32Array) => processor.port.onmessage?.({ data: samples }),
  }
}
