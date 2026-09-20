/** Installed shell discovery for the local node-pty owner; no shell commands are executed. */
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { delimiter, isAbsolute, join, resolve } from 'node:path'
import type { SidebarTerminalShell } from '@deepseek-ai/dsh-sidebar-terminals/types'
import { shellDisplayName, shellSpawnArgs } from './pty-manager.ts'

/** Host-only launch arguments accompany a verified chooser entry. */
export interface DiscoveredTerminalShell extends SidebarTerminalShell {
  readonly args: string[]
}

function executable(candidate: string): string | undefined {
  const extensions = process.platform === 'win32' && !/[.][^/\\]+$/u.test(candidate) ? ['', '.exe'] : ['']
  const directories = isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')
    ? [''] : (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const directory of directories) {
    for (const extension of extensions) {
      const path = resolve(directory === '' ? candidate + extension : join(directory, candidate + extension))
      try {
        if (!statSync(path).isFile()) continue
        accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return realpathSync(path)
      } catch (error) {
        // Missing, inaccessible and non-directory PATH entries are not launchable shells.
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EACCES' && code !== 'EPERM') throw error
      }
    }
  }
  return undefined
}

/**
 * Discover unique executables with the accepted Settings default first when it is installed.
 * @param preferred - resolved Host configuration and user Settings override.
 * @param candidates - deployment-permitted executable names or paths.
 * @returns installed choices; unexpected filesystem failures propagate.
 */
export function discoverTerminalShells(
  preferred: { shell: string; shellArgs: string[] }, candidates: readonly string[],
): DiscoveredTerminalShell[] {
  const choices = new Map<string, DiscoveredTerminalShell>()
  for (const [index, candidate] of [preferred.shell, ...candidates].entries()) {
    const path = executable(candidate)
    if (path === undefined) continue
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (choices.has(key)) continue
    const name = shellDisplayName(path)
    const kind = name.toLowerCase()
    const args = index === 0 ? shellSpawnArgs(preferred.shellArgs)
      : kind === 'pwsh' || kind === 'powershell' ? ['-NoLogo'] : kind === 'cmd' ? [] : ['-l']
    choices.set(key, { path, name, args })
  }
  return [...choices.values()]
}
