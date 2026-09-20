/** Model-facing Mobile Device tools over `ctx.mobileDevice`. @module @deepseek-ai/dsh-tool-mobile-device */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  MobileDeviceId,
  MobileObservationId,
} from '@deepseek-ai/dsh-mobile-device'
import type {
  MobileDevice,
  MobileMutationResult,
  MobileObservation,
} from '@deepseek-ai/dsh-mobile-device'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolExecution, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Cordis plugin name. */
export const name = 'tool-mobile-device'

/** Services required by the Mobile Device Consumer. */
export const inject = ['attachments', 'mobileDevice', 'systemPrompt', 'tools']

/** Stable model guidance for Mobile Device tools. */
export const MOBILE_DEVICE_SYSTEM_PROMPT = 'Use mobile_* tools for devices exposed by the configured provider, including connected Android phones and emulators. Provider support determines which platforms and input operations are available. Run mobile_observe before every mutation. You may omit device_id only for mobile_observe to use the saved default device, which must be currently available; there is no fallback. To choose another device, run mobile_list_devices and pass its exact device_id. For every mutation, pass the exact device_id and latest observation_id returned by mobile_observe; every observation token is one-use and every mutation requires a fresh observe afterward. Touch coordinates are normalized from 0 to 1. Typed text is never echoed in result summaries.'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_TEXT_CHARS = 100_000

/** Tool-suite configuration. */
export interface Config {
  /** Cooperative timeout attached to every tool. Defaults to 60000 ms. */
  readonly timeoutMs?: number
  /** Maximum literal text length accepted from one call. Defaults to 100000 characters. */
  readonly maxTextChars?: number
}

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxTextChars: number
}

const CONFIG_KEYS = new Set(['timeoutMs', 'maxTextChars'])

/** Loader schema for Mobile Device tool configuration. */
export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  maxTextChars: z.number().default(DEFAULT_MAX_TEXT_CHARS),
})

/**
 * Validate and default Mobile Device tool configuration.
 * @param config User-supplied Mobile Device tool configuration.
 * @returns Fully validated configuration with every default resolved.
 */
export function resolveMobileDeviceToolConfig(config: Config = {}): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`tool-mobile-device: unsupported config key '${key}'`)
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`tool-mobile-device: timeoutMs must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  const maxTextChars = config.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS
  if (!Number.isSafeInteger(maxTextChars) || maxTextChars < 1) {
    throw new Error('tool-mobile-device: maxTextChars must be a positive safe integer')
  }
  return { timeoutMs, maxTextChars }
}

function nonEmpty(name: string, value: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be non-empty without surrounding whitespace`)
  }
  return value
}

