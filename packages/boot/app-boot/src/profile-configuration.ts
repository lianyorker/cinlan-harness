/** Serialize profile writes and exact-path configuration watchers on one booted root. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/cordis-plugin-hmr'
import { reconcileProfilePatches } from './index.ts'
import { readProfilePatches, type ProfileContext } from './profile-context.ts'
import { healProfilesModuleFallback, loadProfileDirectory, PROFILE_PATCH_FILENAME, readProfileManifest } from './profile.ts'

interface ConfigurationQueue {
  operations: Promise<unknown>
  readonly executing: AsyncLocalStorage<{ active: boolean }>
  closing: boolean
}

const queues = new WeakMap<Context, ConfigurationQueue>()

/** Serialize a profile configuration operation with its file watchers.
 * @param ctx Context belonging to the booted application.
 * @param operation Work that must finish before another configuration generation starts.
 * @returns The operation result; nested operations and operations after disposal reject.
 */
export function runProfileConfiguration<T>(ctx: Context, operation: () => Promise<T>): Promise<T> {
  const root = ctx.root
  let queue = queues.get(root)
  if (queue === undefined) {
    const created: ConfigurationQueue = {
      operations: Promise.resolve(), executing: new AsyncLocalStorage<{ active: boolean }>(), closing: false,
    }
    root.effect(() => async () => {
      created.closing = true
      if (!created.executing.getStore()?.active) await created.operations
    }, 'app-boot: profile configuration queue')
    queues.set(root, created)
    queue = created
  }
  const owner = queue
  if (owner.executing.getStore()?.active) return Promise.reject(new Error('Profile configuration operations cannot be nested'))
  const apply = async (): Promise<T> => {
    if (owner.closing) throw new Error('Profile configuration is disposed')
    const token = { active: true }
    try { return await owner.executing.run(token, operation) }
    finally { token.active = false }
  }
  const hmr = root.get('hmr')
  const task = hmr === undefined ? owner.operations.then(apply) : hmr.runExclusive(apply)
  // The caller receives the rejection; the queue must still admit the next independent operation.
  if (hmr === undefined) owner.operations = task.catch(() => {})
  return task
}

/** Load current bundle layers and preserve the local resolver's profile package links.
 * @param binName Prefix for configuration diagnostics.
 * @param profile Immutable launch facts.
 * @returns Fresh ordered patches after resolver links are ready.
 */
export async function prepareProfilePatches(binName: string, profile: ProfileContext): Promise<PatchOptions[]> {
  const current = loadProfileDirectory(binName, profile.dir, profile.installAnchor)
  await healProfilesModuleFallback({ installAnchor: profile.installAnchor, profile: current, home: profile.home })
  return readProfilePatches(binName, profile, current)
}

/** Watch both user patch files and the selected bundle list through existing config-only HMR.
 * @param ctx Settled application root with an active HMR service.
 * @param profile Launch facts; startup-only profiles install no watchers.
 * @param binName Prefix for configuration diagnostics.
 * @returns Disposer after all watches are ready and current edits are reconciled; closing awaits pending refreshes.
 */
export async function watchProfilePatches(ctx: Context, profile: ProfileContext, binName = 'dsh'): Promise<() => Promise<void>> {
  if (profile.patchReload !== 'live') return async () => {}
  const hmr = ctx.get('hmr')
  if (hmr === undefined) throw new Error(binName + ': profile watching requires the Cordis HMR service')
  const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)]
  const inputs = (): string => JSON.stringify([
    readProfileManifest(binName, profile.dir).dsh?.profile?.bundles ?? [],
    ...patchFiles.map((filename) => {
      try { return readFileSync(filename, 'utf8') }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }),
  ])
  // Files can change after boot applies them but before the watchers subscribe.
  let previous: string | undefined
  const refresh = () => runProfileConfiguration(ctx, async () => {
    const current = inputs()
    if (previous === current) return
    const warnings = await reconcileProfilePatches(ctx, await prepareProfilePatches(binName, profile), binName)
    previous = current
    for (const diagnostic of warnings) ctx.logger.warn(diagnostic)
  })
  const disposers: Array<() => Promise<void>> = []
  const dispose = async (): Promise<void> => { await Promise.all(disposers.splice(0).map(off => off())) }
  try {
    for (const filename of [...patchFiles, join(profile.dir, 'package.json')]) disposers.push(await hmr.registerConfig(filename, refresh))
    await refresh()
    return dispose
  } catch (error) {
    await dispose()
    throw error
  }
}
