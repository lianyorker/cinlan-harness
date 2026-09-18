/** Revision-fenced writes and resets for the Git preferences page. */
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GitSourceControlSettings } from '../types.ts'

/** Callbacks require Host acceptance and authoritative persisted readback for writes. */
export interface GitSettingsOperations {
  /** Persist an editable field; base refresh rejects. Resolve true only for a confirmed user override. */
  save: <K extends keyof GitSourceControlSettings>(field: K, value: GitSourceControlSettings[K], revision?: number) => Promise<boolean>
  /** Remove one user override at the current revision; resolve true only after confirmed removal. */
  reset: (field: keyof GitSourceControlSettings) => Promise<boolean>
}

/**
 * Test whether a field has an explicit user override, including a default-valued override.
 * @param user - raw user layer from the settings scope.
 * @param field - Git preference key.
 * @returns whether the field belongs to the user layer.
 */
export function hasOverride(user: unknown, field: keyof GitSourceControlSettings): boolean {
  return typeof user === 'object' && user !== null && Object.hasOwn(user, field)
}

/**
 * Bind Git writes to the current writable Host revision and confirm their readback.
 * @param settings - the feature-owned namespace scope.
 * @returns save and reset callbacks for the rendered settings rows.
 */
export function createGitSettingsOperations(settings: SettingsScope<GitSourceControlSettings>): GitSettingsOperations {
  return {
    save: async (field, value, revision) => {
      const before = settings.getSnapshot()
      if (field === 'refreshLocalBaseRefOnWorktreeCreate'
        || before.status !== 'ready' || !before.writable || before.mode !== 'host'
        || (revision !== undefined && revision !== before.revision)) return false
      try {
        if (!await settings.mutate([{ op: 'set', path: [field], value }], before.revision)) return false
      } catch (_writeFailed) {
        return false
      }
      const after = settings.getSnapshot()
      return after.status === 'ready' && hasOverride(after.user, field)
        && (after.user as Partial<GitSourceControlSettings>)[field] === value && after.value?.[field] === value
    },
    reset: async (field) => {
      const before = settings.getSnapshot()
      if (before.status !== 'ready' || !before.writable || before.mode !== 'host' || !hasOverride(before.user, field)) return false
      try {
        if (!await settings.mutate([{ op: 'unset', path: [field] }], before.revision)) return false
      } catch (_writeFailed) {
        return false
      }
      const after = settings.getSnapshot()
      return after.status === 'ready' && !hasOverride(after.user, field)
    },
  }
}
