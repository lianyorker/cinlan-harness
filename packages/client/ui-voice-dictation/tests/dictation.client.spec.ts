// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodePcmBase64, startRecording } from '../src/client/dictation.ts'
import { stubAudioCapture } from './audio-fixture.client.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const stream = { getTracks: () => [] } as never as MediaStream

describe('AudioWorklet capture', () => {
  it('resamples transferred PCM and closes the graph, port and URL exactly once', async () => {
    const audio = stubAudioCapture()
    audio.processor.connect.mockImplementation(() => {})
    const recording = await startRecording(stream)
    audio.capture(new Float32Array([0.25, 0.75, 1, -0.5, -0.25, 0]))
    const first = recording.stop()
    expect(recording.stop()).toBe(first)
    expect(Array.from(await first)).toEqual([0.25, -0.5])
    expect(audio.source.connect).toHaveBeenCalledWith(audio.processor)
    expect(audio.processor.connect).toHaveBeenCalledWith(audio.gain)
    expect(audio.gain.gain.value).toBe(0)
    expect(audio.resume).toHaveBeenCalledOnce()
    expect(audio.addModule).toHaveBeenCalledExactlyOnceWith('blob:clh-dictation-fixture')
    expect(audio.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:clh-dictation-fixture')
    expect(audio.disconnect).toHaveBeenCalledTimes(3)
    expect(audio.close).toHaveBeenCalledOnce()
    expect(audio.processor.port.onmessage).toBeNull()
    expect(audio.processor.port.close).toHaveBeenCalledOnce()
  })

  it('resamples consecutive worklet frames without retaining a whole streaming recording', async () => {
    const audio = stubAudioCapture()
    audio.processor.connect.mockImplementation(() => {})
    const streamed: Float32Array[] = []
    const recording = await startRecording(stream, AudioContext, { onPcmChunk: chunk => streamed.push(chunk) })
    audio.capture(new Float32Array([0, 1, 2, 3, 4, 5]))
    audio.capture(new Float32Array([6, 7, 8, 9, 10, 11]))
    expect(Array.from((await recording.stop()))).toEqual([])
    expect(streamed.flatMap(chunk => Array.from(chunk))).toEqual([0, 3, 6, 9])
    expect(audio.close).toHaveBeenCalledOnce()
  })

  it('closes a context when the bundled processor cannot load', async () => {
    const audio = stubAudioCapture()
    audio.addModule.mockRejectedValue(new Error('worklet blocked'))
    await expect(startRecording(stream)).rejects.toThrow('worklet blocked')
    expect(audio.close).toHaveBeenCalledOnce()
    expect(audio.revokeObjectURL).toHaveBeenCalledOnce()
    expect(audio.constructNode).not.toHaveBeenCalled()
  })

  it('cancels a pending module load without waiting for its result or creating nodes', async () => {
    const audio = stubAudioCapture()
    const moduleLoad = Promise.withResolvers<undefined>() as {
      promise: Promise<void>
      resolve: () => void
      reject: (error: unknown) => void
    }
    audio.addModule.mockReturnValue(moduleLoad.promise)
    const cancel = new AbortController()
    const starting = startRecording(stream, AudioContext, undefined, cancel.signal)
    cancel.abort(new DOMException('gesture released', 'AbortError'))
    await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
    expect(audio.close).toHaveBeenCalledOnce()
    expect(audio.revokeObjectURL).toHaveBeenCalledOnce()
    moduleLoad.resolve()
    await Promise.resolve()
    expect(audio.constructNode).not.toHaveBeenCalled()
  })

  it('does not acquire a context for an already cancelled capture', async () => {
    const audio = stubAudioCapture()
    await expect(startRecording(stream, AudioContext, undefined, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    expect(audio.addModule).not.toHaveBeenCalled()
    expect(audio.createObjectURL).not.toHaveBeenCalled()
  })

  it.each(['resume', 'close', 'processor'] as const)('rejects %s failure after releasing resources', async (failure) => {
    const audio = stubAudioCapture()
    if (failure === 'resume') audio.resume.mockRejectedValue(new Error('resume failed'))
    if (failure === 'close') audio.close.mockRejectedValue(new Error('close failed'))
    if (failure === 'resume') await expect(startRecording(stream)).rejects.toThrow('resume failed')
    else {
      const recording = await startRecording(stream)
      if (failure === 'processor') audio.processor.onprocessorerror?.()
      await expect(recording.stop()).rejects.toThrow(failure === 'processor' ? 'Voice audio capture failed' : 'close failed')
    }
    expect(audio.disconnect).toHaveBeenCalledTimes(3)
    expect(audio.processor.port.close).toHaveBeenCalledOnce()
    expect(audio.close).toHaveBeenCalledOnce()
  })
})

describe('encodePcmBase64', () => {
  it('round-trips float32 samples through canonical base64', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1])
    const bytes = Buffer.from(encodePcmBase64(samples), 'base64')
    expect(Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4))).toEqual(Array.from(samples))
  })
})
