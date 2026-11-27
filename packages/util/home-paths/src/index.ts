/**
 * Shared filesystem path helpers for Cinlan Harness user data.
 *
 * Cinlan Harness (`clh`) is a distinct product from the official DeepSeek
 * Harness (`dsh`) and keeps its own root, environment variables and
 * identifiers. Nothing here reads or falls back to the official harness root.
 * The `dsh`-named exports remain as deprecated aliases so upstream-shaped call
 * sites keep compiling while every lookup lands on the Cinlan Harness home.
 *
 * @module @deepseek-ai/dsh-home-paths
 */

import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default Cinlan Harness home under the OS home. */
export const CLH_HOME_DIR_NAME = '.clh'

/** @deprecated Cinlan Harness home uses `.clh`; kept for upstream-shaped call sites. */
export const DSH_HOME_DIR_NAME = CLH_HOME_DIR_NAME

/** Stable user-facing display form for the default Cinlan Harness home. */
export const DEFAULT_CLH_HOME_DISPLAY = `~/${CLH_HOME_DIR_NAME}`

/** @deprecated Use {@link DEFAULT_CLH_HOME_DISPLAY}. */
export const DEFAULT_DSH_HOME_DISPLAY = DEFAULT_CLH_HOME_DISPLAY

/** Primary environment variable that overrides the default Cinlan Harness home. */
export const CLH_HOME_ENV = 'CLH_HOME'

/** Secondary environment variable that overrides the default Cinlan Harness home. */
export const CINLAN_HARNESS_HOME_ENV = 'CINLAN_HARNESS_HOME'

/**
 * The official DeepSeek Harness home variable.
 *
 * Exported so consumers keep the official product's name clear of the managed
 * namespace; {@link resolveClhHome} never reads it. The same literal still
 * keys the harness home inside tool child-process environments — the `DSH_*`
 * managed-facts contract shared with upstream — so tools spawned by Cinlan
 * Harness see this product's resolved root there, and an official `dsh`
 * process launched under one stays consistent with its own contract.
 */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Directory name for the default shared agent configuration root under the OS home. */
export const AGENTS_HOME_DIR_NAME = '.agents'

/** Stable user-facing display form for the default shared agent configuration root. */
export const DEFAULT_AGENTS_HOME_DISPLAY = `~/${AGENTS_HOME_DIR_NAME}`

/** Environment variable that overrides the default shared agent configuration root. */
export const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

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

/** @deprecated Use {@link defaultClhHome}. */
export const defaultDshHome = defaultClhHome

/**
 * Resolve the default shared agent configuration root using Node's platform path rules.
 * @returns the absolute default shared agent configuration root.
 */
export function defaultAgentsHome(): string {
  return join(homedir(), AGENTS_HOME_DIR_NAME)
}

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
 * Resolve one user-data root from an explicit path, an environment override, and a default.
 * @param configured - explicit path, which has highest precedence.
 * @param env - environment mapping to read.
 * @param envName - environment variable that overrides the default.
 * @param fallback - default root, used when neither the explicit path nor the environment provides one.
 * @returns the normalized absolute root.
 */
function resolveRoot(
  configured: string | undefined,
  env: Record<string, string | undefined>,
  envName: string,
  fallback: () => string,
): string {
  const fromEnv = env[envName]
  const selected = configured ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : fallback())
  return resolve(expandHomePath(selected))
}

/**
 * Label one resolved user-data root symbolically for user-facing display.
 * @param resolvedRoot - absolute path returned by the matching resolver.
 * @param defaultRoot - absolute default root whose symbolic label applies to a match.
 * @param defaultLabel - symbolic label for the default root.
 * @param envName - environment variable name that labels any other root.
 * @returns the symbolic label.
 */
function rootDisplay(resolvedRoot: string, defaultRoot: string, defaultLabel: string, envName: string): string {
  return resolvedRoot === resolve(defaultRoot) ? defaultLabel : `$${envName}`
}

/**
 * Resolve the single-root Cinlan Harness home.
 *
 * Precedence, highest first: an explicit configured path, `$CLH_HOME`,
 * `$CINLAN_HARNESS_HOME`, then `~/.clh`. The harness keeps all user data under
 * one root. Empty or whitespace-only variables are treated as unset, so a
 * blank override never resolves the home to the current working directory.
 *
 * `$DSH_HOME` is deliberately not consulted. A machine that also runs the
 * official DeepSeek Harness keeps `~/.dsh` and its own `DSH_HOME`; sharing
 * them would let either product read or clean the other's sessions,
 * credentials and caches, so Cinlan Harness never inherits that root.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read the home variables.
 * @returns the normalized absolute harness home path.
 */
export function resolveClhHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const override = [CLH_HOME_ENV, CINLAN_HARNESS_HOME_ENV]
    .map(name => env[name]?.trim())
    .find(value => value !== undefined && value.length > 0)
  return resolve(expandHomePath(configured ?? override ?? defaultClhHome()))
}

/** @deprecated Use {@link resolveClhHome}. */
export const resolveDshHome = resolveClhHome

