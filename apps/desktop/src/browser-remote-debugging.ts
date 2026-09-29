/**
 * Chrome DevTools Protocol remote debugging port resolution for Electron Desktop.
 * @module @deepseek-ai/dsh-desktop/browser-remote-debugging
 */

/**
 * Resolve the configured Chrome DevTools Protocol remote debugging port for Electron Desktop.
 * Reads `DSH_DESKTOP_RENDERER_DEBUG_PORT`, `DSH_DESKTOP_CDP_PORT`, or `CINLAN_DESKTOP_CDP_PORT`.
 * @param env - process environment map to read.
 * @returns validated TCP port number (1024-65535) or undefined if unconfigured.
 */
export function desktopRemoteDebuggingPort(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const configured = env.DSH_DESKTOP_RENDERER_DEBUG_PORT
    ?? env.DSH_DESKTOP_CDP_PORT
    ?? env.CINLAN_DESKTOP_CDP_PORT
  if (configured === undefined || configured === '') return undefined
  const port = Number(configured)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('dsh desktop: DSH_DESKTOP_RENDERER_DEBUG_PORT must be an integer between 1024 and 65535')
  }
  return port
}
