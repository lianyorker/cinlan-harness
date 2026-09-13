/** Coordination executor that persists one verified Browser element crop. */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  BrowserElementId,
  BrowserElementSelectionId,
  BrowserObservationId,
  BrowserPageId,
} from '@deepseek-ai/dsh-browser'
import type { BrowserElementCaptureRequest } from '@deepseek-ai/dsh-browser'
import type { TaskOutcome, TaskSnapshot } from '@deepseek-ai/dsh-coordination'
import { isJsonValue } from '@deepseek-ai/dsh-util-values'

/** Cordis plugin name. */
export const name = 'coordination-browser-element-capture'

/** Services used by this host-plane executor. */
export const inject = ['attachments', 'browser', 'coordination']

/** Stable coordination executor kind. */
export const BROWSER_ELEMENT_CAPTURE_EXECUTOR = 'browser-element-capture'

type CaptureInput = BrowserElementCaptureRequest

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly ${wanted.join(', ')}`)
  }
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${field} must be a non-empty string without surrounding whitespace`)
  }
  return value
}

function readInput(task: TaskSnapshot): CaptureInput {
  if (!isJsonValue(task.input)) throw new Error('browser capture task input must be JSON-safe')
  const input = record(task.input, 'browser capture task input')
  const kind = nonEmpty(input.kind, 'kind')
  const pageId = BrowserPageId(nonEmpty(input.page_id, 'page_id'))
  const format = nonEmpty(input.format, 'format')
  if (format !== 'png' && format !== 'jpeg') throw new Error('format must be png or jpeg')

  if (kind === 'selection') {
    exactKeys(input, ['page_id', 'kind', 'selection_id', 'format'], 'selection capture input')
    return {
      pageId,
      target: {
        kind,
        selectionId: BrowserElementSelectionId(nonEmpty(input.selection_id, 'selection_id')),
      },
      format,
    }
  }
  if (kind !== 'observation') throw new Error('kind must be selection or observation')
  exactKeys(input, ['page_id', 'kind', 'observation_id', 'element_id', 'format'], 'observation capture input')
  return {
    pageId,
    target: {
      kind,
      observationId: BrowserObservationId(nonEmpty(input.observation_id, 'observation_id')),
      elementId: BrowserElementId(nonEmpty(input.element_id, 'element_id')),
    },
    format,
  }
}

function attachmentOutput(image: ImageAttachmentRef): Record<string, string | number> {
  return {
    attachmentId: String(image.attachmentId),
    mediaType: image.mediaType,
    bytes: image.bytes,
    width: image.width,
    height: image.height,
    ...(image.name === undefined ? {} : { name: image.name }),
  }
}

async function execute(ctx: Context, task: TaskSnapshot, signal: AbortSignal): Promise<TaskOutcome> {
  try {
    signal.throwIfAborted()
    const request = readInput(task)
    const capture = await ctx.browser.captureElement(request, signal)
    signal.throwIfAborted()
    const extension = capture.format === 'png' ? 'png' : 'jpg'
    const image = await ctx.attachments.saveImage({
      data: capture.data,
      mediaType: capture.mediaType,
      name: `browser-element.${extension}`,
    })
    if (capture.mediaType !== image.mediaType) {
      throw new Error('attachment media type did not match the Browser capture result')
    }
    return { status: 'succeeded', output: attachmentOutput(image) }
  } catch (error) {
    if (signal.aborted) return { status: 'cancelled', error: errorMessage(error) }
    return { status: 'failed', error: errorMessage(error) }
  }
}

/**
 * Register the executor on the process-local coordination service.
 * @param ctx - Context carrying Browser, attachment, and Coordination services.
 */
export function apply(ctx: Context): void {
  const dispose = ctx.coordination.registerExecutor(
    BROWSER_ELEMENT_CAPTURE_EXECUTOR,
    (task, signal) => execute(ctx, task, signal),
  )
  ctx.effect(() => dispose, 'coordination-browser-element-capture: executor')
}
