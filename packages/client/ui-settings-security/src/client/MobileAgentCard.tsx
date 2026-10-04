/** Agent mobile emulator card: capability activation, model tools, commands, and examples. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Button, IconCheckOutline16, IconCopyOutline16, IconPanelLeftOutline16, IconRefreshOutline16, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChangeResult, PluginEntryId, PluginInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitySettingsKey } from './locales.ts'
import type { ProviderActivationCallbacks, ProviderInventory } from './capability-shared.ts'
import { PROVIDER_MATCHERS } from './capability-matchers.ts'
import css from './CapabilitySection.module.css'

const OUTCOMES = {
  applied: 'providerApplied', 'restart-required': 'providerRestartRequired', overridden: 'providerOverridden',
  failed: 'providerFailed', cancelled: 'providerCancelled',
} as const satisfies Record<ChangeResult['application'], CapabilitySettingsKey>
const PHASES = {
  active: 'mobileAgentStepLoaded', pending: 'mobileAgentStepPending', loading: 'mobileAgentStepPending',
  failed: 'mobileAgentStepFailed', unloading: 'mobileAgentStepPending',
} as const satisfies Record<NonNullable<PluginInfo['fiberPhase']>, CapabilitySettingsKey>
/** The model-facing tools every mobile-emulator composition ships. */
const TOOL_MOBILE_DEVICE = '@deepseek-ai/dsh-tool-mobile-device'
const MOBILE_TOOLS = ['mobile_list_devices', 'mobile_observe', 'mobile_touch', 'mobile_type', 'mobile_button'] as const
const EXAMPLE_KEYS = ['mobileExample', 'mobileExampleTwo', 'mobileExampleThree'] as const

type Step = {
  readonly entry: PluginInfo | undefined
  readonly titleKey: CapabilitySettingsKey
  readonly helpKey: CapabilitySettingsKey
}

type Props = ProviderActivationCallbacks & PropsLocale<'settings.cinlanCapabilities'> & {
  readonly onChanged: () => void
  readonly revision: number
}

function isReady(entry: PluginInfo | undefined): boolean {
  return entry?.enabled === true && entry.fiberPhase === 'active'
}

/**
 * Render mobile emulator control as two steps, the commands they run, and copyable example prompts.
 * @param props - Plugin inventory callbacks and localized copy.
 * @returns The agent card with its progress badge, steps, commands, and examples.
 */
