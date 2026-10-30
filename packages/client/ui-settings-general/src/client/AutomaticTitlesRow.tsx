/** Host-backed automatic title preference; existing titles and explicit refresh stay available. */
import { BooleanPreferenceControl } from './BooleanPreferenceControl.tsx'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Live title-service fields exposed by its settings owner. */
export interface AutomaticTitlesSettings {
  automaticEnabled: boolean
}

/** Accepted Host state and ordered mutation supplied by registration. */
export interface AutomaticTitlesInjected {
  hooks: { titles: ObservableSnapshot<ConfigFormSnapshot<AutomaticTitlesSettings>> }
  setEnabled(enabled: boolean): Promise<boolean>
}

/**
 * Render automatic title admission without changing conversation execution.
 * @param props - accepted configuration, writer, and locale-owned copy.
 * @returns the preference row and retry feedback.
 */
export function AutomaticTitlesRow({ useTitles, setEnabled, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<AutomaticTitlesInjected>) {
  const state = useTitles(value => value)
  return <BooleanPreferenceControl enabled={state.value?.automaticEnabled === true}
    writable={state.status === 'ready' && state.writable} anchor="automatic-titles" setEnabled={setEnabled}
    title={t('automaticTitles.title')} description={t('automaticTitles.description')} error={t('automaticTitles.error')} />
}
