/** Real attachments, filesystem recovery, Node PTC, and DeepSeek image request bytes without a desktop or API key. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachments from '@deepseek-ai/dsh-attachment-local'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import * as ToolFs from '@deepseek-ai/dsh-tool-fs'
import {
  createAssistantMessage, createToolResultMessage, createUserMessage, LlmAdapter, LlmRuntime,
  resolveImageAttachmentAccess, ToolCallId,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, ImageBlock, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import { deepSeekImageRequestPricing, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import { prepareImages } from '@deepseek-ai/dsh-llm-deepseek/src/protocols/messages/images.ts'
import { serialize } from '@deepseek-ai/dsh-llm-deepseek/src/protocols/messages/serialize.ts'
import { serializeRequestWithImages } from '@deepseek-ai/dsh-llm-deepseek/src/serialize.ts'
import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client'
import NodeRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import LocalSpillStore from '@deepseek-ai/dsh-spill-local'
import Subprocess from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { estimateContent } from '@deepseek-ai/dsh-token-meter/estimate'
import ToolRuntime, { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import sharp from 'sharp'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as SpillPolicy from '../src/index.ts'

const CAP = 12500
const MODEL = 'vision-fixture'
const LONG = `${'X'.repeat(100)}\n`.repeat(600)
const SMALL = 'S'.repeat(36000)
const connection = resolveAdapterOptions({ models: [{ id: MODEL, inputModalities: ['text', 'image'] }] })
const chatConnection = resolveAdapterOptions({ protocol: 'chat-completions', models: [{ id: MODEL, inputModalities: ['text', 'image'] }] })
const text = (value: string): ContentBlock => ({ type: 'text', text: value })
const textOf = (content: readonly ContentBlock[]): string => content.filter(block => block.type === 'text').map(block => block.text).join('')
const imagesOf = (content: readonly ContentBlock[]): ImageBlock[] => content.filter((block): block is ImageBlock => block.type === 'image')

async function setup(maxInlineTokens = CAP) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-image-recovery-'))
  const ctx = new Context()
  onTestFinished(async () => {
    try { await ctx.fiber.dispose() } finally { await rm(root, { recursive: true, force: true }) }
  })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'both' })
  await ctx.plugin(FileSystem, { cwd: root })
  await ctx.plugin(LocalAttachments, { dshHome: join(root, 'home') })
  await ctx.plugin(ToolFs)
  await ctx.plugin(LocalSpillStore, { root: join(root, 'spill'), cleanupPeriodDays: 0 })
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  const access = (ref: ImageAttachmentRef) => resolveImageAttachmentAccess(
    ctx.attachments, path => ctx.fs.processPathFromHostPath(path), ref,
  )
  const pricing = deepSeekImageRequestPricing(connection, MODEL, access)
  class VisionRoute extends LlmAdapter {
    override async resolveModel(provider: string, model: string) {
      return { provider, id: model, name: model, inputModalities: ['text', 'image'] as Array<'text' | 'image'> }
    }
    override imageRequestPricing() { return pricing }
    stream(_options: GenerateOptions): AsyncIterable<StreamChunk> { throw new Error('keyless fixture does not infer') }
  }
  ctx.llm.registerAdapter(['vision'], new VisionRoute())
  await ctx.plugin(SpillPolicy, { maxInlineTokens })
  const session = ctx.sessions.create(SessionId('recovery'), { meta: { cwd: root } })
  const agent = { session, options: { provider: 'vision', model: MODEL }, ctx } as Agent
  let ordinal = 0
  const execute = (name: string, args: JsonValue = {}, signal: AbortSignal = new AbortController().signal) => ctx.tools.execute({
    name, arguments: args, callId: ToolCallId(`recovery-${++ordinal}`), agent, signal,
  })
  const red = await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#ff0000' } }).png().toBuffer()
  const blue = await sharp({ create: { width: 1080, height: 1920, channels: 3, background: '#0000ff' } }).png().toBuffer()
  const green = await sharp({ create: { width: 2048, height: 2048, channels: 3, background: '#00ff00' } }).png().toBuffer()
  const image = (data: Buffer): JsonValue => ({ type: 'image', mimeType: 'image/png', data: data.toString('base64') })
  const originals: Record<string, JsonValue[]> = {
    ends: [{ type: 'text', text: 'A' }, image(red), { type: 'text', text: LONG }, image(blue), { type: 'text', text: 'C' }],
    middle: [{ type: 'text', text: LONG }, image(green), { type: 'text', text: LONG }],
    small: [{ type: 'text', text: SMALL }],
  }
  const gates = new Map<string, () => Promise<void>>()
  for (const [name, content] of Object.entries(originals)) {
    ctx.tools.register({
      ...createMcpToolDefinition(ctx, {
        name, rawName: name, description: 'Return a fixed text and image sequence.', inputSchema: { type: 'object' },
        call: async () => { await gates.get(name)?.(); return { content } },
      }),
      isConcurrencySafe: () => true,
    })
  }
  const cost = (content: ContentBlock[]) => estimateContent(content.filter(block => block.type === 'text'))
    + pricing.priceImages(imagesOf(content)).reduce((sum, price) => sum + price.visualTokens + estimateContent([text(price.text)]), 0)
  const requestImages = async (
    content: ContentBlock[], contexts: UserMessage[] = [], protocol: 'messages' | 'chat-completions' = 'messages',
  ) => {
    const callId = ToolCallId('visible-result')
    const history = [
      createUserMessage({ source: { kind: 'user' }, content: [text('Inspect the supplied images.')] }),
      createAssistantMessage({ source: { provider: 'vision', model: MODEL }, content: [
        { type: 'tool-call', id: callId, name: 'inspect', arguments: '{}' },
      ] }),
      createToolResultMessage({ callId, content, isError: false }),
      ...contexts,
    ]
    const selectedConnection = protocol === 'messages' ? connection : chatConnection
    const prepared = await prepareImages(history, selectedConnection, MODEL, ctx.attachments, access, new AbortController().signal)
    const dataForImages = protocol === 'messages'
      ? serialize({ provider: 'vision', model: MODEL, messages: history }, selectedConnection, prepared.messages, prepared.versions, access).messages
        .flatMap(message => message.content.flatMap(block => block.type === 'tool_result' ? block.content : [block]))
        .filter(block => block.type === 'image')
        .map(block => block.source.type === 'base64' ? block.source.data : undefined)
      : (await serializeRequestWithImages({ provider: 'vision', model: MODEL, messages: history }, {
        representation: { kind: 'base64' }, requestImages: prepared.versions, resolveImageAccess: access,
        maxRequestImageBytes: selectedConnection.maxInlineRequestImageBytes,
        maxImagesPerRequest: selectedConnection.maxImagesPerRequest,
        byteQuantum: selectedConnection.inlineImageOffloadByteQuantum,
        countQuantum: selectedConnection.imageOffloadCountQuantum,
      })).messages
        .flatMap(message => typeof message.content === 'string' || message.content === null ? [] : message.content)
        .filter(block => block.type === 'image_url')
        .map(block => block.image_url.url.split(',', 2)[1])
    return Promise.all(dataForImages.map(async (data) => {
      if (data === undefined) throw new Error('expected prepared inline image bytes')
      const { dominant } = await sharp(Buffer.from(data, 'base64')).stats()
      return dominant.r > 200 ? 'red' : dominant.g > 200 ? 'green' : dominant.b > 200 ? 'blue' : 'unexpected'
    }))
  }
  const imagePrefixes = { red: red.toString('base64').slice(0, 24), blue: blue.toString('base64').slice(0, 24), green: green.toString('base64').slice(0, 24) }
  return { ctx, root, session, execute, originals, green, imagePrefixes, cost, requestImages, gates }
}

describe('multimodal retention and provider serializer fixtures', () => {
  it('keeps a large single-image read inside a fresh 12500-token budget', async () => {
    const { ctx, root, green, execute, cost, requestImages } = await setup()
    const saves = vi.spyOn(ctx.spillStore, 'saveText')
    const path = join(root, 'large.png')
    await writeFile(path, green)
    const result = await execute('read_image', { file_path: path })
    expect(result.isError).toBe(false)
    expect(imagesOf(result.content)).toHaveLength(1)
    expect(cost(result.content)).toBeLessThanOrEqual(CAP)
    expect(saves).not.toHaveBeenCalled()
    expect(await requestImages(result.content)).toEqual(['green'])
    expect(await requestImages(result.content, [], 'chat-completions')).toEqual(['green'])
  })

  it('retains two distinct end images in both the tool result and DeepSeek request', async () => {
    const { execute, originals, cost, requestImages } = await setup()
    const result = await execute('ends')
    expect(result.isError).toBe(false)
    expect(result.value).toEqual({ content: originals.ends })
    expect(result.content.map(block => block.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(textOf(result.content)).toContain('Omitted')
    expect(cost(result.content)).toBeLessThanOrEqual(CAP)
    expect(await requestImages(result.content)).toEqual(['red', 'blue'])
    expect(await requestImages(result.content, [], 'chat-completions')).toEqual(['red', 'blue'])
  })

  it('recovers an omitted middle image through read and read_image into the next request', async () => {
    const { ctx, execute, cost, requestImages } = await setup()
    const saves = vi.spyOn(ctx.spillStore, 'saveText')
    const omitted = await execute('middle')
    expect(omitted.isError).toBe(false)
    expect(textOf(omitted.content)).toContain('Omitted 1 images.')
    expect(await requestImages(omitted.content)).toEqual([])
    const locator = /Full formatted result stored at: (.+?)\. Use read/.exec(textOf(omitted.content))?.[1]
    if (locator === undefined) throw new Error('missing complete result locator')
    const full = await readFile(locator, 'utf8')
    expect(full.startsWith(LONG)).toBe(true)
    expect(full.endsWith(LONG)).toBe(true)
    expect(full).not.toContain('base64')
    const read = await execute('read', { file_path: locator, offset: 600, limit: 8 })
    expect(read.isError).toBe(false)
    const address = /\[Image: ("[^"\n]+")/.exec(textOf(read.content))?.[1]
    if (address === undefined) throw new Error('read did not expose the omitted image address')
    const path = JSON.parse(address) as string
    const recovered = await execute('read_image', { file_path: path })
    expect(recovered.isError).toBe(false)
    const images = imagesOf(recovered.content)
    expect(images).toHaveLength(1)
    const stored = await ctx.attachments.readImage(images[0]!.attachment)
    expect(Buffer.from(stored.data)).toEqual(await readFile(path))
    expect(cost(recovered.content)).toBeLessThanOrEqual(CAP)
    expect(saves).toHaveBeenCalledTimes(1)
    expect(await requestImages(recovered.content)).toEqual(['green'])
    expect(await requestImages(recovered.content, [], 'chat-completions')).toEqual(['green'])
  })

  it.each(['native', 'nested PTC'] as const)('recovers an image above the cap through %s without re-spilling model-facing content', async (mode) => {
    const cap = 300
    const { ctx, session, execute, cost, requestImages } = await setup(cap)
    if (mode === 'nested PTC') {
      await ctx.plugin(Subprocess)
      await ctx.plugin(Sandbox, {})
      await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
      await ctx.plugin(NodeRuntime)
    }
    const saves = vi.spyOn(ctx.spillStore, 'saveText')
    const omitted = await execute('middle')
    expect(omitted.isError).toBe(false)
    expect(imagesOf(omitted.content)).toEqual([])
    expect(cost(omitted.content)).toBeLessThanOrEqual(cap)
    expect(textOf(omitted.content)).toContain('Omitted 1 images.')
    const locator = /Full formatted result stored at: (.+?)\. Use read/.exec(textOf(omitted.content))?.[1]
    if (locator === undefined) throw new Error('missing complete result locator')
    const read = await execute('read', { file_path: locator, offset: 600, limit: 8 })
    expect(read.isError).toBe(false)
    const address = /\[Image: ("[^"\n]+")/.exec(textOf(read.content))?.[1]
    if (address === undefined) throw new Error('read did not expose the omitted image address')
    const path = JSON.parse(address) as string
    expect(saves).toHaveBeenCalledTimes(1)
    const recovered = mode === 'native'
      ? await execute('read_image', { file_path: path })
      : await execute('run_code', {
        code: `return await tools.read_image({ file_path: ${JSON.stringify(path)} })`,
        description: 'Recover an image above the retention cap',
      })
    expect(recovered.isError).toBe(false)
    const visible = [...recovered.content, ...recovered.additionalContexts?.flatMap(message => message.content) ?? []]
    const images = imagesOf(visible)
    expect(images).toHaveLength(1)
    expect(cost(images)).toBeGreaterThan(cap)
    expect(Buffer.from((await ctx.attachments.readImage(images[0]!.attachment)).data)).toEqual(await readFile(path))
    expect(await requestImages(recovered.content, recovered.additionalContexts)).toEqual(['green'])
    expect(await requestImages(recovered.content, recovered.additionalContexts, 'chat-completions')).toEqual(['green'])
    if (mode === 'native') {
      expect(saves).toHaveBeenCalledTimes(1)
    } else {
      const dispatches = session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch').map(event => event.data)
      expect(dispatches).toHaveLength(1)
      expect(dispatches[0]!.name).toBe('read_image')
      expect(imagesOf(dispatches[0]!.content)).toEqual([])
      expect(cost(dispatches[0]!.content)).toBeLessThanOrEqual(cap)
      expect(textOf(dispatches[0]!.content)).toContain('Omitted 1 images.')
      expect(saves).toHaveBeenCalledTimes(2)
      expect(saves.mock.calls[1]![0].source).toMatchObject({ toolName: 'read_image', label: 'dispatch' })
    }
  })

  it('rejects a pre-aborted image call before spill storage or projection', async () => {
    const { ctx, execute } = await setup()
    const saveText = vi.spyOn(ctx.spillStore, 'saveText')
    const controller = new AbortController()
    controller.abort()
    const result = await execute('ends', {}, controller.signal)
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
      error: { info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH } },
    })
    expect(saveText).not.toHaveBeenCalled()
    expect(result.additionalContexts ?? []).toEqual([])
  })

  it('preserves a successful image result when spill storage fails', async () => {
    const { ctx, execute, originals } = await setup()
    vi.spyOn(ctx.spillStore, 'saveText').mockRejectedValue(new Error('fixture spill failure'))
    const result = await execute('ends')
    expect(result.isError).toBe(false)
    expect(result.content.map(block => block.type)).toEqual(['text', 'image', 'text', 'image', 'text'])
    expect(result.value).toEqual({ content: originals.ends })
  })

  it('settles an image execution as aborted when cancellation arrives during spill storage', async () => {
    const { ctx, execute } = await setup()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.spillStore.saveText.bind(ctx.spillStore)
    const saveText = vi.spyOn(ctx.spillStore, 'saveText')
    let completed = false
    saveText.mockImplementation(async (input) => {
      entered.resolve(undefined)
      await release.promise
      const saved = await original(input)
      completed = true
      return saved
    })
    const controller = new AbortController()
    const pending = execute('ends', {}, controller.signal)
    await entered.promise
    controller.abort()
    release.resolve(undefined)
    const result = await pending
    expect(result).toMatchObject({
      isError: true,
      content: [{ type: 'text', text: 'Error: tool call aborted' }],
      error: { info: { name: 'AbortError', code: TOOL_ABORTED } },
    })
    expect(result.additionalContexts ?? []).toEqual([])
    expect(result.content.some(block => block.type === 'text' && block.text.includes('Full formatted result stored at:'))).toBe(false)
    expect(saveText).toHaveBeenCalledTimes(1)
    expect(completed).toBe(true)
  })

  it('keeps a complete canonical image value when nested image spill fails', async () => {
    const { ctx, execute, imagePrefixes, session } = await setup()
    await ctx.plugin(Subprocess)
    await ctx.plugin(Sandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
    await ctx.plugin(NodeRuntime)
    vi.spyOn(ctx.spillStore, 'saveText').mockRejectedValue(new Error('nested fixture spill failure'))
    const result = await execute('run_code', {
      code: `const value = await tools.ends({}); return {
        types: value.content.map(block => block.type),
        images: value.content.filter(block => block.type === 'image').map(block => block.data.slice(0, 24)),
      };`,
      description: 'Keep nested image value after spill failure',
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ result: {
      types: ['text', 'image', 'text', 'image', 'text'],
      images: [imagePrefixes.red, imagePrefixes.blue],
    } })
    const dispatch = session.snapshotEvents().find(event => event.type === 'tool/ptc-dispatch')
    expect(dispatch?.data.content.filter(block => block.type === 'image')).toHaveLength(2)
  })

  it('aborts a nested image PTC call while retention storage is gated', async () => {
    const { ctx, execute } = await setup()
    await ctx.plugin(Subprocess)
    await ctx.plugin(Sandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
    await ctx.plugin(NodeRuntime)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = ctx.spillStore.saveText.bind(ctx.spillStore)
    const saveText = vi.spyOn(ctx.spillStore, 'saveText')
    let completed = false
    saveText.mockImplementation(async (input) => {
      entered.resolve(undefined)
      await release.promise
      const saved = await original(input)
      completed = true
      return saved
    })
    const controller = new AbortController()
    const pending = execute('run_code', {
      code: 'return await tools.ends({})',
      description: 'Abort nested image retention',
    }, controller.signal)
    await entered.promise
    controller.abort()
    release.resolve(undefined)
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
    expect(textOf(result.content)).toContain('Error: code run failed (abort): This operation was aborted')
    expect(result.error?.info).toMatchObject({ name: 'CodeRunFailedError', code: 'CODE_RUN_FAILED' })
    expect(result.additionalContexts ?? []).toEqual([])
    expect(saveText).toHaveBeenCalled()
    expect(completed).toBe(true)
  })

  it.each(['sequential', 'parallel'] as const)('keeps budgets and image identities separate across %s Node PTC calls', async (mode) => {
    const { ctx, session, execute, cost, requestImages, gates, imagePrefixes } = await setup()
    await ctx.plugin(Subprocess)
    await ctx.plugin(Sandbox, {})
    await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
    await ctx.plugin(NodeRuntime)
    if (mode === 'parallel') {
      const overlap = Promise.withResolvers<undefined>()
      onTestFinished(() => { overlap.resolve(undefined) })
      let entered = 0
      const gate = () => { if (++entered === 2) overlap.resolve(undefined); return overlap.promise }
      gates.set('ends', gate)
      gates.set('middle', gate)
    }
    const calls = mode === 'parallel'
      ? 'await Promise.all([tools.ends({}), tools.middle({}), tools.small({})])'
      : '[await tools.ends({}), await tools.middle({}), await tools.small({})]'
    const result = await execute('run_code', {
      code: `const [ends, middle, small] = ${calls}; return {
        ends: { types: ends.content.map(block => block.type), images: ends.content.filter(block => block.type === 'image').map(block => block.data.slice(0, 24)) },
        middle: { types: middle.content.map(block => block.type), images: middle.content.filter(block => block.type === 'image').map(block => block.data.slice(0, 24)) },
        small: small.content.map(block => block.type),
      };`,
      description: 'Inspect independent image result budgets',
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ result: {
      ends: { types: ['text', 'image', 'text', 'image', 'text'], images: [imagePrefixes.red, imagePrefixes.blue] },
      middle: { types: ['text', 'image', 'text'], images: [imagePrefixes.green] },
      small: ['text'],
    } })
    const dispatches = session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch').map(event => event.data)
    expect(dispatches).toHaveLength(3)
    for (const dispatch of dispatches) expect(cost(dispatch.content)).toBeLessThanOrEqual(CAP)
    expect(dispatches.find(event => event.name === 'ends')?.content.filter(block => block.type === 'image')).toHaveLength(2)
    expect(textOf(dispatches.find(event => event.name === 'middle')!.content)).toContain('Omitted 1 images.')
    expect(dispatches.find(event => event.name === 'small')?.content).toEqual([text(SMALL)])
    expect(result.additionalContexts).toHaveLength(2)
    expect(await requestImages(result.content, result.additionalContexts)).toEqual(['red', 'blue'])
  })
})
