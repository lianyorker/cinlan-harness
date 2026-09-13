/**
 * Model-facing Browser element selection and crop capture Consumer. It keeps
 * Provider handles in the Browser implementation and delegates attachment
 * persistence through a process-local Coordination executor.
 * @module @deepseek-ai/dsh-tool-browser-element-capture
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type { BrowserElementCaptureTarget, BrowserScreenshotFormat } from '@deepseek-ai/dsh-browser'
import { TaskId } from '@deepseek-ai/dsh-coordination'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Cordis plugin name. */
export const name = 'tool-browser-element-capture'

/** Required services for Browser operations, Coordination, prompt assembly, and tools. */
export const inject = ['browser', 'coordination', 'systemPrompt', 'tools']

/** Stable guidance for the two-step Browser element capture workflow. */
export const BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT = 'Use browser_select_element when a person must identify an element through a temporary hover highlight. Use browser_capture_element with either the exact observation_id and element_id from browser_snapshot or the selection_id from browser_select_element. The provider verifies element identity and visible bounds around capture; obtain a new snapshot or selection after the page changes.'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_FORMAT: BrowserScreenshotFormat = 'png'
const EXECUTOR_KIND = 'browser-element-capture'

/** Consumer configuration. */
export interface Config {
  /** Cooperative timeout for selection and capture tools. Defaults to 60000 ms. */
  readonly timeoutMs?: number
  /** Encoded image format saved by element capture. Defaults to png. */
  readonly screenshotFormat?: BrowserScreenshotFormat
}

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly screenshotFormat: BrowserScreenshotFormat
}

const CONFIG_KEYS = new Set(['timeoutMs', 'screenshotFormat'])

/** Loader schema for the Consumer configuration. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  screenshotFormat: z.union(['png', 'jpeg'] as const).default(DEFAULT_FORMAT),
})

/**
 * Validate and default the Consumer configuration.
 * @param config - Loader or direct-plugin configuration.
 * @returns Complete tool configuration.
 */
export function resolveBrowserElementCaptureConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`tool-browser-element-capture: unsupported config key '${key}'`)
    }
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-browser-element-capture: timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const screenshotFormat = config.screenshotFormat ?? DEFAULT_FORMAT
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- direct JavaScript and parsed config cross a runtime boundary.
  if (screenshotFormat !== 'png' && screenshotFormat !== 'jpeg') {
    throw new Error('tool-browser-element-capture: screenshotFormat must be "png" or "jpeg"')
  }
  return { timeoutMs, screenshotFormat }
}

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface SelectionValue {
  page_id: string
  selection_id: string
  tag_name: string
  role: string
  name: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
}

interface CaptureTargetValue {
  kind: 'observation' | 'selection'
  observation_id?: string
  element_id?: string
  selection_id?: string
}

interface CaptureValue {
  page_id: string
  target: CaptureTargetValue
  verified: true
  image: {
    attachmentId: string
    mediaType: 'image/png' | 'image/jpeg'
    bytes: number
    width: number
    height: number
    name?: string
  }
}

function imageRef(image: CaptureValue['image']): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...image.name === undefined ? {} : { name: image.name },
  }
}

function captureContent(value: Omit<CaptureValue, 'verified'>): ContentBlock[] {
  const target = value.target.kind === 'selection'
    ? `selection ${value.target.selection_id ?? ''}`
    : `element ${value.target.element_id ?? ''} from observation ${value.target.observation_id ?? ''}`
  return [
    {
      type: 'text',
      text: `Captured a verified browser element image.\nPage: ${value.page_id}\nTarget: ${target}\nImage: ${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes.`,
    },
    { type: 'image', attachment: imageRef(value.image) },
  ]
}

function selectionContent(value: SelectionValue): ContentBlock[] {
  return [{
    type: 'text',
    text: `Selected a browser element on page ${value.page_id}.\nSelection: ${value.selection_id}\nElement: ${value.role} "${value.name}"\nBounds: ${value.rect.width}x${value.rect.height} px. Use this selection_id with browser_capture_element.`,
  }]
}

function callView(title: string): GenericCallView {
  return { card: 'generic', title, kind: 'read' }
}

