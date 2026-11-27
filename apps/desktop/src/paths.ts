/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveClhHome } from '@deepseek-ai/dsh-home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param clhHome - Harness home shared with npm-installed clh.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(clhHome: string = resolveClhHome()): DesktopPaths {
  return {
    profile: join(clhHome, 'profiles', 'desktop'),
    lock: join(clhHome, 'profiles', 'desktop', 'lock'),
  }
}
