/** Official catalog capabilities and deployment overrides shared by both protocols. */
import { describe, expect, it } from 'vitest'
import { Config, DeepSeekAdapter, resolveAdapterOptions } from '../src/index.ts'

function adapter(connection: ReturnType<typeof resolveAdapterOptions>) {
  return new DeepSeekAdapter({
    options: () => connection,
    resolveApiKey: async () => { throw new Error('catalog lookup must not resolve credentials') },
    resolveUserId: () => { throw new Error('catalog lookup must not resolve identity') },
    prepareExtensions: async () => { throw new Error('catalog lookup must not prepare a request') },
  })
}

describe.each(['chat-completions', 'messages'] as const)('%s default model capabilities', (protocol) => {
  it.each([false, true])('declares Flash vision and in-history prompts, with text-only Pro control; schema=%s', async (schema) => {
    const config = { protocol }
    const connection = resolveAdapterOptions(schema ? Config(config) : config)
    expect(connection.models).toEqual([
      {
        id: 'deepseek-flash', name: 'DeepSeek-V41-Flash', contextWindow: 1_000_000,
        inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history',
        imagePixelBudget: 640_000, imageMaxBytes: 1_048_576,
      },
      {
        id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', contextWindow: 1_000_000,
        description: 'Stronger agentic coding, knowledge, and difficult reasoning; suited to complex or quality-critical tasks at higher cost.',
        inputModalities: ['text'],
      },
    ])
    const llm = adapter(connection)
    const flash = await llm.prepareCall('deepseek-official', 'deepseek-flash')
    expect(flash.model).toMatchObject({ inputModalities: ['text', 'image'], systemPromptUpdate: 'in-history' })
    const pro = await llm.prepareCall('deepseek-official', 'deepseek-v4-pro')
    expect(pro.model.inputModalities).toEqual(['text'])
    expect(pro.model).not.toHaveProperty('systemPromptUpdate')
  })

  it('replaces default capabilities with the explicit catalog even for the Flash id', async () => {
    const config = Config({ protocol, models: [{ id: 'deepseek-flash', name: 'Text gateway', contextWindow: 8192 }] })
    const llm = adapter(resolveAdapterOptions(config))
    expect(await llm.listModels('deepseek-official')).toEqual([{
      provider: 'deepseek-official', id: 'deepseek-flash', name: 'Text gateway', inputModalities: ['text'],
    }])
    const call = await llm.prepareCall('deepseek-official', 'deepseek-flash')
    expect(call.model).toMatchObject({ inputModalities: ['text'], context: { contextWindow: 8192 } })
    expect(call.model).not.toHaveProperty('systemPromptUpdate')
  })

  it('keeps an explicitly empty catalog empty and unlisted models text-only', async () => {
    const llm = adapter(resolveAdapterOptions({ protocol, models: [] }))
    expect(await llm.listModels('deepseek-official')).toEqual([])
    const call = await llm.prepareCall('deepseek-official', 'deepseek-flash')
    expect(call.model.inputModalities).toEqual(['text'])
    expect(call.model).not.toHaveProperty('systemPromptUpdate')
  })
})
