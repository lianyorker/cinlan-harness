/** Mutable authoritative settings fixture shared by Git component and operation tests. */
import { vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { GitSourceControlSettingsSchema } from '@deepseek-ai/dsh-git-settings/settings-schema'
import type { GitSourceControlSettings } from '../src/types.ts'

export function settingsFixture(initial: Partial<SettingsScopeSnapshot<GitSourceControlSettings>> = {}) {
  const store = createSnapshotStore<SettingsScopeSnapshot<GitSourceControlSettings>>({
    status: 'ready', value: GitSourceControlSettingsSchema(), user: {}, base: {}, revision: 1, writable: true, mode: 'host', ...initial,
  })
  const mutate = vi.fn<SettingsScope<GitSourceControlSettings>['mutate']>().mockResolvedValue(false)
  const scope: SettingsScope<GitSourceControlSettings> = {
    getSnapshot: () => store.getSnapshot(), subscribe: listener => store.subscribe(listener), mutate, set: vi.fn(), unset: vi.fn(),
  }
  const publish = (next: Partial<SettingsScopeSnapshot<GitSourceControlSettings>>) => {
    store.set({ ...store.getSnapshot(), ...next })
  }
  return { store, scope, mutate, publish }
}
