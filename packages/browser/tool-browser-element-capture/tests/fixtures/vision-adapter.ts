import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'

class VisionAdapter extends LlmAdapter {
  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    signal?.throwIfAborted()
    return Promise.resolve({
      provider,
      id: model,
      name: 'Fixture vision model',
      inputModalities: ['text', 'image'],
    })
  }

  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    throw new Error('fixture adapter stream is not exercised')
  }
}

/** Loader plugin that supplies the image-capable route used by the fixture. */
const FixtureVisionAdapter = {
  name: 'fixture-vision-adapter',
  inject: ['llm'],
  apply(ctx: Context): void {
    ctx.llm.registerAdapter(['fixture'], new VisionAdapter())
  },
}

export default FixtureVisionAdapter
