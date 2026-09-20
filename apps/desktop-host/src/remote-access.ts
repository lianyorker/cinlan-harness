/** Desktop lifecycle adapter for the separately authenticated paired-device carrier. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-remote-access'
import type { RemoteAccessHost } from '@deepseek-ai/dsh-remote-access/types'
import type { DesktopUpdateTaskControl } from './update-tasks.ts'

/**
 * Publish paired-carrier admission and its restricted assets for this Host lifetime.
 * Authentication and Session authorization remain with the Remote Access provider.
 * @param ctx - Desktop Host context owning the capability registration.
 * @param control - the same update-admission owner used by local pipe requests.
 * @param fetchAssets - paired-shell asset reader, independent of local index injection.
 */
export function installDesktopRemoteAccessHost(
  ctx: Context,
  control: DesktopUpdateTaskControl,
  fetchAssets: RemoteAccessHost['fetchAssets'],
): void {
  ctx.provide('remoteAccessHost', {
    dispatch: operation => control.admit(operation),
    fetchAssets,
  } satisfies RemoteAccessHost)
}
