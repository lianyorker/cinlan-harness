/** Isolated profile preparation; Electron reads the bundled worker through its ASAR-aware filesystem. */

import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type { DesktopPaths } from './paths.ts'
import type { DesktopRuntimeExecutables } from './project-manager.ts'
import type { DesktopStartupStage } from './startup.ts'

/** Immutable inputs copied to the preparation worker. */
export interface DesktopPreparationRequest {
  readonly paths: DesktopPaths
  readonly runtime: DesktopRuntimeExecutables
  readonly seed: string
  readonly version: string
}

const PREPARATION_STAGES: readonly DesktopStartupStage[] = [
  'recovering', 'verifying', 'extracting', 'installing', 'checking', 'cleaning', 'activating',
]

/**
 * Prepare the profile without blocking Electron's window or input processing.
 * @param request - Packaged seed, owned paths, and bundled executables.
 * @param signal - Cancellation waits for the worker's safe checkpoints and exit; it never terminates a transaction.
 * @param report - Actual operation starting in the worker.
 * @returns After the worker and all its owned children have finished.
 */
export async function prepareDesktopProfile(
  request: DesktopPreparationRequest,
  signal: AbortSignal,
  report: (stage: DesktopStartupStage) => void,
): Promise<void> {
  signal.throwIfAborted()
  const source = await readFile(new URL('./startup-worker.cjs', import.meta.url), 'utf8')
  signal.throwIfAborted()
  await runDesktopPreparationWorker(source, request, signal, report)
}

/**
 * Run the self-contained CommonJS worker from trusted bundle bytes, with no worker filesystem entry lookup.
 * @param source - Bundled worker source read by Electron, including all non-builtin dependencies.
 * @param request - Immutable preparation inputs.
 * @param signal - Cooperative cancellation shared with synchronous worker checkpoints.
 * @param report - Stage observer; disabled as soon as cancellation begins.
 * @returns After the worker's exit event, rejecting worker failures and missing completion messages.
 */
export async function runDesktopPreparationWorker(
  source: string,
  request: DesktopPreparationRequest,
  signal: AbortSignal,
  report: (stage: DesktopStartupStage) => void,
): Promise<void> {
  signal.throwIfAborted()
  const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  // Native Worker entry resolution and ESM imports do not consistently understand app.asar.
  // This bundle requires only Node builtins and needs neither an extracted entry nor a relative require.
  const worker = new Worker(source, { eval: true, execArgv: [], workerData: { ...request, cancellation: cancellation.buffer } })
  await new Promise<void>((resolve, reject) => {
    let failure: Error | undefined
    let completed = false
    const cancel = (): void => {
      Atomics.store(cancellation, 0, 1)
      worker.postMessage('cancel')
    }
    signal.addEventListener('abort', cancel, { once: true })
    const invalidMessage = (): void => {
      failure ??= new Error('Desktop preparation worker sent an invalid message')
      cancel()
    }
    worker.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) { invalidMessage(); return }
      const value = message as Record<string, unknown>
      if (value.type === 'stage' && typeof value.stage === 'string'
        && PREPARATION_STAGES.includes(value.stage as DesktopStartupStage) && !completed) {
        if (!signal.aborted && failure === undefined) {
          try { report(value.stage as DesktopStartupStage) } catch (error) {
            failure = error instanceof Error ? error : new Error(String(error))
            cancel()
          }
        }
      } else if (value.type === 'done' && !completed) {
        completed = true
      } else if (value.type === 'error' && typeof value.message === 'string' && typeof value.stack === 'string' && !completed) {
        completed = true
        if (failure === undefined) {
          failure = new Error(value.message)
          failure.stack = value.stack
        }
      } else invalidMessage()
    })
    worker.once('error', (error) => { failure = error })
    worker.once('exit', (code) => {
      signal.removeEventListener('abort', cancel)
      if (failure !== undefined) reject(failure)
      else if (signal.aborted) reject(signal.reason instanceof Error ? signal.reason : new Error('Desktop preparation canceled'))
      else if (code !== 0 || !completed) reject(new Error(`Desktop preparation worker exited without completing (${String(code)})`))
      else resolve()
    })
    if (signal.aborted) cancel()
  })
}
