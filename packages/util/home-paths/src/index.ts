/**
 * Shared filesystem path helpers for Cinlan Harness user data.
 *
 * @module @deepseek-ai/dsh-home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default Cinlan Harness home under the OS home. */
export const CLH_HOME_DIR_NAME = '.clh'
/** Legacy alias for compatibility. */
export const DSH_HOME_DIR_NAME = CLH_HOME_DIR_NAME

/** Stable user-facing display form for the default Cinlan Harness home. */
export const DEFAULT_CLH_HOME_DISPLAY = `~/${CLH_HOME_DIR_NAME}`
/** Legacy alias for compatibility. */
export const DEFAULT_DSH_HOME_DISPLAY = DEFAULT_CLH_HOME_DISPLAY

/** Primary environment variable that overrides the default Cinlan Harness home. */
export const CLH_HOME_ENV = 'CLH_HOME'
/** Alias environment variable for the Cinlan Harness home. */
export const CINLAN_HARNESS_HOME_ENV = 'CINLAN_HARNESS_HOME'
/** Legacy environment variable that overrides the default Harness home. */
export const DSH_HOME_ENV = 'DSH_HOME'

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default Cinlan Harness home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultClhHome(): string {
  return join(homedir(), CLH_HOME_DIR_NAME)
}

/** Legacy alias for defaultClhHome. */
export const defaultDshHome = defaultClhHome

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root Cinlan Harness home.
 *
 * Precedence, highest first: an explicit configured path, `$CLH_HOME`,
 * `$CINLAN_HARNESS_HOME`, `$DSH_HOME`, then `~/.clh`. The harness keeps all user
 * data under one root. An empty or whitespace-only variable is treated as unset,
 * so a blank override never resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read home variables.
 * @returns the normalized absolute harness home path.
 */
export function resolveClhHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const clhEnv = env[CLH_HOME_ENV]?.trim()
  const cinlanEnv = env[CINLAN_HARNESS_HOME_ENV]?.trim()
  const dshEnv = env[DSH_HOME_ENV]?.trim()
  const fromEnv = (clhEnv !== undefined && clhEnv.length > 0)
    ? clhEnv
    : (cinlanEnv !== undefined && cinlanEnv.length > 0)
      ? cinlanEnv
      : (dshEnv !== undefined && dshEnv.length > 0)
        ? dshEnv
        : undefined
  const selected = configured ?? fromEnv ?? defaultClhHome()
  return resolve(expandHomePath(selected))
}

/** Legacy alias for resolveClhHome. */
export const resolveDshHome = resolveClhHome

/**
 * Join path segments onto the resolved Cinlan Harness home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function clhHomePath(...segments: string[]): string {
  return join(resolveClhHome(), ...segments)
}

/** Legacy alias for clhHomePath. */
export const dshHomePath = clhHomePath

/**
 * Join path segments onto the resolved Harness home's `cache` directory without creating it; no arguments returns the directory itself.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function clhCachePath(optionsOrSegment: { clhHome?: string; dshHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return clhHomePath('cache', optionsOrSegment, ...segments)
  const homeOverride = optionsOrSegment.clhHome ?? optionsOrSegment.dshHome
  return join(resolveClhHome(homeOverride), 'cache', ...segments)
}

/** Legacy alias for clhCachePath. */
export const dshCachePath = clhCachePath

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.clh`, and any configured home is labelled `$CLH_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveClhHome}.
 * @returns `~/.clh` for the default home, otherwise `$CLH_HOME`.
 */
export function clhHomeDisplay(resolvedHome: string): string {
  return resolvedHome === resolve(defaultClhHome()) ? DEFAULT_CLH_HOME_DISPLAY : `$${CLH_HOME_ENV}`
}

/** Legacy alias for clhHomeDisplay. */
export const dshHomeDisplay = clhHomeDisplay
