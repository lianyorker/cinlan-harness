/** Local authenticated human access to Android resource and mirror management. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type MobileRuntimeManager from '@deepseek-ai/dsh-mobile-device-runtime'
/** Resolve the resource manager only for authenticated operator Remote calls.
 * @param ctx - Controller context with optional native resource manager.
 * @returns Local manager; other Peers, cancelled calls, and absent invocation fail before execution.
 */
export function localMobileRuntime(ctx: Context): MobileRuntimeManager {
  const invocation = ctx.invocation
  const operator = ctx.get('connection')?.operator
  if (invocation === undefined || operator === undefined || invocation.peer !== operator || invocation.signal.aborted) {
    throw new Error('Mobile runtime management requires an authenticated local request')
  }
  const runtime = ctx.get('mobileRuntime')
  if (!runtime) throw new Error('Native mobile runtime manager is unavailable')
  return runtime
}
