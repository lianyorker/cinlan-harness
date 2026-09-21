/** Shell and directory resolution within a captured Session execution world. */
import { posix } from 'node:path'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type {} from '@deepseek-ai/dsh-fs'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'
import type { DiscoveredTerminalShell } from './terminal-shells.ts'

/** Discover remote POSIX executables through the selected subprocess provider.
 * @param lease - captured Session execution world.
 * @param candidates - deployment-selected shell names or paths.
 * @param signal - operation cancellation.
 * @param preferred - explicit configured shell and arguments; omitted uses the remote default shell.
 * @returns remotely verified choices; no local path or environment lookup occurs.
 */
export async function executionShells(
  lease: ExecutionLease, candidates: readonly string[], signal: AbortSignal,
  preferred?: { shell?: string; shellArgs: readonly string[] },
): Promise<DiscoveredTerminalShell[]> {
  lease.assertCurrent()
  const subprocess = lease.ctx.get('subprocess')
  if (subprocess === undefined) throw new SidebarTerminalError('unavailable', 'The execution world has no subprocess provider.')
  const environment = await subprocess.terminalEnvironment(signal)
  if (environment.platform !== 'posix' || lease.platform === 'win32') {
    throw new SidebarTerminalError('unavailable', 'Remote sidebar terminals require a POSIX execution world.')
  }
  const result = new Map<string, DiscoveredTerminalShell>()
  const preferredPath = preferred?.shell?.trim() ?? ''
  const candidatesToCheck = [
    ...(preferredPath === '' ? [] : [preferredPath]),
    environment.defaultShell ?? '/bin/sh',
    ...candidates,
  ]
  for (const [index, candidate] of candidatesToCheck.entries()) {
    let path: string
    try { path = await subprocess.resolveExecutable(candidate, {}, signal) }
    catch (error) {
      signal.throwIfAborted()
      lease.assertCurrent()
      if (error instanceof SubprocessExecutableNotFoundError) continue
      throw error
    }
    if (!posix.isAbsolute(path)) throw new SidebarTerminalError('invalid-shell', 'Remote executable lookup returned a relative path.')
    if (!result.has(path)) result.set(path, {
      path,
      name: posix.basename(path),
      args: index === 0 && preferred !== undefined ? [...preferred.shellArgs] : ['-l'],
    })
  }
  return [...result.values()]
}

/** Resolve a floating directory with the lease's POSIX filesystem and reject lexical or canonical escapes.
 * @param lease - authoritative remote workspace and paired filesystem.
 * @param requested - captured floating preference.
 * @param signal - operation cancellation.
 * @returns existing canonical remote directory contained by the leased workspace.
 */
export async function executionDirectory(lease: ExecutionLease, requested: string, signal: AbortSignal): Promise<string> {
  const fs = lease.ctx.get('fs')
  if (fs === undefined) throw new SidebarTerminalError('unavailable', 'The execution world has no filesystem provider.')
  const invalid = (): SidebarTerminalError => new SidebarTerminalError('invalid-directory', 'Choose a directory in the remote workspace.')
  const contained = (root: string, path: string): boolean => {
    const relative = posix.relative(root, path)
    return relative === '' || (relative !== '..' && !relative.startsWith('../') && !posix.isAbsolute(relative))
  }
  const path = posix.resolve(lease.cwd, requested)
  if (!contained(lease.cwd, path)) throw invalid()
  const target = await fs.resolve(path, { cwd: lease.cwd, signal })
  const canonical = fs.processPath(target)
  if (!contained(lease.cwd, canonical) || (await fs.stat(target, signal))?.type !== 'directory') throw invalid()
  lease.assertCurrent()
  return canonical
}