function normalized(name: string, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite normalized coordinate from 0 to 1`)
  }
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

function deviceValue(device: MobileDevice): {
  backend: string
  device_id: string
  name: string
  state: string
  is_available: boolean
  detail?: string
} {
  return {
    backend: device.backend,
    device_id: device.id,
    name: device.name,
    state: device.state,
    is_available: device.isAvailable,
    ...(device.detail === undefined ? {} : { detail: device.detail }),
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
  device: ReturnType<typeof deviceValue>
  device_generation: string
  observation_id: string
  coordinate_space: 'normalized'
  tree: string
  screenshot_status: string
  screenshot_error?: string
  image_error?: string
  image?: ImageValue
}

function imageRef(value: ImageValue): ImageAttachmentRef {
  return {
    attachmentId: AttachmentId(value.attachmentId),
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(value.name === undefined ? {} : { name: value.name }),
  }
}

function observationContent(value: ObservationValue): ContentBlock[] {
  const status = value.screenshot_error === undefined
    ? `Screenshot: ${value.screenshot_status}`
    : `Screenshot: ${value.screenshot_status} (${value.screenshot_error})`
  const blocks: ContentBlock[] = [{
    type: 'text',
    text: [
      `Device: ${value.device.device_id} ${value.device.name}`,
      `Generation: ${value.device_generation}`,
      `Observation: ${value.observation_id}`,
      'Coordinate space: normalized',
      status,
      ...(value.image_error === undefined ? [] : [`Image persistence: ${value.image_error}`]),
      value.tree.length === 0 ? '(empty device tree)' : value.tree,
    ].join('\n'),
  }]
  if (value.image !== undefined) blocks.push({ type: 'image', attachment: imageRef(value.image) })
  return blocks
}

async function observationValue(
  ctx: Context,
  observation: MobileObservation,
  exec: ToolRunContext,
): Promise<ObservationValue> {
  let image: ImageValue | undefined
  let imageError: string | undefined
  if (observation.screenshot !== undefined) {
    try {
      const ref = await ctx.attachments.saveImage({
        data: observation.screenshot.data,
        mediaType: 'image/png',
        name: 'mobile-device-screenshot.png',
      })
      image = {
        attachmentId: ref.attachmentId,
        mediaType: 'image/png',
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.name === undefined ? {} : { name: ref.name }),
      }
    } catch (error) {
      imageError = error instanceof Error ? error.message : String(error)
    }
  }
  const value: ObservationValue = {
    device: deviceValue(observation.device),
    device_generation: observation.deviceGeneration,
    observation_id: observation.observationId,
    coordinate_space: 'normalized',
    tree: observation.tree,
    screenshot_status: observation.screenshotStatus.state,
    ...(observation.screenshotStatus.state === 'failed'
      ? { screenshot_error: `${observation.screenshotStatus.code}: ${observation.screenshotStatus.message}` }
      : {}),
    ...(imageError === undefined ? {} : { image_error: imageError }),
    ...(image === undefined ? {} : { image }),
  }
  if (image !== undefined && exec.parent !== undefined) {
    exec.deferContext(createUserMessage({
      content: observationContent(value),
      source: { kind: 'plugin', plugin: 'tool-mobile-device' },
    }))
  }
  return value
}

const observeDeviceIdParameter = {
  type: 'string' as const,
  description: 'Exact device id returned by mobile_list_devices. Omit to use the saved default device; it must be currently available and there is no fallback.',
} as const

const deviceIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'Exact device id returned by the latest mobile_observe.',
} as const

const observationIdParameter = {
  type: 'string' as const,
  required: true,
  description: 'One-use observation id returned by the latest mobile_observe for this device.',
} as const

const mutationParameters = {
  device_id: deviceIdParameter,
  observation_id: observationIdParameter,
} as const

const deviceProperties = {
  backend: { type: 'string' as const, required: true },
  device_id: { type: 'string' as const, required: true },
  name: { type: 'string' as const, required: true },
  state: { type: 'string' as const, required: true },
  is_available: { type: 'boolean' as const, required: true },
  detail: { type: 'string' as const },
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
    device: { type: 'object' as const, required: true, additionalProperties: false, properties: deviceProperties },
    device_generation: { type: 'string' as const, required: true },
    observation_id: { type: 'string' as const, required: true },
    coordinate_space: { type: 'string' as const, enum: ['normalized'] as const, required: true },
    tree: { type: 'string' as const, required: true },
    screenshot_status: { type: 'string' as const, required: true },
    screenshot_error: { type: 'string' as const },
    image_error: { type: 'string' as const },
    image: { type: 'object' as const, additionalProperties: false, properties: imageProperties },
  },
} as const

function mutationValue(result: MobileMutationResult): {
  device_id: string
  device_generation: string
  observation_id: string
  requires_fresh_observe: true
} {
  return {
    device_id: result.device.id,
    device_generation: result.deviceGeneration,
    observation_id: result.observationId,
    requires_fresh_observe: true,
  }
}

const mutationOutput = {
  schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      device_id: { type: 'string' as const, required: true },
      device_generation: { type: 'string' as const, required: true },
      observation_id: { type: 'string' as const, required: true },
      requires_fresh_observe: { type: 'boolean' as const, required: true },
    },
  },
  render: (_args: unknown, value: ReturnType<typeof mutationValue>) => [{
    type: 'text' as const,
    text: `Updated device ${value.device_id}. Run mobile_observe before another mutation.`,
  }],
} as const

function exactMutation(args: { device_id: string; observation_id: string }) {
  return {
    deviceId: MobileDeviceId(nonEmpty('device_id', args.device_id)),
    observationId: MobileObservationId(nonEmpty('observation_id', args.observation_id)),
  }
}

/** Register the five Mobile Device tools and system guidance. */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveMobileDeviceToolConfig(config)
  ctx.systemPrompt.section({ name: 'tool:mobile-device', order: 114, text: MOBILE_DEVICE_SYSTEM_PROMPT })

  ctx.tools.register(defineTool({
    name: 'mobile_list_devices',
    description: 'List exact device ids and availability from the configured mobile provider.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          devices: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: deviceProperties },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.devices.length === 0
          ? 'No mobile devices are available.'
          : value.devices.map(device => `${device.device_id} ${device.name} backend=${device.backend} state=${device.state} available=${device.is_available}`).join('\n'),
      }],
    },
    timeoutMs: resolved.timeoutMs,
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      return { devices: (await ctx.mobileDevice.listDevices(exec.signal)).map(deviceValue) }
    },
    presentCall(): GenericCallView {
      return { card: 'generic', title: 'List mobile devices', kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mobile_observe',
    description: 'Read one fresh mobile-device tree and optional native PNG image.',
    parameters: { device_id: observeDeviceIdParameter },
    output: {
      schema: observationOutputSchema,
      render: (_args, value) => observationContent(value),
      presentationMeta: (_args, value) => ({ device_id: value.device.device_id }),
    },
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const observation = await ctx.mobileDevice.observe({
        ...(args.device_id === undefined ? {} : { deviceId: MobileDeviceId(nonEmpty('device_id', args.device_id)) }),
        captureScreenshot: await wantsScreenshot(ctx, exec),
      }, exec.signal)
      return observationValue(ctx, observation, exec)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: args.device_id === undefined ? 'Observe saved default device' : `Observe ${args.device_id}`, kind: 'read' }
    },
    presentResult(_args, result) {
      const meta = result.meta
      if (result.isError || typeof meta !== 'object' || meta === null || Array.isArray(meta)
        || typeof meta.device_id !== 'string' || meta.device_id.length === 0) return undefined
      return { card: 'generic', title: `Observe ${meta.device_id}` }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mobile_touch',
    description: 'Tap or swipe with normalized coordinates using one exact observation.',
    parameters: {
      ...mutationParameters,
      action: { type: 'string', enum: ['tap', 'swipe'] as const, required: true },
      x: { type: 'number', description: 'Normalized tap x from 0 to 1.' },
      y: { type: 'number', description: 'Normalized tap y from 0 to 1.' },
      from_x: { type: 'number', description: 'Normalized swipe start x from 0 to 1.' },
      from_y: { type: 'number', description: 'Normalized swipe start y from 0 to 1.' },
      to_x: { type: 'number', description: 'Normalized swipe destination x from 0 to 1.' },
      to_y: { type: 'number', description: 'Normalized swipe destination y from 0 to 1.' },
    },
    output: mutationOutput,
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      const base = exactMutation(args)
      const result = args.action === 'tap'
        ? await (async () => {
          rejectDefined(args, ['from_x', 'from_y', 'to_x', 'to_y'], 'tap')
          return ctx.mobileDevice.touch({
            ...base, kind: 'tap', x: normalized('x', args.x), y: normalized('y', args.y),
          }, exec.signal)
        })()
        : await (async () => {
          rejectDefined(args, ['x', 'y'], 'swipe')
          return ctx.mobileDevice.touch({
            ...base,
            kind: 'swipe',
            fromX: normalized('from_x', args.from_x),
            fromY: normalized('from_y', args.from_y),
            toX: normalized('to_x', args.to_x),
            toY: normalized('to_y', args.to_y),
          }, exec.signal)
        })()
      return mutationValue(result)
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `${args.action} ${args.device_id}`, kind: 'execute' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mobile_type',
    description: 'Type literal text through stdin using one exact mobile observation.',
    parameters: { ...mutationParameters, text: { type: 'string', required: true } },
    output: mutationOutput,
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      if (args.text.length > resolved.maxTextChars) {
        throw new Error(`text exceeds the configured ${resolved.maxTextChars}-character limit`)
      }
      return mutationValue(await ctx.mobileDevice.typeText({
        ...exactMutation(args), text: args.text,
      }, exec.signal))
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Type text on ${args.device_id}`, kind: 'execute' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'mobile_button',
    description: 'Press one provider-supported device navigation button using an exact observation.',
    parameters: { ...mutationParameters, button: { type: 'string', required: true } },
    output: mutationOutput,
    timeoutMs: resolved.timeoutMs,
    async execute(args, exec) {
      return mutationValue(await ctx.mobileDevice.pressButton({
        ...exactMutation(args), button: nonEmpty('button', args.button),
      }, exec.signal))
    },
    presentCall(args): GenericCallView {
      return { card: 'generic', title: `Press ${args.button} on ${args.device_id}`, kind: 'execute' }
    },
  }))
}