function captureTarget(value: {
  page_id: string
  observation_id?: string
  element_id?: string
  selection_id?: string
}, format: BrowserScreenshotFormat): {
  pageId: ReturnType<typeof BrowserPageId>
  target: BrowserElementCaptureTarget
  format: BrowserScreenshotFormat
} {
  const pageId = BrowserPageId(nonEmpty('page_id', value.page_id))
  if (value.selection_id !== undefined) {
    if (value.observation_id !== undefined || value.element_id !== undefined) {
      throw new Error('provide either selection_id or both observation_id and element_id')
    }
    return {
      pageId,
      target: {
        kind: 'selection',
        selectionId: BrowserElementSelectionId(nonEmpty('selection_id', value.selection_id)),
      },
      format,
    }
  }
  if (value.observation_id === undefined || value.element_id === undefined) {
    throw new Error('provide either selection_id or both observation_id and element_id')
  }
  return {
    pageId,
    target: {
      kind: 'observation',
      observationId: BrowserObservationId(nonEmpty('observation_id', value.observation_id)),
      elementId: BrowserElementId(nonEmpty('element_id', value.element_id)),
    },
    format,
  }
}

function taskInput(value: {
  page_id: string
  observation_id?: string
  element_id?: string
  selection_id?: string
}, format: BrowserScreenshotFormat): JsonValue {
  const request = captureTarget(value, format)
  return request.target.kind === 'selection'
    ? {
      page_id: String(request.pageId),
      kind: 'selection',
      selection_id: String(request.target.selectionId),
      format: request.format,
    }
    : {
      page_id: String(request.pageId),
      kind: 'observation',
      observation_id: String(request.target.observationId),
      element_id: String(request.target.elementId),
      format: request.format,
    }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const extras = Object.keys(value).filter(key => !allowed.includes(key))
  if (extras.length > 0) throw new Error(`${label} contains unsupported field '${extras[0]}'`)
}

function stringField(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field.length === 0 || field.trim() !== field) {
    throw new Error(`browser capture task output field ${key} is invalid`)
  }
  return field
}

function positiveIntegerField(value: Record<string, unknown>, key: string): number {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 1) {
    throw new Error(`browser capture task output field ${key} is invalid`)
  }
  return field
}

function readCaptureOutput(value: unknown): CaptureValue['image'] {
  const output = record(value, 'browser capture task output')
  exactKeys(output, ['attachmentId', 'mediaType', 'bytes', 'width', 'height', 'name'], 'browser capture task output')
  const mediaType = output.mediaType
  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') {
    throw new Error('browser capture task output field mediaType is invalid')
  }
  return {
    attachmentId: stringField(output, 'attachmentId'),
    mediaType,
    bytes: positiveIntegerField(output, 'bytes'),
    width: positiveIntegerField(output, 'width'),
    height: positiveIntegerField(output, 'height'),
    ...(output.name === undefined ? {} : { name: stringField(output, 'name') }),
  }
}

async function awaitRun(
  handle: { result: Promise<unknown>; cancel(reason?: string): void },
  signal: AbortSignal,
): Promise<void> {
  let aborted = signal.aborted
  let abortReason: unknown = signal.reason
  const cancel = (): void => {
    aborted = true
    abortReason = signal.reason
    handle.cancel('browser element capture cancelled')
  }
  if (aborted) cancel()
  else signal.addEventListener('abort', cancel, { once: true })

  let rejected = false
  let runError: unknown
  try {
    await handle.result
  } catch (error) {
    rejected = true
    runError = error
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  if (aborted) {
    throw abortReason instanceof Error ? abortReason : new Error('browser element capture cancelled')
  }
  if (rejected) throw new Error(errorMessage(runError))
}

async function filterCaptureForRoute(
  ctx: Context,
  assembly: PromptAssembly,
  signal: AbortSignal | undefined,
): Promise<PromptAssembly> {
  if (!assembly.tools.some(tool => tool.name === 'browser_capture_element')) return assembly
  const provider = assembly.variables.provider
  const model = assembly.variables.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'browser_capture_element') }
  }
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    if (info.inputModalities?.includes('image') === true) return assembly
  } catch (error: unknown) {
    signal?.throwIfAborted()
    ctx.logger.debug(`tool-browser-element-capture: hiding image tool because model capability resolution failed: ${errorMessage(error)}`)
  }
  return { ...assembly, tools: assembly.tools.filter(tool => tool.name !== 'browser_capture_element') }
}

