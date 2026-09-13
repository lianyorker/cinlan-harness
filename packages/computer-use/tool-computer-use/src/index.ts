/**
 * Model-facing desktop Computer Use tools over `ctx.computerUse`. This Consumer
 * groups the full provider action vocabulary by permission class, owns strict
 * model-input validation, persists optional screenshots, and never exposes
 * provider temporary paths or typed text in result summaries.
 * @module @deepseek-ai/dsh-tool-computer-use
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  ComputerAppId,
  ComputerElementId,
  ComputerObservationId,
  ComputerWindowId,
} from '@deepseek-ai/dsh-computer-use'
import type {
  ComputerActionResult,
  ComputerApp,
  ComputerDragTarget,
  ComputerObservation,
  ComputerPointerTarget,
  ComputerWindow,
} from '@deepseek-ai/dsh-computer-use'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Cordis plugin name. */
export const name = 'tool-computer-use'

/** Required services; `llm` is queried only to decide optional screenshot admission. */
export const inject = ['attachments', 'computerUse', 'systemPrompt', 'tools']

/** Stable model guidance for desktop Computer Use. */
export const COMPUTER_USE_SYSTEM_PROMPT = 'Use computer_* tools for local desktop applications, native windows, browser chrome, and webviews. Run computer_observe before every action and use only its exact observation_id, window_id, and element ids. Every action returns a fresh observation; prior element ids immediately expire. Prefer accessibility actions and element ids over coordinates. Typed text and set values are not echoed in result summaries. Persistent web-page automation remains a separate browser_* capability.'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_TEXT_CHARS = 100_000

/** Tool-suite configuration. */
export interface Config {
  /** Cooperative timeout attached to every tool. Defaults to 60000 ms. */
  readonly timeoutMs?: number
  /** Maximum text or value length accepted from one tool call. Defaults to 100000 characters. */
  readonly maxTextChars?: number
}

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxTextChars: number
}

const CONFIG_KEYS = new Set(['timeoutMs', 'maxTextChars'])

/** Loader schema for Computer Use tool configuration. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxTextChars: z.number().default(DEFAULT_MAX_TEXT_CHARS),
})

/**
 * Validate and default Computer Use tool configuration.
 * @param config Partial tool-suite limits.
 * @returns Complete validated tool-suite limits.
 */
export function resolveComputerUseToolConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`tool-computer-use: unsupported config key '${key}'`)
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-computer-use: timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const maxTextChars = config.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars < 1) {
    throw new Error('tool-computer-use: maxTextChars must be a positive safe integer')
  }
  return { timeoutMs, maxTextChars }
}

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function optionalNonEmpty(name: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : nonEmpty(name, value)
}

function positiveInteger(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`)
  return value
}

function coordinate(name: string, value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative finite number`)
  return value
}

function boundedText(name: string, value: string, maxTextChars: number): string {
  if (value.length > maxTextChars) throw new Error(`${name} exceeds the configured ${maxTextChars}-character limit`)
  return value
}

function rejectDefined(args: Record<string, unknown>, keys: readonly string[], action: string): void {
  for (const key of keys) {
    if (args[key] !== undefined) throw new Error(`${key} is not valid for ${action}`)
  }
}

async function wantsScreenshot(ctx: Context, exec: ToolExecution): Promise<boolean> {
  if (!ctx.attachments.imageLimits.mediaTypes.includes('image/png')) return false
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return info.inputModalities?.includes('image') ?? false
  } catch {
    return false
  }
}

function appValue(app: ComputerApp): {
  app_id: string
  name: string
  pid: number
  running: boolean
  bundle_id?: string
} {
  return {
    app_id: app.appId,
    name: app.name,
    pid: app.pid,
    running: app.running,
    ...(app.bundleId === null ? {} : { bundle_id: app.bundleId }),
  }
}

