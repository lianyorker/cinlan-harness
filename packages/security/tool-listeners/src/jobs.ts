/**
 * Generic-job adaptation for subprocess listener handles: the pull sources the
 * registry pumps, and the hooks mapping a listener subprocess onto the job
 * lifecycle. Mirrors the bash tool's background adapter for the subprocess
 * spawn API.
 *
 * @module @cinlan/tool-listeners/jobs
 */

import type { SubprocessHandle, SubprocessOutcome } from '@deepseek-ai/dsh-subprocess'
import type { JobHooks, JobOutcome, JobOutputSource, JobSourceRead } from '@deepseek-ai/dsh-jobs'

/**
 * The handle's collected streams as registry pull sources. They bind lazily
 * because the subprocess is spawned inside the starter, after the registry
 * admitted the job; a read before the spawn yields nothing, and the pump
 * keeps the model's consuming cursor untouched.
 * @param handle - the spawned listener's handle, once the starter has spawned it.
 * @returns one source per stream, stdout first.
 */
export function collectedSources(handle: () => SubprocessHandle | undefined): JobOutputSource[] {
  const source = (channel: 'stdout' | 'stderr'): JobOutputSource => ({
    channel,
    read: (fromByte: number): JobSourceRead => {
      const live = handle()
      if (live === undefined) return { text: '', nextOffset: fromByte, lossy: false }
      const stream = live.collected[channel]
      if (stream === undefined) return { text: '', nextOffset: fromByte, lossy: false }
      return stream.readFrom(fromByte)
    },
  })
  return [source('stdout'), source('stderr')]
}

/**
 * Map a settled listener subprocess onto the generic job-outcome vocabulary:
 * a signal kill (the listen window expiring, a job_kill) is `killed`; a
 * normal listener exit is `completed` with the exit code as detail. Listener
 * exit codes are reported, not failed — a poisoning session that captured
 * nothing and was stopped still completed as a session.
 * @param outcome - settled subprocess facts.
 * @returns the outcome for the `ctx.jobs` registration.
 */
export function listenerOutcome(outcome: SubprocessOutcome): JobOutcome {
  if (outcome.exitCode === null) {
    return outcome.signal !== null
      ? { status: 'killed', detail: `signal: ${String(outcome.signal)}` }
      : { status: 'killed', detail: 'killed before exit' }
  }
  return { status: 'completed', detail: `exit code: ${outcome.exitCode}` }
}

/**
 * Adapt asynchronous listener spawning after job admission without exposing a
 * partial handle. Cancellation aborts the spawn signal and terminates a live
 * handle; the completion awaits the managed range so captured output remains
 * readable after settlement.
 * @param start - spawns the listener with job-owned cancellation.
 * @returns synchronous job hooks whose completion includes spawn and settlement.
 */
export function subprocessJob(start: (signal: AbortSignal) => Promise<SubprocessHandle>): JobHooks {
  const controller = new AbortController()
  let handle: SubprocessHandle | undefined
  const done: Promise<JobOutcome> = (async () => {
    try {
      handle = await start(controller.signal)
      try {
        if (controller.signal.aborted) handle.terminate()
      } finally {
        const outcome = await handle.done
        return listenerOutcome(outcome)
      }
    } catch (error: unknown) {
      return {
        status: controller.signal.aborted && handle === undefined ? 'killed' : 'failed',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  })()
  return {
    cancel: () => {
      if (controller.signal.aborted) return
      controller.abort()
      handle?.terminate()
    },
    done,
  }
}
