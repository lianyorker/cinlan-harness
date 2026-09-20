/** Shared settingsScope-backed writer for every Better Sidebar preference surface. */
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { t } from './locales.ts'
import { parsePrefs, type SidebarPrefs } from './prefs.ts'
import type { SidebarStore } from './state.ts'

/**
 * Keeps the sidebar store synchronized with the standard settings namespace
 * scope and serializes optimistic writes from settings pages and workbench UI.
 */
export class SidebarPreferencesController {
  private tail: Promise<void> = Promise.resolve()
  private generation = 0
  private pending = 0
  private disposed = false
  private readonly unsubscribe: () => void

  /**
   * @param scope - standard Client settings scope for `dsh-better-sidebar`.
   * @param store - sidebar runtime store consuming the resolved preferences.
   */
  constructor(
    private readonly scope: SettingsScope<SidebarPrefs>,
    private readonly store: SidebarStore,
  ) {
    this.acceptScope()
    this.unsubscribe = scope.subscribe(() => { this.acceptScope() })
  }

  /**
   * Optimistically merge top-level fields and persist each patch atomically in order.
   * @param patch - preference fields selected by the user.
   * @returns settlement after acceptance or recovery; rejects on refusal or failure.
   */
  patch(patch: Partial<SidebarPrefs>): Promise<void> {
    if (this.disposed || Object.keys(patch).length === 0) return Promise.resolve()
    const next = parsePrefs({ ...this.store.getPrefs(), ...patch })
    this.store.setPrefs(next)
    const generation = ++this.generation
    this.pending += 1
    const operation = this.tail.then(async () => {
      const accepted = await this.scope.mutate(Object.entries(patch).map(([field, value]) => ({
        op: 'set',
        path: [field],
        value: value as Extract<SettingsPathOpView, { op: 'set' }>['value'],
      })))
      if (!accepted) throw new Error(t('settingsWriteRejected'))
    })
    // The caller receives write failures; later patches must still run.
    this.tail = operation.catch(() => {})
    return operation.finally(() => {
      this.pending -= 1
      if (generation === this.generation) this.acceptScope()
    })
  }

  /**
   * Merge one descriptor-owned settings blob without dropping sibling keys.
   * @param descriptorId - tab or viewer descriptor id.
   * @param updater - pure update over a shallow copy of the current blob.
   * @returns settlement of {@link patch}, including rejection on refusal or failure.
   */
  updatePluginSettings(
    descriptorId: string,
    updater: (blob: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void> {
    const prefs = this.store.getPrefs()
    const current = prefs.pluginSettings[descriptorId] ?? {}
    const next = updater({ ...current })
    return this.patch({
      pluginSettings: {
        ...prefs.pluginSettings,
        [descriptorId]: next,
      },
    })
  }

  /** Stop mirroring scope changes into the sidebar store. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.unsubscribe()
  }

  /** Adopt an authoritative resolved scope value while no local write is pending. */
  private acceptScope(): void {
    if (this.disposed || this.pending > 0) return
    const value = this.scope.getSnapshot().value
    if (value !== undefined) this.store.setPrefs(parsePrefs(value))
  }
}
