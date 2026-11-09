import { describe, expect, it } from 'vitest'
import { VoiceModelId } from '@cinlan/voice'
import type { VoiceModelDefinition } from '@cinlan/voice'
import { OnlineRecognitionProcess } from '../src/streaming-process.ts'

const definition: VoiceModelDefinition = {
  id: VoiceModelId('worker-fixture'),
  name: 'Worker fixture',
  description: 'Invalid files exercise the isolated worker failure path.',
  recommended: false,
  kind: 'streaming',
  approximateBytes: 0,
  download: { type: 'archive', url: 'https://example.invalid/model.tar.bz2', sha256: '0'.repeat(64) },
  architecture: { type: 'transducer', encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' },
}

describe('OnlineRecognitionProcess', () => {
  it('reports worker initialization failure and joins the child process', async () => {
    const worker = new OnlineRecognitionProcess(definition, 'missing-model-files', new AbortController().signal)
    await expect(worker.start()).rejects.toBeInstanceOf(Error)
    await expect(worker.dispose()).resolves.toBeUndefined()
  })
})