function windowValue(window: ComputerWindow): {
  window_id: string
  app_id: string
  title: string
  width: number
  height: number
  x?: number
  y?: number
  minimized?: boolean
  offscreen?: boolean
  main?: boolean
} {
  return {
    window_id: window.windowId,
    app_id: window.appId,
    title: window.title,
    width: window.width,
    height: window.height,
    ...(window.x === null ? {} : { x: window.x }),
    ...(window.y === null ? {} : { y: window.y }),
    ...(window.minimized === null ? {} : { minimized: window.minimized }),
    ...(window.offscreen === null ? {} : { offscreen: window.offscreen }),
    ...(window.main === null ? {} : { main: window.main }),
  }
}

interface ImageValue {
  attachmentId: string
  mediaType: 'image/png'
  bytes: number
  width: number
  height: number
  name?: string
}

interface ObservationValue {
  observation_id: string
  app_id: string
  window_id: string
  window_title: string
  width: number
  height: number
  coordinate_space: 'window'
  tree: string
  elements: { element_id: string; index: number }[]
  focused_element_id?: string
  screenshot_status: string
  screenshot_error?: string
  image_error?: string
  image?: ImageValue
  action?: {
    path: 'accessibility' | 'synthetic' | 'clipboard'
    action_name?: string
    fallback_reason?: string
    verification?: string
  }
}

function imageRef(value: ImageValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(value.attachmentId),
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...value.name === undefined ? {} : { name: value.name },
  }
}

function observationContent(value: ObservationValue): ContentBlock[] {
  const status = value.screenshot_error === undefined
    ? `Screenshot: ${value.screenshot_status}`
    : `Screenshot: ${value.screenshot_status} (${value.screenshot_error})`
  const blocks: ContentBlock[] = [{
    type: 'text',
    text: [
      `Observation: ${value.observation_id}`,
      `App: ${value.app_id}`,
      `Window: ${value.window_id} ${value.window_title}`,
      `Window size: ${value.width}x${value.height}`,
      status,
      ...(value.image_error === undefined ? [] : [`Image persistence: ${value.image_error}`]),
      value.tree.length === 0 ? '(empty accessibility tree)' : value.tree,
    ].join('\n'),
  }]
  if (value.image !== undefined) blocks.push({ type: 'image', attachment: imageRef(value.image) })
  return blocks
}

async function observationValue(
  ctx: Context,
  observation: ComputerObservation,
  exec: ToolRunContext,
  action: ComputerActionResult['action'] | undefined,
): Promise<ObservationValue> {
  let image: ImageValue | undefined
  let imageError: string | undefined
  if (observation.screenshot !== undefined) {
    try {
      const ref = await ctx.attachments.saveImage({
        data: observation.screenshot.data,
        mediaType: 'image/png',
        name: 'computer-screenshot.png',
      })
      image = {
        attachmentId: ref.attachmentId,
        mediaType: 'image/png',
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...ref.name === undefined ? {} : { name: ref.name },
      }
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error)
    }
  }
  const value: ObservationValue = {
    observation_id: observation.observationId,
    app_id: observation.app.appId,
    window_id: observation.window.windowId,
    window_title: observation.window.title,
    width: observation.window.width,
    height: observation.window.height,
    coordinate_space: 'window',
    tree: observation.tree,
    elements: observation.elements.map(element => ({ element_id: element.elementId, index: element.index })),
    ...(observation.focusedElementId === null ? {} : { focused_element_id: observation.focusedElementId }),
    screenshot_status: observation.screenshotStatus.state,
    ...(observation.screenshotStatus.state === 'failed' ? { screenshot_error: observation.screenshotStatus.message } : {}),
    ...(imageError === undefined ? {} : { image_error: imageError }),
    ...(image === undefined ? {} : { image }),
    ...(action === undefined ? {} : {
      action: {
        path: action.path,
        ...(action.actionName === null ? {} : { action_name: action.actionName }),
        ...(action.fallbackReason === null ? {} : { fallback_reason: action.fallbackReason }),
        ...(action.verification === undefined
          ? {}
          : { verification: action.verification.state === 'verified'
            ? `${action.verification.state}:${action.verification.property}`
            : `${action.verification.state}:${action.verification.reason}` }),
      },
    }),
  }
  if (value.image !== undefined && exec.parent !== undefined) {
    exec.deferContext(createUserMessage({
      content: observationContent(value),
      source: { kind: 'plugin', plugin: 'tool-computer-use' },
    }))
  }
  return value
}

const appIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'Application id returned by computer_list_apps.',
} as const

const windowIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'Window id returned by computer_list_windows or computer_observe.',
} as const

const observationIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'Exact observation id returned by the latest computer_observe or action for this window.',
} as const

const actionBaseParameters = {
  app_id: appIdParameter,
  window_id: windowIdParameter,
  observation_id: observationIdParameter,
  restore_window: { type: 'boolean' as const, description: 'Bring the exact target window forward before acting.' },
} as const

const imageProperties = {
  attachmentId: { type: 'string' as const, required: true },
  mediaType: { type: 'string' as const, enum: ['image/png'] as const, required: true },
  bytes: { type: 'integer' as const, required: true },
  width: { type: 'integer' as const, required: true },
  height: { type: 'integer' as const, required: true },
  name: { type: 'string' as const },
} as const

const observationOutputSchema = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    observation_id: { type: 'string' as const, required: true },
    app_id: { type: 'string' as const, required: true },
    window_id: { type: 'string' as const, required: true },
    window_title: { type: 'string' as const, required: true },
    width: { type: 'integer' as const, required: true },
    height: { type: 'integer' as const, required: true },
    coordinate_space: { type: 'string' as const, enum: ['window'] as const, required: true },
    tree: { type: 'string' as const, required: true },
    elements: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          element_id: { type: 'string' as const, required: true },
          index: { type: 'integer' as const, required: true },
        },
      },
    },
    focused_element_id: { type: 'string' as const },
    screenshot_status: { type: 'string' as const, required: true },
    screenshot_error: { type: 'string' as const },
    image_error: { type: 'string' as const },
    image: {
      type: 'object' as const,
      additionalProperties: false,
      properties: imageProperties,
    },
    action: {
      type: 'object' as const,
      additionalProperties: false,
      properties: {
        path: { type: 'string' as const, enum: ['accessibility', 'synthetic', 'clipboard'] as const, required: true },
        action_name: { type: 'string' as const },
        fallback_reason: { type: 'string' as const },
        verification: { type: 'string' as const },
      },
    },
  },
} as const

function actionRequest(args: {
  app_id: string
  window_id: string
  observation_id: string
  restore_window?: boolean
}, captureScreenshot: boolean) {
  return {
    appId: ComputerAppId(nonEmpty('app_id', args.app_id)),
    windowId: ComputerWindowId(nonEmpty('window_id', args.window_id)),
    observationId: ComputerObservationId(nonEmpty('observation_id', args.observation_id)),
    ...(args.restore_window === true ? { restoreWindow: true } : {}),
    captureScreenshot,
  }
}

function pointerTarget(args: {
  element_id?: string
  x?: number
  y?: number
}, label: string): ComputerPointerTarget {
  const elementId = optionalNonEmpty('element_id', args.element_id)
  const x = coordinate('x', args.x)
  const y = coordinate('y', args.y)
  if (elementId !== undefined && x === undefined && y === undefined) {
    return { kind: 'element', elementId: ComputerElementId(elementId) }
  }
  if (elementId === undefined && x !== undefined && y !== undefined) return { kind: 'point', x, y }
  throw new Error(`${label} requires element_id or both x and y`)
}

function dragTarget(args: {
  element_id?: string
  to_element_id?: string
  x?: number
  y?: number
  to_x?: number
  to_y?: number
}): ComputerDragTarget {
  const fromElement = optionalNonEmpty('element_id', args.element_id)
  const toElement = optionalNonEmpty('to_element_id', args.to_element_id)
  const x = coordinate('x', args.x)
  const y = coordinate('y', args.y)
  const toX = coordinate('to_x', args.to_x)
  const toY = coordinate('to_y', args.to_y)
  if (fromElement !== undefined && toElement !== undefined
    && x === undefined && y === undefined && toX === undefined && toY === undefined) {
    return {
      kind: 'elements',
      fromElementId: ComputerElementId(fromElement),
      toElementId: ComputerElementId(toElement),
    }
  }
  if (fromElement === undefined && toElement === undefined
    && x !== undefined && y !== undefined && toX !== undefined && toY !== undefined) {
    return { kind: 'points', fromX: x, fromY: y, toX, toY }
  }
  throw new Error('drag requires element_id plus to_element_id, or x/y plus to_x/to_y')
}

