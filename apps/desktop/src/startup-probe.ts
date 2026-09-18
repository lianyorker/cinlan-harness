/** A staged Host health check retains its transaction until its child has fully stopped. */

import type { DesktopHostProcess } from './host-process.ts'

/**
 * Check a staged Host and join its cleanup even after a stop timeout or cancellation.
 * @param host - Newly created Host owned only by this check.
 * @param signal - Cancellation stops pending readiness and still awaits cleanup.
 * @param retrying - Reports a failed stop attempt while the transaction remains held.
 * @returns After readiness and child closure; rejects readiness or cancellation only after closure.
 */
export async function checkDesktopStartupHost(
  host: Pick<DesktopHostProcess, 'start' | 'stop'>,
  signal: AbortSignal,
  retrying: (error: unknown) => void,
): Promise<void> {
  let cleanup: Promise<void> | undefined
  const stop = (): Promise<void> => {
    cleanup ??= (async () => {
      for (;;) {
        try {
          await host.stop()
          return
        } catch (error) {
          try { retrying(error) } catch (reportError) {
            console.error('Desktop startup cleanup notification failed', reportError)
          }
          // Pace repeated failures, including ones that reject before the Host's exit timeout.
          await new Promise<void>((resolve) => { setTimeout(resolve, 250) })
        }
      }
    })()
    return cleanup
  }
  const cancel = (): void => { void stop() }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    await host.start()
  } finally {
    await stop()
    signal.removeEventListener('abort', cancel)
  }
  signal.throwIfAborted()
}