export function MobileAgentCard({ listProviderEntries, setProviderEnabled, onChanged, revision, t }: Props): ReactNode {
  const [inventory, setInventory] = useState<ProviderInventory>()
  const [pending, setPending] = useState<PluginEntryId>()
  const [notice, setNotice] = useState<CapabilitySettingsKey>()
  const [copied, setCopied] = useState<string>()
  const active = useRef(false)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    let current = true
    void listProviderEntries().then((value) => { if (current) setInventory(value) }, () => { if (current) setInventory({ kind: 'rejected' }) })
    return () => { current = false }
  }, [listProviderEntries, revision])
  const entries = inventory?.kind === 'ready' ? inventory.entries : []
  const provider = entries.find(entry => PROVIDER_MATCHERS.mobile.test(entry.moduleName))
  const tools = entries.find(entry => entry.moduleName === TOOL_MOBILE_DEVICE)
  const complete = [isReady(provider), isReady(tools)].filter(Boolean).length
  const steps: readonly Step[] = [
    { entry: provider, titleKey: 'mobileAgentStepProvider', helpKey: 'mobileAgentStepProviderHelp' },
    { entry: tools, titleKey: 'mobileAgentStepTools', helpKey: 'mobileAgentStepToolsHelp' },
  ]
  const change = async (entry: PluginInfo): Promise<void> => {
    setPending(entry.entryId)
    setNotice(undefined)
    try {
      const answer = await setProviderEnabled(entry.entryId, !entry.enabled)
      if (active.current) setNotice(answer.kind === 'result' ? OUTCOMES[answer.result.application]
        : answer.kind === 'unavailable' ? 'providerManagementUnavailable' : 'providerRejected')
    } catch (_managementTransportRejected) {
      if (active.current) setNotice('providerRejected')
    } finally {
      if (active.current) { setPending(undefined); onChanged() }
    }
  }
  const copyPrompt = (key: string, text: string): void => {
    void writeClipboard(text).then((ok) => { if (active.current) setCopied(ok ? key : 'copyFailed') })
  }
  const inventoryNotice = inventory === undefined ? 'providerLoading'
    : inventory.kind === 'unavailable' ? 'providerManagementUnavailable'
      : inventory.kind === 'rejected' ? 'providerRejected' : undefined
  return <section className={css.computerCard} data-settings-anchor="mobile-agent">
    <div className={css.computerCardHeader}>
      <div className={css.computerIcon} aria-hidden="true"><IconPanelLeftOutline16 size={22} /></div>
      <div className={css.heroText}>
        <div className={css.computerCardTitle}>
          <h2>{t('mobileAgentControl')}</h2>
          <span className={css.progressBadge} role="status" aria-label={String(complete) + '/2'}>{complete}/2</span>
        </div>
        <p>{t('mobileHowToUseDescription')}</p>
      </div>
      <Button variant="ghost" icon={<IconRefreshOutline16 />} onClick={onChanged}>{t('mobileAgentRecheck')}</Button>
    </div>
    {inventoryNotice !== undefined && <p role={inventoryNotice === 'providerRejected' ? 'alert' : 'status'}>{t(inventoryNotice)}</p>}
    {steps.map(({ entry, titleKey, helpKey }, index) => {
      const state = entry === undefined ? 'todo' : entry.fiberPhase === 'failed' ? 'failed' : isReady(entry) ? 'done' : 'todo'
      const readOnly = entry?.readOnlyReason !== undefined
      return <div key={titleKey} className={css.stepRow}>
        <div className={css.stepHead}>
          <span className={css.stepIcon} data-step-state={state} aria-hidden="true" />
          <div className={css.stepText}>
            <span className={css.stepTitle}>{index + 1}. {t(titleKey)}</span>
            <small>{entry === undefined ? t('mobileAgentStepUnavailable')
              : readOnly ? t('providerManagedByProfile') : t(helpKey)}</small>
          </div>
          <span className={css.badge}>{entry === undefined ? t('mobileAgentStepPending')
            : !entry.enabled ? t('mobileAgentStepDisabled') : entry.fiberPhase === null ? t('mobileAgentStepPending') : t(PHASES[entry.fiberPhase])}</span>
          {entry !== undefined && !readOnly && <Button variant="outline"
            disabled={pending !== undefined || entry.fiberPhase === 'loading' || entry.fiberPhase === 'unloading'}
            onClick={() => { void change(entry) }}>{t(pending === entry.entryId ? 'providerChanging'
              : entry.enabled ? 'mobileAgentDisable' : index === 1 ? 'mobileAgentInstall' : 'mobileAgentEnable')}</Button>}
        </div>
      </div>
    })}
    <div className={css.computerHowTo} data-settings-anchor="mobile-commands">
      <h3>{t('mobileCommandsTitle')}</h3><p>{t('mobileCommandsDescription')}</p>
      <div className={css.commandGrid}>
        <code>{t('mobileLaunchCommand')}</code>
        {MOBILE_TOOLS.map(tool => <code key={tool}>{tool}</code>)}
      </div>
    </div>
    <div className={css.computerHowTo} data-settings-anchor="mobile-usage">
      <h3>{t('examplesTitle')}</h3><p>{t('mobileExamplesDescription')}</p>
      {EXAMPLE_KEYS.map(key => <div key={key} className={css.commandRow}>
        <code>{t(key)}</code>
        <button type="button" className={css.copyButton} aria-label={t('copyExample')}
          onClick={() => { copyPrompt(key, t(key)) }}>
          {copied === key ? <IconCheckOutline16 size={18} /> : <IconCopyOutline16 size={18} />}
        </button>
      </div>)}
      {copied === 'copyFailed' ? <p role="status">{t('copyFailed')}</p>
        : copied !== undefined && <p role="status">{t('mobileCopied')}</p>}
    </div>
    {notice !== undefined && <p role={notice === 'providerFailed' || notice === 'providerRejected' ? 'alert' : 'status'}>{t(notice)}</p>}
  </section>
}