/** Register the six lightweight desktop Computer Use tools and system guidance. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveComputerUseToolConfig(config)
  ctx.systemPrompt.section({ name: 'tool:computer-use', order: 113, text: COMPUTER_USE_SYSTEM_PROMPT })

  ctx.tools.register(defineTool({
    name: 'computer_list_apps',
    description: 'List local desktop applications available to Computer Use.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          apps: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                app_id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                bundle_id: { type: 'string' },
                pid: { type: 'integer', required: true },
                running: { type: 'boolean', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.apps.length === 0
          ? 'No desktop applications are available.'
          : value.apps.map(app => `${app.app_id} ${app.name} pid=${app.pid}`).join('\n'),
      }],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return { apps: (await ctx.computerUse.listApps(exec.signal)).map(appValue) }
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'List desktop apps', kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_list_windows',
    description: 'List current windows for one desktop application.',
    parameters: { app_id: appIdParameter },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                window_id: { type: 'string', required: true },
                app_id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'integer', required: true },
                height: { type: 'integer', required: true },
                minimized: { type: 'boolean' },
                offscreen: { type: 'boolean' },
                main: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.windows.length === 0
          ? 'No windows are available for this application.'
          : value.windows.map(window => `${window.window_id} ${window.title} ${window.width}x${window.height}`).join('\n'),
      }],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const windows = await ctx.computerUse.listWindows({
        appId: ComputerAppId(nonEmpty('app_id', args.app_id)),
      }, exec.signal)
      return { windows: windows.map(windowValue) }
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `List windows for ${args.app_id}`, kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_observe',
    description: 'Read one desktop application accessibility tree and fresh element ids.',
    parameters: {
      app_id: appIdParameter,
      window_id: { type: 'string', description: 'Optional window id; omit only when the application has one unambiguous window.' },
      restore_window: { type: 'boolean', description: 'Bring the target window forward before observing it.' },
    },
    output: { schema: observationOutputSchema, render: (_args, value) => observationContent(value) },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const observation = await ctx.computerUse.observe({
        appId: ComputerAppId(nonEmpty('app_id', args.app_id)),
        ...(args.window_id === undefined ? {} : { windowId: ComputerWindowId(nonEmpty('window_id', args.window_id)) }),
        ...(args.restore_window === true ? { restoreWindow: true } : {}),
        captureScreenshot: await wantsScreenshot(ctx, exec),
      }, exec.signal)
      return observationValue(ctx, observation, exec, undefined)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Observe ${args.app_id}`, kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_pointer',
    description: 'Click, scroll, or drag using one exact desktop observation.',
    parameters: {
      ...actionBaseParameters,
      action: { type: 'string', enum: ['click', 'scroll', 'drag'] as const, required: true },
      element_id: { type: 'string', description: 'Element id for click/scroll or drag start.' },
      to_element_id: { type: 'string', description: 'Element id for drag destination.' },
      x: { type: 'number', description: 'Window-local x for click/scroll or drag start.' },
      y: { type: 'number', description: 'Window-local y for click/scroll or drag start.' },
      to_x: { type: 'number', description: 'Window-local drag destination x.' },
      to_y: { type: 'number', description: 'Window-local drag destination y.' },
      direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] as const },
      pages: { type: 'integer' },
      click_count: { type: 'integer' },
      mouse_button: { type: 'string', enum: ['left', 'right', 'middle'] as const },
      modifiers: { type: 'string', description: 'One provider-supported modifier chord.' },
    },
    output: { schema: observationOutputSchema, render: (_args, value) => observationContent(value) },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const captureScreenshot = await wantsScreenshot(ctx, exec)
      const base = actionRequest(args, captureScreenshot)
      let result: ComputerActionResult
      if (args.action === 'click') {
        rejectDefined(args, ['to_element_id', 'to_x', 'to_y', 'direction', 'pages'], 'click')
        result = await ctx.computerUse.click({
          ...base,
          target: pointerTarget(args, 'click'),
          ...(positiveInteger('click_count', args.click_count) === undefined ? {} : { clickCount: args.click_count }),
          ...(args.mouse_button === undefined ? {} : { mouseButton: args.mouse_button }),
          ...(optionalNonEmpty('modifiers', args.modifiers) === undefined ? {} : { modifiers: args.modifiers }),
        }, exec.signal)
      } else if (args.action === 'scroll') {
        rejectDefined(args, ['to_element_id', 'to_x', 'to_y', 'click_count', 'mouse_button', 'modifiers'], 'scroll')
        if (args.direction === undefined) throw new Error('direction is required for scroll')
        result = await ctx.computerUse.scroll({
          ...base,
          target: pointerTarget(args, 'scroll'),
          direction: args.direction,
          ...(positiveInteger('pages', args.pages) === undefined ? {} : { pages: args.pages }),
        }, exec.signal)
      } else {
        rejectDefined(args, ['direction', 'pages', 'click_count', 'mouse_button', 'modifiers'], 'drag')
        result = await ctx.computerUse.drag({ ...base, target: dragTarget(args) }, exec.signal)
      }
      return observationValue(ctx, result.observation, exec, result.action)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `${args.action} in ${args.app_id}`, kind: 'execute' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_keyboard',
    description: 'Type, paste, press one key, or press one hotkey using one exact desktop observation.',
    parameters: {
      ...actionBaseParameters,
      action: { type: 'string', enum: ['type_text', 'paste_text', 'press_key', 'hotkey'] as const, required: true },
      text: { type: 'string', description: 'Literal text for type_text or paste_text.' },
      key: { type: 'string', description: 'Single key or modifier chord for press_key or hotkey.' },
    },
    output: { schema: observationOutputSchema, render: (_args, value) => observationContent(value) },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const base = actionRequest(args, await wantsScreenshot(ctx, exec))
      let result: ComputerActionResult
      if (args.action === 'type_text' || args.action === 'paste_text') {
        if (args.text === undefined) throw new Error('text is required for type_text and paste_text')
        rejectDefined(args, ['key'], args.action)
        const text = boundedText('text', args.text, resolved.maxTextChars)
        result = args.action === 'type_text'
          ? await ctx.computerUse.typeText({ ...base, text }, exec.signal)
          : await ctx.computerUse.pasteText({ ...base, text }, exec.signal)
      } else {
        rejectDefined(args, ['text'], args.action)
        const key = nonEmpty('key', args.key ?? '')
        result = args.action === 'press_key'
          ? await ctx.computerUse.pressKey({ ...base, key }, exec.signal)
          : await ctx.computerUse.hotkey({ ...base, key }, exec.signal)
      }
      return observationValue(ctx, result.observation, exec, result.action)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `${args.action} in ${args.app_id}`, kind: 'execute' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'computer_accessibility',
    description: 'Perform a secondary accessibility action or set one element value using an exact observation.',
    parameters: {
      ...actionBaseParameters,
      action: { type: 'string', enum: ['secondary_action', 'set_value'] as const, required: true },
      element_id: { type: 'string', required: true },
      action_name: { type: 'string', description: 'Provider-advertised action name for secondary_action.' },
      value: { type: 'string', description: 'Exact value for set_value.' },
    },
    output: { schema: observationOutputSchema, render: (_args, value) => observationContent(value) },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const base = actionRequest(args, await wantsScreenshot(ctx, exec))
      const elementId = ComputerElementId(nonEmpty('element_id', args.element_id))
      let result: ComputerActionResult
      if (args.action === 'secondary_action') {
        rejectDefined(args, ['value'], 'secondary_action')
        result = await ctx.computerUse.performSecondaryAction({
          ...base,
          elementId,
          action: nonEmpty('action_name', args.action_name ?? ''),
        }, exec.signal)
      } else {
        rejectDefined(args, ['action_name'], 'set_value')
        if (args.value === undefined) throw new Error('value is required for set_value')
        result = await ctx.computerUse.setValue({
          ...base,
          elementId,
          value: boundedText('value', args.value, resolved.maxTextChars),
        }, exec.signal)
      }
      return observationValue(ctx, result.observation, exec, result.action)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `${args.action} in ${args.app_id}`, kind: 'execute' }
    },
  }))
}
