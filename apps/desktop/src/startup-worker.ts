/** Node worker entry for transactional startup reconciliation; no Electron imports or relative runtime dependencies. */

import { isAbsolute } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { DesktopHostProcess } from './host-process.ts'
import { DesktopProjectManager } from './project-manager.ts'
import { checkDesktopStartupHost } from './startup-probe.ts'
import type { DesktopPreparationRequest } from './startup-preparation.ts'

function parseRequest(value: unknown): DesktopPreparationRequest & { cancellation: SharedArrayBuffer } {
  if (typeof value !== 'object' || value === null) throw new Error('Desktop preparation worker requires startup inputs')
  const data = value as Record<string, unknown>
  const paths = data.paths as Record<string, unknown> | undefined
  const runtime = data.runtime as Record<string, unknown> | undefined
  const pnpm = paths?.pnpm as Record<string, unknown> | undefined
  if (typeof data.version !== 'string' || !(data.cancellation instanceof SharedArrayBuffer)
    || data.cancellation.byteLength !== Int32Array.BYTES_PER_ELEMENT
    || [data.seed, data.primaryRuntime, runtime?.node, runtime?.pnpm,
      ...['root', 'profile', 'staging', 'rollback', 'pending', 'lock'].map(key => paths?.[key]),
      ...['root', 'store', 'cache', 'state', 'config', 'home'].map(key => pnpm?.[key]),
    ].some(path => typeof path !== 'string' || !isAbsolute(path))) {
    throw new Error('Desktop preparation worker received invalid paths or cancellation state')
  }
  return value as DesktopPreparationRequest & { cancellation: SharedArrayBuffer }
}

async function prepare(): Promise<void> {
  const port = parentPort
  if (port === null) throw new Error('Desktop preparation must run in its owned worker')
  const request = parseRequest(workerData as unknown)
  const cancellation = new Int32Array(request.cancellation)
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(new Error('Desktop profile preparation canceled')) }
  const checkCancellation = (): void => {
    if (Atomics.load(cancellation, 0) !== 0) cancel()
    controller.signal.throwIfAborted()
  }
  port.on('message', cancel)
  try {
    const manager = new DesktopProjectManager(request.paths, request.runtime)
    await manager.applyRelease(request.seed, request.version, {
      healthCheck: async (projectDir) => {
        checkCancellation()
        const host = new DesktopHostProcess(request.runtime.node, projectDir, undefined, false, undefined, request.primaryRuntime)
        await checkDesktopStartupHost(host, controller.signal, (error) => {
          console.error('Desktop preparation is waiting for its health-check Host to stop', error)
          port.postMessage({ type: 'stage', stage: 'cleaning' })
        })
        checkCancellation()
      },
      beforeActivate: async () => {},
      afterActivate: async () => {},
    }, {
      checkpoint(stage) {
        checkCancellation()
        port.postMessage({ type: 'stage', stage })
      },
    })
  } finally {
    port.off('message', cancel)
  }
}

void prepare().then(
  () => { parentPort?.postMessage({ type: 'done' }) },
  (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    parentPort?.postMessage({ type: 'error', message: error.message, stack: error.stack ?? error.message })
  },
).finally(() => { parentPort?.close() })
