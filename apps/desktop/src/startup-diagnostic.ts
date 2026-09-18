/** Persistent diagnostics for Desktop startup and cleanup failures. */

import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Write the latest startup failure without replacing the original startup error.
 * @param error - Startup rejection whose stack or message is recorded.
 * @param desktopRoot - Electron-owned Desktop state directory used by default.
 * @param configuredPath - Optional diagnostic path override.
 * @returns The saved diagnostic path, or undefined after independently reporting a write failure.
 */
export async function writeStartupDiagnostic(
  error: unknown,
  desktopRoot: string,
  configuredPath: string | undefined = process.env.DSH_DESKTOP_DIAGNOSTIC_FILE,
): Promise<string | undefined> {
  const diagnosticFile = configuredPath !== undefined && configuredPath !== ''
    ? configuredPath
    : join(desktopRoot, 'startup-error.log')
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  try {
    await mkdir(dirname(diagnosticFile), { recursive: true, mode: 0o700 })
    await writeFile(diagnosticFile, `${message}\n`, { mode: 0o600 })
    await chmod(diagnosticFile, 0o600)
    return diagnosticFile
  } catch (writeError) {
    console.error('dsh desktop: failed to write startup diagnostic', writeError)
  }
}
