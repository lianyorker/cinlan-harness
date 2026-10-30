/** Host-backed full-text search admission over the existing query service. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { BooleanPreferenceControl } from './BooleanPreferenceControl.tsx'

/** Live search fields exposed by the SQLite query owner. */
export interface ContentSearchSettings {
  searchEnabled: boolean
}

/** Accepted Host search state and ordered mutation callback. */
export interface ContentSearchInjected {
  hooks: { search: ObservableSnapshot<ConfigFormSnapshot<ContentSearchSettings>> }
  setEnabled(enabled: boolean): Promise<boolean>
}

/**
 * Render full-text search admission without deleting the existing index.
 * @param props - accepted search configuration, writer, and locale-owned copy.
 * @returns a preference row with write failure feedback.
 */
export function ContentSearchRow({ useSearch, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<ContentSearchInjected>) {
  const state = useSearch(value => value)
  return <BooleanPreferenceControl enabled={state.value?.searchEnabled === true}
    writable={state.status === 'ready' && state.writable} anchor="content-search" setEnabled={setEnabled}
    title={t('contentSearch.title')} description={t('contentSearch.description')} error={t('contentSearch.error')} />
}
