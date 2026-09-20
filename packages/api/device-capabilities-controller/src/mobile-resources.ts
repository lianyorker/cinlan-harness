/** Local authenticated human access to Android resource and mirror management. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type MobileRuntimeManager from '@deepseek-ai/dsh-mobile-device-runtime'
/** Resolve the resource manager only for explicit trusted-local Gateway callers.
 * @param ctx - Controller context with optional native resource manager.
 * @returns Local manager; delegated or absent authority fails before execution.
 */
export function localMobileRuntime(ctx: Context): MobileRuntimeManager {
  const access = ctx.get('typertGateway')?.currentAccess()
  if (access?.kind !== 'trusted-local' || access.signal.aborted) throw new Error('Mobile runtime management requires an authenticated local request')
  const runtime = ctx.get('mobileRuntime')
  if (!runtime) throw new Error('Native mobile runtime manager is unavailable')
  return runtime
}
