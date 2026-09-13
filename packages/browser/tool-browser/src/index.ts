/**
 * Model-facing persistent-browser tools over `ctx.browser`. This Consumer owns
 * HTTP(S) argument validation, tool schemas, timeout metadata, attachment
 * persistence, model content, and generic render intent. It does not expose OS
 * Computer Use or provider-specific CLI fields.
 * @module @deepseek-ai/dsh-tool-browser
 */

import type {} from '@deepseek-ai/dsh-fs'
import type { BrowserDownloadId } from '@deepseek-ai/dsh-browser'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  BrowserElementId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type {
  BrowserHistoryEntry,
  BrowserNetworkEntry,
  BrowserObservation,
  BrowserPage,
  BrowserScreenshotFormat,
} from '@deepseek-ai/dsh-browser'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Cordis plugin name. */
export const name = 'tool-browser'

/** Required Services; `llm` is resolved only when `browser_screenshot` executes. */
export const inject = ['attachments', 'browser', 'systemPrompt', 'tools']

/** Stable model guidance for persistent Browser versus OS Computer Use. */
export const BROWSER_SYSTEM_PROMPT = 'Use browser_* tools to inspect and operate persistent web pages in the configured browser. Element ids are valid only with the observation_id returned by the latest browser_snapshot for that page; take a new snapshot after navigation or interaction. These tools do not control OS windows or desktop applications; use a Computer Use capability for those targets.'

const DEFAULT_TIMEOUT_MS = 60_000

/** Tool-suite configuration. */
export interface Config {
  /** Cooperative timeout attached to every browser tool. Defaults to 60000 ms. */
  readonly timeoutMs?: number
  /** Encoding requested by `browser_screenshot`. Defaults to `png`. */
  readonly screenshotFormat?: BrowserScreenshotFormat
  /** Default visit count returned by browser_history. Defaults to 20. */
  readonly historyLimit?: number
  /** Default request count returned by browser_network. Defaults to 50. */
  readonly networkLimit?: number
  /** Maximum transfer bytes per file. Defaults to 4 MiB. */
  readonly maxFileBytes?: number
}

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly screenshotFormat: BrowserScreenshotFormat
  readonly historyLimit: number
  readonly networkLimit: number
  readonly maxFileBytes: number
}

const CONFIG_KEYS = new Set(['timeoutMs', 'screenshotFormat', 'historyLimit', 'networkLimit', 'maxFileBytes'])

/** Loader schema for browser tool configuration. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  screenshotFormat: z.union(['png', 'jpeg'] as const).default('png'),
  historyLimit: z.number().step(1).min(1).max(100).default(20),
  networkLimit: z.number().step(1).min(1).max(100).default(50),
  maxFileBytes: z.number().step(1).min(1).max(100 * 1024 * 1024).default(4 * 1024 * 1024),
})

/**
 * Validate and default browser tool config.
 * @param config - Loader or direct-plugin config.
 * @returns Complete tool config.
 */
export function resolveBrowserToolConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`tool-browser: unsupported config key '${key}'`)
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-browser: timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const screenshotFormat = config.screenshotFormat ?? 'png'
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- direct JavaScript and parsed config cross a runtime boundary.
  if (screenshotFormat !== 'png' && screenshotFormat !== 'jpeg') {
    throw new Error('tool-browser: screenshotFormat must be "png" or "jpeg"')
  }
  const maxFileBytes = config.maxFileBytes ?? 4 * 1024 * 1024
  if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > 100 * 1024 * 1024) throw new Error('Browser maxFileBytes must be between 1 and 104857600')
  return {
    timeoutMs, screenshotFormat, historyLimit: entryLimit(config.historyLimit ?? 20),
    networkLimit: entryLimit(config.networkLimit ?? 50), maxFileBytes,
  }
}

function entryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) throw new Error('browser entry limit must be between 1 and 100')
  return value
}

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function httpUrl(name: string, value: string): string {
  nonEmpty(name, value)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL`)
  }
  return value
}

function pageValue(page: BrowserPage): {
  page_id: string
  index: number
  url: string
  title: string
  active: boolean
} {
  return {
    page_id: page.pageId,
    index: page.index,
    url: page.url,
    title: page.title,
    active: page.active,
  }
}

function formatPages(pages: readonly ReturnType<typeof pageValue>[]): string {
  if (pages.length === 0) return 'No persistent browser pages are open.'
  return pages.map(page => [
    page.active ? '*' : '-',
    page.page_id,
    page.title.length === 0 ? '(untitled)' : page.title,
    page.url,
  ].join(' ')).join('\n')
}

function formatObservation(observation: {
  observation_id: string
  page_id: string
  url: string
  title: string
  tree: string
}): string {
  return [
    `Observation: ${observation.observation_id}`,
    `Page: ${observation.page_id}`,
    `Title: ${observation.title}`,
    `URL: ${observation.url}`,
    observation.tree.length === 0 ? '(empty accessibility tree)' : observation.tree,
  ].join('\n')
}

interface ScreenshotValue {
  page_id: string
  image: {
    attachmentId: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function imageRef(value: ScreenshotValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(value.attachmentId),
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...value.name === undefined ? {} : { name: value.name },
  }
}

function screenshotContent(value: ScreenshotValue): ContentBlock[] {
  return [
    {
      type: 'text',
      text: `Viewport screenshot for page ${value.page_id}: ${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes.`,
    },
    { type: 'image', attachment: imageRef(value.image) },
  ]
}

async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('browser_screenshot requires a resolvable image-capable model route')
  }
  const active = await llm.resolveModelInfo(provider, model, exec.signal)
  if (active.inputModalities === undefined || !active.inputModalities.includes('image')) {
    throw new Error(`browser_screenshot requires an image-capable model; '${model}' does not declare image input`)
  }
}

function observationValue(observation: BrowserObservation): {
  observation_id: string
  page_id: string
  url: string
  title: string
  tree: string
  elements: { element_id: string; role: string; name: string }[]
} {
  return {
    observation_id: observation.observationId,
    page_id: observation.pageId,
    url: observation.url,
    title: observation.title,
    tree: observation.tree,
    elements: observation.elements.map(element => ({
      element_id: element.elementId,
      role: element.role,
      name: element.name,
    })),
  }
}

function historyValue(entries: readonly BrowserHistoryEntry[]): { entries: BrowserHistoryEntry[] } {
  return { entries: entries.map(entry => ({ url: entry.url, title: entry.title, at: entry.at })) }
}

function networkValue(entries: readonly BrowserNetworkEntry[]): { entries: BrowserNetworkEntry[] } {
  return { entries: entries.map(entry => ({ ...entry })) }
}

const pageIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'Persistent page id returned by browser_list or browser_open.',
} as const

/**
 * Register the persistent-browser tools and their system guidance.
 * @param ctx - Context carrying browser, attachment, prompt, and tool services.
 * @param config - Timeout and screenshot encoding.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveBrowserToolConfig(config)
  ctx.systemPrompt.section({ name: 'tool:browser', order: 112, text: BROWSER_SYSTEM_PROMPT })

  ctx.tools.register(defineTool({
    name: 'browser_list',
    description: 'List persistent browser pages and their stable page ids.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pages: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page_id: { type: 'string', required: true },
                index: { type: 'integer', required: true },
                url: { type: 'string', required: true },
                title: { type: 'string', required: true },
                active: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatPages(value.pages) }],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const pages = await ctx.browser.listPages(exec.signal)
      return { pages: pages.map(pageValue) }
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'List browser pages', kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_open',
    description: 'Open an HTTP or HTTPS URL in a new persistent browser page.',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute HTTP or HTTPS URL to open.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { page_id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Opened persistent browser page ${value.page_id}. Run browser_snapshot before interacting.`,
      }],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const result = await ctx.browser.openPage({ url: httpUrl('url', args.url) }, exec.signal)
      return { page_id: result.pageId }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Open ${args.url}`, kind: 'fetch', rawInput: args.url }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_navigate',
    description: 'Navigate one persistent browser page to an HTTP or HTTPS URL.',
    parameters: {
      page_id: pageIdParameter,
      url: { type: 'string', required: true, description: 'Absolute HTTP or HTTPS destination URL.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page_id: { type: 'string', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Navigated page ${value.page_id}\nTitle: ${value.title}\nURL: ${value.url}\nRun browser_snapshot before interacting.`,
      }],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const result = await ctx.browser.navigate({
        pageId: BrowserPageId(nonEmpty('page_id', args.page_id)),
        url: httpUrl('url', args.url),
      }, exec.signal)
      return { page_id: result.pageId, url: result.url, title: result.title }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Navigate ${args.page_id}`, kind: 'fetch', rawInput: args.url }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_snapshot',
    description: 'Read a persistent browser page accessibility tree and fresh element ids.',
    parameters: { page_id: pageIdParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          observation_id: { type: 'string', required: true },
          page_id: { type: 'string', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          tree: { type: 'string', required: true },
          elements: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                element_id: { type: 'string', required: true },
                role: { type: 'string', required: true },
                name: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatObservation(value) }],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const observation = await ctx.browser.snapshot({
        pageId: BrowserPageId(nonEmpty('page_id', args.page_id)),
      }, exec.signal)
      return observationValue(observation)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Snapshot ${args.page_id}`, kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_click',
    description: 'Click an element from the latest browser_snapshot observation.',
    parameters: {
      page_id: pageIdParameter,
      observation_id: {
        type: 'string',
        required: true,
        description: 'Observation id returned by the latest browser_snapshot for this page.',
      },
      element_id: {
        type: 'string',
        required: true,
        description: 'Element id from that exact browser_snapshot observation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page_id: { type: 'string', required: true },
          observation_id: { type: 'string', required: true },
          element_id: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Clicked ${value.element_id} on page ${value.page_id}. Run browser_snapshot before another element action.`,
      }],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const result = await ctx.browser.click({
        pageId: BrowserPageId(nonEmpty('page_id', args.page_id)),
        observationId: BrowserObservationId(nonEmpty('observation_id', args.observation_id)),
        elementId: BrowserElementId(nonEmpty('element_id', args.element_id)),
      }, exec.signal)
      return {
        page_id: result.pageId,
        observation_id: result.observationId,
        element_id: result.elementId,
      }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Click ${args.element_id}`, kind: 'execute' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_screenshot',
    description: 'Capture the current browser viewport and return it as an image.',
    parameters: { page_id: pageIdParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page_id: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', enum: ['image/png', 'image/jpeg'], required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => screenshotContent(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const pageId = BrowserPageId(nonEmpty('page_id', args.page_id))
      const mediaType = resolved.screenshotFormat === 'png' ? 'image/png' as const : 'image/jpeg' as const
      if (!ctx.attachments.imageLimits.mediaTypes.includes(mediaType)) {
        throw new Error(`browser_screenshot cannot emit ${mediaType}; this deployment does not accept it`)
      }
      await assertImageCapableRoute(ctx, exec)
      const screenshot = await ctx.browser.screenshot({
        pageId,
        format: resolved.screenshotFormat,
      }, exec.signal)
      const extension = screenshot.format === 'png' ? 'png' : 'jpg'
      const ref = await ctx.attachments.saveImage({
        data: screenshot.data,
        mediaType: screenshot.mediaType,
        name: `browser-screenshot.${extension}`,
      })
      const value: ScreenshotValue = {
        page_id: pageId,
        image: {
          attachmentId: ref.attachmentId,
          mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: screenshotContent(value),
          source: { kind: 'plugin', plugin: 'tool-browser' },
        }))
      }
      return value
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Screenshot ${args.page_id}`, kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_home',
    description: 'Open the configured Browser home page in a new persistent page.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: { page_id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `Opened Browser home page in ${value.page_id}.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(_args, exec) {
      const target = ctx.browser.resolveNavigation({ kind: 'home' })
      const result = await ctx.browser.openPage(target, exec.signal)
      return { page_id: result.pageId }
    },
    presentCall(): GenericCallView { return { card: 'generic', title: 'Open Browser home page', kind: 'fetch' } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_search',
    description: 'Search the configured Browser search engine in a new persistent page.',
    parameters: { query: { type: 'string', required: true, description: 'Search text.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { page_id: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `Opened Browser search in ${value.page_id}.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const target = ctx.browser.resolveNavigation({ kind: 'search', query: nonEmpty('query', args.query) })
      const result = await ctx.browser.openPage(target, exec.signal)
      return { page_id: result.pageId }
    },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Search Browser', kind: 'fetch', rawInput: args.query } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_history',
    description: 'Read bounded navigation history for one persistent browser page.',
    parameters: { page_id: pageIdParameter, limit: { type: 'integer', description: 'Maximum entries from 1 through 100.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { entries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, title: { type: 'string', required: true }, at: { type: 'integer', required: true } } } } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.entries, null, 2) }] },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) { return historyValue(await ctx.browser.history(BrowserPageId(nonEmpty('page_id', args.page_id)), entryLimit(args.limit ?? resolved.historyLimit), exec.signal)) },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Browser history', kind: 'read', rawInput: args.page_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_back',
    description: 'Navigate one persistent browser page one step backward.',
    parameters: { page_id: pageIdParameter },
    output: { schema: { type: 'object', additionalProperties: false, properties: { page_id: { type: 'string', required: true }, url: { type: 'string', required: true }, title: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `Navigated back to ${value.url}.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) { const value = await ctx.browser.back(BrowserPageId(nonEmpty('page_id', args.page_id)), exec.signal); return { page_id: value.pageId, url: value.url, title: value.title } },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Browser back', kind: 'execute', rawInput: args.page_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_forward',
    description: 'Navigate one persistent browser page one step forward.',
    parameters: { page_id: pageIdParameter },
    output: { schema: { type: 'object', additionalProperties: false, properties: { page_id: { type: 'string', required: true }, url: { type: 'string', required: true }, title: { type: 'string', required: true } } }, render: (_args, value) => [{ type: 'text', text: `Navigated forward to ${value.url}.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) { const value = await ctx.browser.forward(BrowserPageId(nonEmpty('page_id', args.page_id)), exec.signal); return { page_id: value.pageId, url: value.url, title: value.title } },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Browser forward', kind: 'execute', rawInput: args.page_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_network',
    description: 'Read bounded network request observations captured by one persistent browser page.',
    parameters: { page_id: pageIdParameter, limit: { type: 'integer', description: 'Maximum entries from 1 through 100.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { entries: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { url: { type: 'string', required: true }, method: { type: 'string', required: true }, resourceType: { type: 'string', required: true }, status: { type: 'integer' }, failed: { type: 'string' }, at: { type: 'integer', required: true } } } } } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value.entries, null, 2) }] },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) { return networkValue(await ctx.browser.network(BrowserPageId(nonEmpty('page_id', args.page_id)), entryLimit(args.limit ?? resolved.networkLimit), exec.signal)) },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Browser network', kind: 'read', rawInput: args.page_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_upload',
    description: 'Set a browser file input from a workspace file. Page input/change handlers may upload data. Requires a fresh browser_snapshot.',
    parameters: {
      page_id: pageIdParameter,
      observation_id: { type: 'string', required: true, description: 'Latest page observation.' },
      element_id: { type: 'string', required: true, description: 'File input element from that observation.' },
      file_path: { type: 'string', required: true, description: 'File inside the calling Session workspace.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { bytes: { type: 'integer', required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Set file input with ${value.bytes} bytes. Page input/change handlers may upload data.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const fs = ctx.get('fs'), cwd = exec.agent?.session.header.cwd
      if (fs === undefined || cwd === undefined) throw new Error('Browser upload requires a Session workspace and filesystem Provider')
      const filePath = nonEmpty('file_path', args.file_path)
      const root = await fs.resolve(cwd, { signal: exec.signal })
      const target = await fs.resolve(filePath, { cwd, signal: exec.signal })
      if (!fs.contains(root, target)) throw new Error('Browser upload file must be inside the Session workspace')
      const data = await fs.readBytes(target, exec.signal, resolved.maxFileBytes)
      const name = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
      await ctx.browser.upload({ pageId: BrowserPageId(nonEmpty('page_id', args.page_id)),
        observationId: BrowserObservationId(nonEmpty('observation_id', args.observation_id)),
        elementId: BrowserElementId(nonEmpty('element_id', args.element_id)), name, data }, exec.signal)
      return { bytes: data.byteLength }
    },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Upload workspace file to browser', kind: 'execute', rawInput: args.file_path } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_downloads',
    description: 'List captured downloads belonging to one open browser page.',
    parameters: { page_id: pageIdParameter },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      truncated: { type: 'boolean', required: true },
      items: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        download_id: { type: 'string', required: true }, name: { type: 'string', required: true },
        status: { type: 'string', required: true, enum: ['in-progress', 'complete', 'failed'] },
      } } },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const result = await ctx.browser.downloads(BrowserPageId(nonEmpty('page_id', args.page_id)), exec.signal)
      return {
        truncated: result.truncated, items: result.items.map(item => ({ download_id: item.id, name: item.name, status: item.status })),
      }
    },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'List browser downloads', kind: 'read', rawInput: args.page_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_save_download',
    description: 'Persist one completed browser download as a file attachment; returns metadata, never file contents.',
    parameters: { page_id: pageIdParameter, download_id: { type: 'string', required: true, description: 'Download id returned by browser_downloads.' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      attachmentId: { type: 'string', required: true }, name: { type: 'string', required: true }, bytes: { type: 'integer', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: `Saved download ${value.name} (${value.bytes} bytes), attachment ${value.attachmentId}.` }] },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const file = await ctx.browser.readDownload(BrowserPageId(nonEmpty('page_id', args.page_id)), nonEmpty('download_id', args.download_id) as BrowserDownloadId, resolved.maxFileBytes, exec.signal)
      exec.signal.throwIfAborted()
      const ref = await ctx.attachments.saveFile({ name: file.name, data: file.data })
      return { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes }
    },
    presentCall(args): GenericCallView { return { card: 'generic', title: 'Save browser download', kind: 'execute', rawInput: args.download_id } },
  }))

  ctx.tools.register(defineTool({
    name: 'browser_close',
    description: 'Close one persistent browser page.',
    parameters: { page_id: pageIdParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { page_id: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: `Closed persistent browser page ${value.page_id}.` }],
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const pageId = BrowserPageId(nonEmpty('page_id', args.page_id))
      await ctx.browser.closePage({ pageId }, exec.signal)
      return { page_id: pageId }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Close ${args.page_id}`, kind: 'delete' }
    },
  }))
}
