/**
 * Background-job routes of the /sidebar JSON API ('jobs.output' / 'jobs.kill').
 * The job list arrives through the harness's session/jobs push mirror. Output
 * reads use the registry's independent retained snapshot, so the browser never
 * advances the model-facing job_output cursor.
 */
import type { Context } from './context-types.ts'
import { boundBytes } from './tools.ts'
import { requireString, SidebarError } from './wire.ts'

/** The two background-job routes of the sidebar API. */
export interface SidebarJobsRoutes {
  /** Retained output produced so far, bounded for one response. */
  output(payload: unknown): { text: string; truncated: boolean }
  /** Request cancellation of one job (live jobs flip to stopping). */
  kill(payload: unknown): { ok: true; outcome: 'requested' | 'already-finished' }
}

/**
 * Build jobs routes bound to the plugin context. Both operations use the exact
 * live owner Agent for registry authorization; unknown and foreign ids share
 * the same outward error.
 * @param ctx - host plugin context.
 * @param outputLimit - UTF-8 byte cap for one output response.
 * @returns the background-job route handlers.
 */
export function buildJobsApi(ctx: Context, outputLimit: number): SidebarJobsRoutes {
  const jobs = ctx.get('jobs')
  const agents = ctx.get('agents')
  /** The live caller whose session id the registry fence compares against. */
  const callerOf = (sessionId: string) => agents?.get(sessionId)
  /** Registry refusals become a 404 job-error; unknown and foreign ids are indistinguishable. */
  const registryError = (error: unknown): SidebarError =>
    new SidebarError('job-error', error instanceof Error ? error.message : String(error), 404)
  /** Fail consistently when this deployment has no background-job registry. */
  const requireJobs = () => {
    if (jobs === undefined) {
      throw new SidebarError('job-error', 'the background-job registry is not mounted in this deployment', 503)
    }
    return jobs
  }

  return {
    output(payload) {
      const registry = requireJobs()
      const sessionId = requireString(payload, 'sessionId')
      const id = requireString(payload, 'id')
      try {
        const observed = registry.peekOutput(id, callerOf(sessionId))
        const bounded = boundBytes(observed.text, outputLimit)
        return {
          text: bounded.text,
          truncated: observed.truncated || bounded.truncated,
        }
      } catch (error) {
        throw registryError(error)
      }
    },
    kill(payload) {
      const registry = requireJobs()
      const sessionId = requireString(payload, 'sessionId')
      const id = requireString(payload, 'id')
      const record = payload as { reason?: unknown } | null
      const reason = typeof record?.reason === 'string' && record.reason !== ''
        ? record.reason
        : 'user requested via sidebar'
      try {
        return { ok: true, outcome: registry.kill(id, callerOf(sessionId), reason) }
      } catch (error) {
        throw registryError(error)
      }
    },
  }
}
