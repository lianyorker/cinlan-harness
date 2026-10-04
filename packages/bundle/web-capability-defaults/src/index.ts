/**
 * Patch-only bundle: this package ships `cordis.patch.yml` and mounts no row of
 * its own, so the entry exists only to give the workspace build an artifact.
 * @module @deepseek-ai/dsh-web-capability-defaults
 */

/** Stable Cordis plugin name. */
export const name = 'web-capability-defaults'

/** The bundle contributes rows through its patch file, never through code. */
export function apply(): void {}
