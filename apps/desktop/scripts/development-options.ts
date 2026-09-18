/** Filesystem and debugger options for the supported desktop development launcher. */
import { join, resolve } from 'node:path'

/** Per-launch locations and debugger port selections. */
export interface DevelopmentOptions {
  readonly projectDir: string
  readonly home: string
  readonly userData: string
  readonly mainPort: number
  readonly rendererPort: number
  readonly hostPort: number | undefined
}

function debugPort(environment: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = environment[name]
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`desktop development: ${name} must be an integer from 0 through 65535`)
  }
  return port
}

/**
 * Resolve isolated development locations without creating or changing files.
 * @param appRoot - Absolute desktop application directory.
 * @param environment - Launcher environment; an explicit DSH_HOME overrides only Harness state.
 * @returns Paths and ports; zero assigns main/renderer ports automatically and disables the host inspector.
 */
export function resolveDevelopmentOptions(appRoot: string, environment: NodeJS.ProcessEnv): DevelopmentOptions {
  const root = resolve(environment.DSH_DESKTOP_DEVELOPMENT_ROOT ?? join(appRoot, '.desktop-build', 'development'))
  const hostPort = debugPort(environment, 'DSH_DESKTOP_HOST_INSPECT_PORT', 9230)
  return {
    projectDir: join(root, 'project'),
    home: resolve(environment.DSH_HOME ?? join(root, 'home')),
    userData: join(root, 'electron-user-data'),
    mainPort: debugPort(environment, 'DSH_DESKTOP_MAIN_INSPECT_PORT', 9229),
    rendererPort: debugPort(environment, 'DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222),
    hostPort: hostPort === 0 ? undefined : hostPort,
  }
}