/**
 * Resolve the shared agent configuration root.
 *
 * Precedence, highest first: an explicit configured path, `$DSH_AGENTS_HOME`,
 * then `~/.agents`. The root holds configuration shared with other agent tools,
 * so it stays independent of the DeepSeek Harness home. An empty or
 * whitespace-only `$DSH_AGENTS_HOME` is treated as unset, so a blank override
 * never resolves the root to the current working directory.
 * @param configured - explicit shared-root override, which has highest precedence.
 * @param env - environment mapping used to read `DSH_AGENTS_HOME`.
 * @returns the normalized absolute shared agent configuration root.
 */
export function resolveAgentsHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  return resolveRoot(configured, env, AGENTS_HOME_ENV, defaultAgentsHome)
}

/**
 * Join path segments onto the resolved Cinlan Harness home. It addresses the
 * existing top-level entries; a new path uses {@link dshPath} with its category.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function clhHomePath(...segments: string[]): string {
  return join(resolveClhHome(), ...segments)
}

/** @deprecated Use {@link clhHomePath}. */
export const dshHomePath = clhHomePath

/**
 * Join path segments onto the resolved Harness home's `cache` directory without creating it; no arguments returns the directory itself.
 * @param optionsOrSegment - explicit home override, or the first path segment; omission uses the default home resolution.
 * @param segments - additional path segments after the first child, if any.
 * @returns the normalized absolute cache path.
 */
export function clhCachePath(optionsOrSegment: { clhHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return dshPath('cache', optionsOrSegment, ...segments)
  return dshPath({ category: 'cache', clhHome: optionsOrSegment.clhHome }, ...segments)
}

/**
 * @deprecated Use {@link clhCachePath}.
 * `dshHome` remains accepted so upstream-shaped call sites keep compiling.
 */
export function dshCachePath(optionsOrSegment: { clhHome?: string; dshHome?: string } | string = {}, ...segments: string[]): string {
  if (typeof optionsOrSegment === 'string') return dshPath('cache', optionsOrSegment, ...segments)
  return dshPath({ category: 'cache', clhHome: optionsOrSegment.clhHome ?? optionsOrSegment.dshHome }, ...segments)
}

/**
 * Category directory under the Harness home, named after the XDG Base Directory
 * kinds. A new file kept under `$DSH_HOME` belongs to exactly one category, and
 * the category directory name equals the category. Existing top-level entries,
 * such as `sessions/`, `profiles/`, and `.credentials.yaml`, keep their current
 * locations; the [home path categories proposal](../../../../.agents/notes/proposed/architecture/2026-11-04-dsh-home-path-categories.md)
 * lists every path and its category:
 *
 * - `config`: files a person writes or edits to configure the harness.
 * - `data`: durable records whose loss loses user work, sign-ins, or installed
 *   software, such as Sessions, profiles, attachments, credentials, and runtimes.
 * - `state`: records that persist across runs but whose loss only resets
 *   history or derived indexes, such as logs, upload indexes, and ids.
 * - `cache`: content that can be rebuilt or downloaded again.
 * - `backup`: backup archives the harness writes; deleting them never affects
 *   a running harness or the records they copy.
 */
export type DshHomeCategory = 'config' | 'data' | 'state' | 'cache' | 'backup'

/** A category directory under an explicitly configured Harness home. */
export interface DshPathLocation {
  /** Category directory to join under. */
  category: DshHomeCategory
  /** Explicit harness-home override, resolved by {@link resolveClhHome}; omission uses `$CLH_HOME`, then `~/.clh`. */
  clhHome?: string | undefined
  /** @deprecated Use {@link DshPathLocation.clhHome}; kept for upstream-shaped call sites. */
  dshHome?: string | undefined
}

/**
 * Join path segments onto one category directory of the Harness home without
 * creating it. An owner passes its own directory name, normally its package
 * name without the `@deepseek-ai/dsh-` prefix, as the first segment.
 * @param location - category under the resolved home, or a category with an explicit home override.
 * @param segments - path segments appended to the category directory; an empty list returns the directory itself.
 * @returns the normalized absolute path.
 */
export function dshPath(location: DshHomeCategory | DshPathLocation, ...segments: string[]): string {
  const { category, clhHome, dshHome } = typeof location === 'string' ? { category: location, clhHome: undefined, dshHome: undefined } : location
  return join(resolveClhHome(clhHome ?? dshHome), category, ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.clh`, and any configured home is labelled `$CLH_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveClhHome}.
 * @returns `~/.clh` for the default home, otherwise `$CLH_HOME`.
 */
export function clhHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultClhHome(), DEFAULT_CLH_HOME_DISPLAY, CLH_HOME_ENV)
}

/** @deprecated Use {@link clhHomeDisplay}. */
export const dshHomeDisplay = clhHomeDisplay

/**
 * Describe a resolved shared agent configuration root symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default root is labelled
 * `~/.agents`, and any configured root is labelled `$DSH_AGENTS_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveAgentsHome}.
 * @returns `~/.agents` for the default root, otherwise `$DSH_AGENTS_HOME`.
 */
export function agentsHomeDisplay(resolvedHome: string): string {
  return rootDisplay(resolvedHome, defaultAgentsHome(), DEFAULT_AGENTS_HOME_DISPLAY, AGENTS_HOME_ENV)
}
