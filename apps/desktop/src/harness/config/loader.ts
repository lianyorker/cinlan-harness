/** Configuration loader with three-level priority: project > user > global */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { HarnessConfig, PartialHarnessConfig } from './types.ts'
import { DEFAULT_CONFIG } from './types.ts'
import { mergeConfigs } from './merger.ts'

/**
 * Resolve configuration file paths without checking whether they exist.
 * @param projectPath - project directory; omitted to skip project configuration.
 * @returns global, user, and optional project configuration paths.
 */
export function resolveConfigPaths(projectPath?: string): {
  global: string
  user: string
  project: string | undefined
} {
  const globalConfig = process.platform === 'win32'
    ? join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'cinlan-harness', 'config.json')
    : '/etc/cinlan-harness/config.json'

  const userConfig = join(homedir(), '.cinlan', 'config.json')
  const projectConfig = projectPath ? join(projectPath, '.harness', 'config.json') : undefined

  return { global: globalConfig, user: userConfig, project: projectConfig }
}

/** Load configuration from a single file, returns empty object if file doesn't exist */
async function loadConfigFile(path: string): Promise<PartialHarnessConfig> {
  try {
    const content = await readFile(path, 'utf-8')
    const config: unknown = JSON.parse(content)
    return resolveEnvVars(config) as PartialHarnessConfig
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw new Error(`Failed to load config from ${path}: ${(error as Error).message}`)
  }
}

/** Expand environment references in JSON strings, including nested objects and arrays. */
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_: string, envVar: string) => process.env[envVar] ?? '')
  }
  if (Array.isArray(value)) {
    return value.map(resolveEnvVars)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]: [string, unknown]) => [key, resolveEnvVars(entry)]),
    )
  }
  return value
}

/**
 * Load configuration with project > user > global > defaults precedence.
 * Missing files are skipped; unset environment references expand to empty strings.
 * @param projectPath - project directory; omitted to skip project configuration.
 * @returns complete configuration with defaults for omitted fields.
 * @throws Error when an existing configuration file cannot be read or parsed.
 */
export async function loadHarnessConfig(projectPath?: string): Promise<HarnessConfig> {
  const paths = resolveConfigPaths(projectPath)

  const [globalConfig, userConfig, projectConfig] = await Promise.all([
    loadConfigFile(paths.global),
    loadConfigFile(paths.user),
    paths.project ? loadConfigFile(paths.project) : Promise.resolve({}),
  ])

  const merged = mergeConfigs(
    DEFAULT_CONFIG,
    globalConfig,
    userConfig,
    projectConfig,
  )

  return merged
}
