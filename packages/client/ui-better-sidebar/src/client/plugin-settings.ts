/**
 * Pending-writes queue for the file tree's open-with config: pin toggles and
 * (outside the settings popup) config edits land in the sidebar prefs as
 * `pluginSettings['editor']`. Writes are serialized through one promise chain
 * so a quick burst of pin clicks can never read a stale pluginSettings map
 * and drop an earlier toggle; each write pushes the whole open map patch
 * through the revision-free settings route and adopts the returned document.
 *
 * (The settings popup has its own serialized commit — SideCardSection's —
 * so its rows and this helper rarely race; the shared route's last-write-wins
 * semantics cover the uncommon overlap.)
 */
import type { SidebarPreferencesController } from './preferences-controller.ts'

/**
 * Merge one plugin-owned settings blob of one descriptor and persist it.
 * @param store - the sidebar store (its prefs are replaced by the write result).
 * @param descriptorId - the descriptor whose blob is patched ('editor' here).
 * @param updater - pure patch function; receives a shallow copy of the blob.
 */
export function updatePluginSettings(
  preferences: SidebarPreferencesController,
  descriptorId: string,
  updater: (blob: Record<string, unknown>) => Record<string, unknown>,
): void {
  void preferences.updatePluginSettings(descriptorId, updater).catch((error: unknown) => {
    // The pin stays visually unchanged (no optimistic flip) and the menu
    // keeps working — the write failure is logged, not surfaced.
    console.error('open-with settings write failed', error)
  })
}
