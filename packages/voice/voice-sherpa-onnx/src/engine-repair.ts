/**
 * sherpa-onnx-node profile-repair detection, mirroring node-pty's
 * pty-deps.ts in @deepseek-ai/dsh-client-ui-better-sidebar: when the
 * native addon fails to load, the settings page needs a pasteable command
 * that reinstalls the profile this plugin is actually running from, not a
 * generic 'reinstall your dependencies' sentence.
 */

import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Walk up from `dir` looking for a DSH profile root (package.json + pnpm-workspace.yaml). */
function walkUp(dir: string, isRoot: (dir: string) => boolean): string | null {
  let current = dir
  for (let depth = 0; depth < 16; depth += 1) {
    if (isRoot(current)) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

/** Whether `dir` looks like a DSH profile root (the plugin lives under its node_modules). */
function isProfileRoot(dir: string): boolean {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'pnpm-workspace.yaml'))
}

/** Resolve a directory to its physical location (symlinked/link: installs). */
function realDir(file: string): string {
  try {
    return dirname(realpathSync(file))
  } catch {
    return dirname(file)
  }
}

/**
 * Detect the DSH profile directory this plugin is installed into: the
 * nearest ancestor of the plugin module that carries both `package.json`
 * and `pnpm-workspace.yaml` (the profile root; the plugin resolves from
 * the profile's node_modules). Falls back to `$DSH_HOME/profiles/web`
 * (the standard web profile), then null.
 * @param fromFile - the plugin module path to walk up from (defaults to this module's own location).
 * @returns the detected profile root, or null when neither the walk nor the fallback resolves one.
 */
export function findProfileDir(fromFile: string = fileURLToPath(import.meta.url)): string | null {
  const detected = walkUp(realDir(fromFile), isProfileRoot)
  if (detected !== null) return detected
  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  const web = join(home, 'profiles', 'web')
  return isProfileRoot(web) ? realpathSync(web) : null
}

/** Detected profile plus the pasteable repair command and native-build allowlist hint. */
export interface EngineRepairHint {
  /** The detected profile name (null when undetected — the command defaults to 'web'). */
  profile: string | null
  /** The pasteable repair command (terminal/cmd). */
  command: string
  /** Native-build allowlist hint for pnpm's strict-dep-builds. */
  note: string
}

/**
 * Build the repository CLI command and profile setting needed to repair a
 * blocked or broken sherpa-onnx-node native build.
 * @param fromFile - the plugin module path to walk up from (defaults to this module's own location).
 * @returns the detected profile plus its pasteable repair command and allowlist hint.
 */
export function engineRepairHint(fromFile?: string): EngineRepairHint {
  const profileDir = findProfileDir(fromFile)
  const name = profileDir !== null ? basename(profileDir) : 'web'
  return {
    profile: profileDir !== null ? name : null,
    command: `dsh plugin --profile "${name}" install`,
    note: 'If pnpm blocked the sherpa-onnx-node native build scripts, set `allowBuilds: sherpa-onnx-node: true` in the profile pnpm-workspace.yaml before reinstalling.',
  }
}
