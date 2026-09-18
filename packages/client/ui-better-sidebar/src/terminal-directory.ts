/** Host resolution of a floating terminal's directory inside its authoritative Session workspace. */
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { SidebarTerminalError } from '@deepseek-ai/dsh-sidebar-terminals'

/**
 * Resolve an existing directory; lexical traversal and canonical escapes are rejected.
 * @param workspace - authoritative Session header cwd.
 * @param requested - captured floating preference, empty for the workspace root.
 * @returns canonical directory inside the canonical workspace.
 */
export async function floatingTerminalDirectory(workspace: string | undefined, requested: string): Promise<string> {
  const invalid = (): SidebarTerminalError => new SidebarTerminalError('invalid-directory', 'Choose an existing directory inside this session workspace.')
  if (workspace === undefined || workspace === '' || !isAbsolute(workspace)) throw invalid()
  if (requested.split(/[\\/]/u).includes('..')) throw invalid()
  try {
    const root = await realpath(workspace)
    const candidate = await realpath(resolve(root, requested))
    const child = relative(root, candidate)
    if (isAbsolute(child) || child === '..' || child.startsWith('..' + sep)) throw invalid()
    if (!(await stat(candidate)).isDirectory()) throw invalid()
    return candidate
  } catch (error) {
    if (error instanceof SidebarTerminalError) throw error
    throw invalid()
  }
}
