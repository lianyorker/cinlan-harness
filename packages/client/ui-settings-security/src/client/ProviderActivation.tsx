/** Exact Loader-entry controls using the existing Plugin Manager. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangeResult, PluginInfo, PluginEntryId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitySettingsKey } from './locales.ts'

/** Authoritative management inventory, including unmodifiable entries. */
export type ProviderInventory = { readonly kind: 'ready'; readonly entries: readonly PluginInfo[] } | { readonly kind: 'unavailable' | 'rejected' }
/** Management transport refusal remains distinct from the Host application result. */
export type ProviderChange = { readonly kind: 'result'; readonly result: ChangeResult } | { readonly kind: 'unavailable' | 'rejected' }
/** Plain callbacks to the optional Plugin Manager namespace. */
export interface ProviderActivationCallbacks {
  listProviderEntries: () => Promise<ProviderInventory>
  setProviderEnabled: (entryId: PluginEntryId, enabled: boolean) => Promise<ProviderChange>
}

const MODULES = {
  computer: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
  browser: '@deepseek-ai/dsh-browser-playwright',
  mobile: '@deepseek-ai/dsh-mobile-device-adb',
} as const
const OUTCOMES = {
  applied: 'providerApplied', 'restart-required': 'providerRestartRequired', overridden: 'providerOverridden',
  failed: 'providerFailed', cancelled: 'providerCancelled',
} as const satisfies Record<ChangeResult['application'], CapabilitySettingsKey>
const PHASES = {
  active: 'providerActive', pending: 'providerPending', loading: 'providerLoading', failed: 'providerFailed', unloading: 'providerUnloading',
} as const satisfies Record<NonNullable<PluginInfo['fiberPhase']>, CapabilitySettingsKey>

/** Render configured provider entries without launching a browser or performing desktop input.
 * @param props - Authoritative management callbacks and localized page identity.
 * @returns Entry-specific enable/disable controls and observed application outcomes.
 */
export function ProviderActivation({
  capability, listProviderEntries, setProviderEnabled, onChanged, revision, t,
}: ProviderActivationCallbacks & PropsLocale<'settings.cinlanCapabilities'> & {
  capability: keyof typeof MODULES
  onChanged: () => void
  revision: number
}): ReactNode {
  const [inventory, setInventory] = useState<ProviderInventory>()
  const [pending, setPending] = useState<PluginEntryId>()
  const [notice, setNotice] = useState<CapabilitySettingsKey>()
  const inFlight = useRef(false)
  const active = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true
    void listProviderEntries().then((value) => { if (current) setInventory(value) }, () => { if (current) setInventory({ kind: 'rejected' }) })
    return () => { current = false }
  }, [listProviderEntries, revision])
  const entries = inventory?.kind === 'ready' ? inventory.entries.filter(entry => entry.moduleName === MODULES[capability]) : []
  const change = async (entry: PluginInfo): Promise<void> => {
    if (inFlight.current) return
    inFlight.current = true
    setPending(entry.entryId)
    setNotice(undefined)
    try {
      const answer = await setProviderEnabled(entry.entryId, !entry.enabled)
      if (active.current) setNotice(answer.kind === 'result' ? OUTCOMES[answer.result.application]
        : answer.kind === 'unavailable' ? 'providerManagementUnavailable' : 'providerRejected')
    } catch (_managementTransportRejected) {
      if (active.current) setNotice('providerRejected')
    } finally {
      inFlight.current = false
      if (active.current) { setPending(undefined); onChanged() }
    }
  }
  return <section data-settings-anchor={capability + '-activation'}>
    <h3>{t('providerActivation')}</h3>
    <p>{t('providerActivationHelp')}</p>
    {inventory === undefined ? <p role="status">{t('providerLoading')}</p>
      : inventory.kind !== 'ready' ? <p role="status">{t(inventory.kind === 'unavailable' ? 'providerManagementUnavailable' : 'providerRejected')}</p>
        : entries.length === 0 ? <p>{t('providerNotConfigured')}</p>
          : entries.map(entry => <div key={entry.entryId}>
            <code>{entry.entryId}</code>
            <p role="status">{t(!entry.enabled ? 'providerDisabled' : entry.fiberPhase === null ? 'providerPending' : PHASES[entry.fiberPhase])}</p>
            {entry.readOnlyReason !== undefined && <p>{t('providerReadOnly')}</p>}
            <Button disabled={pending !== undefined || entry.readOnlyReason !== undefined || entry.fiberPhase === 'loading' || entry.fiberPhase === 'unloading'}
              onClick={() => { void change(entry) }}>{t(pending === entry.entryId ? 'providerChanging' : entry.enabled ? 'providerDisable' : 'providerEnable')}</Button>
          </div>)}
    {notice !== undefined && <p role={notice === 'providerFailed' || notice === 'providerRejected' ? 'alert' : 'status'}>{t(notice)}</p>}
  </section>
}
