/** Session-owned file operations over one retained execution world. */
import { posix, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GitError } from '@deepseek-ai/dsh-git'
import { FsError, type FileSystem, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { SidebarFsEntry, SidebarFsListing } from './fs-tree.ts'
import { compareEntries } from './fs-tree.ts'
import type { FsSearchResult } from './fs-search.ts'
import { SidebarError } from './wire.ts'

/** Resolve only the filesystem isolated in the captured lease.
 * @param lease - retained execution ownership.
 * @returns the filesystem from that execution environment.
 */
export function executionFileSystem(lease: ExecutionLease): FileSystem {
  const fs = lease.ctx.get('fs')
  if (fs === undefined) throw new SidebarError('unavailable', 'The captured execution filesystem is unavailable', 503)
  return fs
}

/** Path syntax belongs to the captured execution platform.
 * @param lease - retained execution ownership.
 * @returns the corresponding Windows or POSIX path implementation.
 */
export function executionPaths(lease: ExecutionLease): typeof posix {
  return lease.platform === 'win32' ? win32 : posix
}

/** Capture one Session world and retain it until the complete operation settles.
 * @param ctx - binding service owner.
 * @param sessionId - Session owning the requested files.
 * @param signal - caller cancellation.
 * @param operation - complete operation, including streams and writes.
 * @returns the result after currentness checks and lease cleanup.
 */
export async function withSessionFiles<T>(
  ctx: Context, sessionId: string, signal: AbortSignal | undefined,
  operation: (lease: ExecutionLease, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const bindings = ctx.get('executionBindings')
  if (bindings === undefined) throw new SidebarError('unavailable', 'Execution bindings are not available', 503)
  const lease = await bindings.forSession(sessionId as SessionId, signal)
  try {
    lease.assertCurrent()
    const bound = AbortSignal.any([lease.signal, ...(signal === undefined ? [] : [signal])])
    bound.throwIfAborted()
    const value = await operation(lease, bound)
    bound.throwIfAborted()
    lease.assertCurrent()
    return value
  } finally { await lease.release() }
}

/** Resolve an absolute path with the provider and confine SSH targets to the Session directory.
 * @param lease - retained execution ownership.
 * @param path - absolute execution path.
 * @param signal - combined caller and lease cancellation.
 * @param confined - require canonical containment in the Session directory; defaults to true for SSH leases.
 * @returns the provider-owned target.
 */
export async function executionTarget(
  lease: ExecutionLease, path: string, signal: AbortSignal, confined = lease.binding.kind === 'ssh',
): Promise<FsTarget> {
  if (path.includes('\0') || !executionPaths(lease).isAbsolute(path)) {
    throw new SidebarError('bad-request', 'An absolute execution path is required')
  }
  const fs = executionFileSystem(lease)
  const target = await fs.resolve(path, { cwd: lease.cwd, signal })
  if (confined && !fs.contains(await fs.resolve(lease.cwd, { signal }), target)) {
    throw new SidebarError('forbidden', 'Path is outside the Session working directory', 403)
  }
  return target
}

/** List provider-owned children with bounded displayed rows and explicit symlink facts.
 * @param lease - retained execution ownership.
 * @param path - absolute directory path.
 * @param limit - maximum displayed entries.
 * @param signal - combined cancellation.
 * @returns sorted entries and truncation state.
 */
export async function executionListing(
  lease: ExecutionLease, path: string, limit: number, signal: AbortSignal,
): Promise<SidebarFsListing> {
  const fs = executionFileSystem(lease)
  const target = await executionTarget(lease, path, signal)
  const directory = fs.processPath(target)
  const entries = await fs.listDir(target, signal)
  const rows: SidebarFsEntry[] = []
  for (const entry of entries.slice(0, limit)) {
    const child = executionPaths(lease).join(directory, entry.name)
    const link = await fs.lstat(child, { cwd: lease.cwd }, signal)
    rows.push({ name: entry.name, path: child, isDir: entry.type === 'directory',
      hidden: entry.name.startsWith('.'), isSymlink: link?.type === 'symlink',
      broken: link?.type === 'symlink' && await fs.stat(entry.target, signal) === undefined })
  }
  return { path: directory, entries: rows.sort(compareEntries), truncated: entries.length > limit }
}

/** Search names without traversing symbolic links or canonical targets outside the workspace.
 * @param lease - retained execution ownership.
 * @param query - case-insensitive filename fragment.
 * @param signal - combined cancellation.
 * @returns relative matches with traversal truncation state.
 */
export async function executionSearch(lease: ExecutionLease, query: string, signal: AbortSignal): Promise<FsSearchResult> {
  const needle = query.trim().toLowerCase()
  if (!needle) return { matches: [], truncated: false }
  const fs = executionFileSystem(lease)
  const paths = executionPaths(lease)
  const root = await fs.resolve(lease.cwd, { signal })
  const matches: string[] = []
  let visited = 0
  let truncated = false
  const walk = async (directory: FsTarget, relative: string): Promise<void> => {
    let entries
    try { entries = await fs.listDir(directory, signal) }
    catch (error) {
      if (error instanceof FsError && error.code === 'FS_PERMISSION_DENIED') return
      throw error
    }
    for (const entry of entries) {
      signal.throwIfAborted()
      if (++visited > 100_000) { truncated = true; return }
      if (entry.type === 'directory' && entry.name === '.git') continue
      const child = relative ? relative + '/' + entry.name : entry.name
      if (entry.name.toLowerCase().includes(needle)) {
        matches.push(child)
        if (matches.length >= 200) { truncated = true; return }
      }
      if (entry.type !== 'directory' || !fs.contains(root, entry.target)) continue
      const link = await fs.lstat(paths.join(fs.processPath(directory), entry.name), { cwd: lease.cwd }, signal)
      if (link?.type === 'symlink') continue
      await walk(entry.target, child)
      if (truncated) return
    }
  }
  await walk(root, '')
  return { matches: matches.sort(), truncated }
}

/** Read a bounded text/binary preview, resolving Git-relative names in the same world.
 * @param lease - retained execution ownership.
 * @param raw - absolute path or name relative to the owning Git repository.
 * @param limit - maximum preview bytes.
 * @param signal - combined cancellation.
 * @returns text or binary preview metadata and truncation state.
 */
export async function executionRead(lease: ExecutionLease, raw: string, limit: number, signal: AbortSignal) {
  const fs = executionFileSystem(lease)
  let path = raw
  if (!executionPaths(lease).isAbsolute(raw)) {
    let root = lease.cwd
    const git = lease.ctx.get('git')
    if (git === undefined) throw new SidebarError('unavailable', 'The captured Git provider is unavailable', 503)
    try { root = (await git.resolveRepository({ path: lease.cwd, signal })).root }
    catch (error) { if (!(error instanceof GitError) || error.code !== 'NOT_REPOSITORY') throw error }
    path = executionPaths(lease).resolve(root, raw)
  }
  const target = await executionTarget(lease, path, signal)
  const info = await fs.stat(target, signal)
  if (info?.type !== 'file') throw new SidebarError('fs-error', 'Not a regular file')
  const bytes = await fs.readByteRange(target, { offset: 0, length: limit + 1 }, signal)
  const truncated = bytes.length > limit || (info.size !== undefined && info.size > limit)
  const content = Buffer.from(bytes.subarray(0, limit))
  if (content.includes(0)) return { kind: 'binary' as const, size: info.size ?? bytes.length, truncated,
    head: content.subarray(0, 4096).toString('base64') }
  return { kind: 'text' as const, content: content.toString('utf8'), truncated }
}