async function assertImageCapableRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('browser_capture_element requires a resolvable image-capable model route')
  }
  const info = await llm.resolveModelInfo(provider, model, exec.signal)
  if (info.inputModalities?.includes('image') !== true) {
    throw new Error(`browser_capture_element requires an image-capable model; '${model}' does not declare image input`)
  }
}

function targetValue(target: BrowserElementCaptureTarget): CaptureTargetValue {
  return target.kind === 'selection'
    ? { kind: 'selection', selection_id: target.selectionId }
    : {
      kind: 'observation',
      observation_id: target.observationId,
      element_id: target.elementId,
    }
}

/**
 * Register selection and capture tools.
 * @param ctx - Context carrying Browser, Coordination, prompt, and Tool services.
 * @param config - Timeout and screenshot format configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveBrowserElementCaptureConfig(config)
  ctx.on('system-prompt/assemble', async (_assembly, context, next) =>
    filterCaptureForRoute(ctx, await next(), context.signal))
  ctx.systemPrompt.section({
    name: 'tool:browser-element-capture',
    order: 113,
    text: BROWSER_ELEMENT_CAPTURE_SYSTEM_PROMPT,
  })

  ctx.tools.register(defineTool({
    name: 'browser_select_element',
    description: 'Show a temporary hover highlight on a persistent browser page and wait for one user-selected element.',
    parameters: {
      page_id: {
        type: 'string',
        required: true,
        description: 'Persistent page id returned by browser_list or browser_open.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page_id: { type: 'string', required: true },
          selection_id: { type: 'string', required: true },
          tag_name: { type: 'string', required: true },
          role: { type: 'string', required: true },
          name: { type: 'string', required: true },
          text: { type: 'string', required: true },
          rect: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              x: { type: 'number', required: true },
              y: { type: 'number', required: true },
              width: { type: 'number', required: true },
              height: { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => selectionContent(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const selection = await ctx.browser.selectElement({
        pageId: BrowserPageId(nonEmpty('page_id', args.page_id)),
      }, exec.signal)
      return {
        page_id: selection.pageId,
        selection_id: selection.selectionId,
        tag_name: selection.tagName,
        role: selection.role,
        name: selection.name,
        text: selection.text,
        rect: selection.rect,
      }
    },
    presentCall: args => callView(`Select element on ${args.page_id}`),
  }))

  ctx.tools.register(defineTool({
    name: 'browser_capture_element',
    description: 'Capture a verified cropped image using either browser_snapshot ids or a browser_select_element selection id.',
    parameters: {
      page_id: { type: 'string', required: true, description: 'Persistent browser page id.' },
      observation_id: {
        type: 'string',
        description: 'Exact observation_id returned by browser_snapshot; use with element_id.',
      },
      element_id: {
        type: 'string',
        description: 'Element id from the same browser_snapshot observation.',
      },
      selection_id: {
        type: 'string',
        description: 'Temporary selection id returned by browser_select_element.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          page_id: { type: 'string', required: true },
          target: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, enum: ['observation', 'selection'] },
              observation_id: { type: 'string' },
              element_id: { type: 'string' },
              selection_id: { type: 'string' },
            },
          },
          verified: { type: 'boolean', required: true },
          image: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true, enum: ['image/png', 'image/jpeg'] },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => captureContent(value),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const request = captureTarget(args, resolved.screenshotFormat)
      await assertImageCapableRoute(ctx, exec)
      const taskId = TaskId(`browser-capture-${randomUUID()}`)
      const run = ctx.coordination.start({
        tasks: [{
          id: taskId,
          label: 'Capture browser element',
          executor: EXECUTOR_KIND,
          input: taskInput(args, resolved.screenshotFormat),
        }],
      })
      await awaitRun(run, exec.signal)
      const task = ctx.coordination.getTask(taskId)
      if (task.status !== 'succeeded') {
        throw new Error(task.error ?? `browser element capture task ended with status ${task.status}`)
      }
      const value: CaptureValue = {
        page_id: request.pageId,
        target: targetValue(request.target),
        verified: true,
        image: readCaptureOutput(task.output),
      }
      if (exec.parent !== undefined) {
        exec.deferContext(createUserMessage({
          content: captureContent(value),
          source: { kind: 'plugin', plugin: 'tool-browser-element-capture' },
        }))
      }
      return value
    },
    presentCall: args => callView(`Capture element on ${args.page_id}`),
  }))
}
