/**
 * Patch-only bundle: this package ships `cordis.patch.yml` and mounts no row of
 * its own, so the entry exists only to give the workspace build an artifact.
 * @module @deepseek-ai/dsh-cinlan-web
 */

/** Stable Cordis plugin name. */
export const name = 'cinlan-web'

/** The bundle contributes rows through its patch file, never through code. */
export function apply(): void {}
