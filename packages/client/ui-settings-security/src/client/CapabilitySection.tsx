/** Host-backed settings section for Browser, Computer, or Mobile. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconCheckOutline16,
  IconCopyOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPanelLeftOutline16,
  IconRefreshOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeviceCapabilityKind, DeviceCapabilitySnapshot, MobileSdkSnapshot, MobileDeviceListSnapshot, PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitySettingsKey } from './locales.ts'
import {
  capabilityComponents,
  capabilityStatus,
  type CapabilityComponent,
  type CapabilityStatus,
} from './view.ts'
import css from './CapabilitySection.module.css'
import type { BrowserPreferences } from '@deepseek-ai/dsh-browser-playwright/types'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import { BrowserPreferencesForm } from './BrowserPreferencesForm.tsx'
import { BrowserRoutingForm, type BrowserRoutingPreferences } from './BrowserRoutingForm.tsx'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { ProviderActivation, type ProviderActivationCallbacks } from './ProviderActivation.tsx'
import { ComputerObservations } from './ComputerObservations.tsx'
import { BrowserResourcesSection, type BrowserResourcesInjected, type BrowserResourcesProps } from './BrowserResourcesSection.tsx'
import { MobilePreferences } from './MobilePreferences.tsx'
import { BrowserControls, type BrowserControlsCallbacks } from './BrowserControls.tsx'

/** Capability pages contributed by this product plugin. */
export type CapabilityId = 'security' | 'browser' | 'computer' | 'mobile'

/** Registration metadata for one capability page. */
export interface CapabilityDefinition {
  readonly id: CapabilityId
  readonly navKey: CapabilitySettingsKey
  readonly titleKey: CapabilitySettingsKey
  readonly descriptionKey: CapabilitySettingsKey
  readonly order: number
}

/** Stable product capability roster. */
export const CAPABILITIES: readonly CapabilityDefinition[] = [
  { id: 'security', navKey: 'securityNav', titleKey: 'securityTitle', descriptionKey: 'securityDescription', order: 40 },
  { id: 'browser', navKey: 'browserNav', titleKey: 'browserTitle', descriptionKey: 'browserDescription', order: 50 },
  { id: 'computer', navKey: 'computerNav', titleKey: 'computerTitle', descriptionKey: 'computerDescription', order: 60 },
  { id: 'mobile', navKey: 'mobileNav', titleKey: 'mobileTitle', descriptionKey: 'mobileDescription', order: 70 },
] as const

const CAPABILITY_MATCHERS = {
  browser: /^@deepseek-ai\/dsh-(?:browser(?:-cinlan|-playwright|-permission-policy)?|tool-browser)$/i,
  computer:
    /^@deepseek-ai\/dsh-(?:experimental-computer-use-cua-driver-native|computer-use(?:-cinlan|-permission-policy)?|tool-computer-use)$/i,
  mobile: /^@deepseek-ai\/dsh-(?:mobile-device(?:-adb|-cinlan|-permission-policy)?|tool-mobile-device)$/i,
} as const satisfies Record<Exclude<CapabilityId, 'security'>, RegExp>

/** Injected Remote face shared by Browser, Computer, and Mobile pages. */
export interface CapabilitySectionInjected extends Omit<BrowserResourcesInjected, 'hooks'>, ProviderActivationCallbacks {
  /** Explicit human Browser commands through the generated Remote. */
  browserControls: BrowserControlsCallbacks | undefined
  /** Settings-owned source bound by the renderer, including unavailable/read-only states. */
  hooks: BrowserResourcesInjected['hooks'] & {
    browserPreferences: SettingsScope<BrowserPreferences>
    browserRouting: SettingsScope<SidebarPrefs>
    mobileSettings: SettingsScope<MobileDeviceSettings>
  }
  /** Save only changed sidebar-owned link routing fields with the opening revision. */
  saveBrowserRouting: (changes: Partial<BrowserRoutingPreferences>, revision: number) => Promise<void>
  /** Remove only link routing overrides; other sidebar settings remain owned by their pages. */
  resetBrowserRouting: (revision: number) => Promise<void>
  /** Persist stored mobile preferences with their opening revision. */
  saveMobileSettings: (value: MobileDeviceSettings, revision: number) => Promise<void>
  /** Remove mobile preference overrides so composition defaults apply. */
  resetMobileSettings: (revision: number) => Promise<void>
  /** Remove browser preference overrides so composition defaults apply. */
  resetBrowserPreferences: (revision: number) => Promise<void>
  /** Persist an explicit draft using the revision at which it was opened. */
  saveBrowserPreferences: (value: BrowserPreferences, revision: number) => Promise<void>
  /** Read the current Host Loader projection. */
  list: () => Promise<PluginInventorySnapshot>
  /** Page registration metadata. */
  definition: CapabilityDefinition & { id: Exclude<CapabilityId, 'security'> }
  /** Probe actual device Provider readiness; never infer it from Loader activation. */
  checkDevice: (capability: DeviceCapabilityKind, signal: AbortSignal) => Promise<DeviceCapabilitySnapshot>
  /** Detect Android SDK and iOS Simulator availability. */
  checkSdk: (signal: AbortSignal) => Promise<MobileSdkSnapshot>
  /** List mobile devices for the default-device selector. */
  listMobileDevices: (signal: AbortSignal) => Promise<MobileDeviceListSnapshot>
}

/** Props assembled by the Settings renderer. */
export type CapabilitySectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.cinlanCapabilities'>
  & InjectFace<CapabilitySectionInjected>

type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly components: readonly CapabilityComponent[]; readonly device: DeviceCapabilitySnapshot | undefined }

const STATUS_KEYS = {
  ready: 'statusReady',
  loading: 'statusLoading',
  attention: 'statusAttention',
  missing: 'statusMissing',
} as const satisfies Record<CapabilityStatus, CapabilitySettingsKey>

const DEVICE_STATUS_KEYS = {
  available: 'deviceAvailable',
  unavailable: 'deviceUnavailable',
  'not-configured': 'deviceNotConfigured',
  checking: 'deviceChecking',
} as const satisfies Record<DeviceCapabilitySnapshot['status'] | 'checking', CapabilitySettingsKey>

function deviceStatus(state: ViewState): DeviceCapabilitySnapshot['status'] | 'checking' {
  if (state.phase === 'loading') return 'checking'
  return state.phase === 'error' ? 'unavailable' : state.device?.status ?? 'not-configured'
}

function deviceReason(state: ViewState, t: CapabilitySectionProps['t']): string {
  if (state.phase === 'error') return t('deviceCheckFailed')
  if (state.phase === 'loading') return t('deviceChecking')
  const reason = state.device?.reason
  if (reason === null) return t('deviceAvailableDescription')
  const keys = {
    'not-configured': 'deviceNotConfiguredDescription',
    'cli-missing': 'deviceCliMissing',
    'provider-unavailable': 'deviceProviderUnavailable',
    'protocol-error': 'deviceProtocolError',
    'probe-failed': 'deviceCheckFailed',
    'no-devices': 'deviceNoDevices',
    'provider-initializing': 'computerInitializing',
    'provider-disposing': 'computerDisposing',
    'provider-failed': 'computerFailed',
  } as const
  return t(reason === undefined ? 'deviceNotConfiguredDescription' : keys[reason])
}

const COMPUTER_CARDS = [
  { id: 'observe', icon: IconBrowseOutline16, titleKey: 'computerObserveTitle', descriptionKey: 'computerObserveDescription' },
  { id: 'operate', icon: IconRefreshOutline16, titleKey: 'computerOperateTitle', descriptionKey: 'computerOperateDescription' },
  { id: 'verify', icon: IconListPenOutline16, titleKey: 'computerVerifyTitle', descriptionKey: 'computerVerifyDescription' },
] as const satisfies readonly FeatureCardDefinition[]

type FeatureIcon = typeof IconBrowseOutline16

interface FeatureCardDefinition {
  readonly id: string
  readonly icon: FeatureIcon
  readonly titleKey: CapabilitySettingsKey
  readonly descriptionKey: CapabilitySettingsKey
}

interface BodyProps {
  state: ViewState
  t: CapabilitySectionProps['t']
  onRefresh: () => void
}

function RefreshButton({ state, t, onRefresh }: BodyProps): ReactNode {
  return <button type="button" className={css.recheckButton} disabled={state.phase === 'loading'} onClick={onRefresh}>
    <IconRefreshOutline16 size={16} />{t('computerRecheck')}
  </button>
}

function CopyText({ text, t, labelKey = 'computerCopyCommand' }: {
  text: string
  t: CapabilitySectionProps['t']
  labelKey?: CapabilitySettingsKey
}): ReactNode {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  return <div>
    <div className={css.commandRow}>
      <code>{text}</code>
      <button type="button" className={css.copyButton} aria-label={t(labelKey)} onClick={() => {
        void writeClipboard(text).then((ok) => { setStatus(ok ? 'copied' : 'failed') })
      }}>
        {status === 'copied' ? <IconCheckOutline16 size={18} /> : <IconCopyOutline16 size={18} />}
      </button>
    </div>
    {status !== 'idle' && <p className={css.copyFeedback} role="status">{t(status === 'copied' ? 'computerCopied' : 'copyFailed')}</p>}
  </div>
}

function FeatureCards({ cards, t }: { cards: readonly FeatureCardDefinition[]; t: CapabilitySectionProps['t'] }): ReactNode {
  return <div className={css.computerCards}>
    {cards.map(({ id, icon: Icon, titleKey, descriptionKey }) => <article key={id} className={css.computerFeatureCard}>
      <div className={css.computerFeatureIcon} aria-hidden="true"><Icon size={20} /></div>
      <div><h4>{t(titleKey)}</h4><p>{t(descriptionKey)}</p></div>
    </article>)}
  </div>
}

function inventoryStatus(state: ViewState): CapabilityStatus {
  if (state.phase === 'error') return 'attention'
  return state.phase === 'loading' ? 'loading' : capabilityStatus(state.components)
}

function Badge({ status, children }: { status: string; children: ReactNode }): ReactNode {
  return <span className={css.computerBadge} data-capability-status={status} role="status">
    <span className={css.dot} aria-hidden="true" />{children}
  </span>
}

function HeroHeader({ icon: Icon, title, description, badge }: {
  icon: FeatureIcon
  title: string
  description: string
  badge: ReactNode
}): ReactNode {
  return <div className={css.computerCardHeader}>
    <div className={css.computerIcon} aria-hidden="true"><Icon size={22} /></div>
    <div className={css.heroText}>
      <div className={css.computerCardTitle}><h3>{title}</h3>{badge}</div>
      <p>{description}</p>
    </div>
  </div>
}

function ComputerCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <>
    <div className={css.computerCard} data-settings-anchor="computer-readiness">
      <HeroHeader icon={IconBrowseOutline16} title={t('computerHeroTitle')} description={t('computerInstallDescription')}
        badge={<Badge status={status}>{t(DEVICE_STATUS_KEYS[status])}</Badge>} />
      <p>{deviceReason(state, t)}</p>
      <CopyText text={t('computerInstallCommand')} t={t} />
      <p className={css.capabilityFact}>{t('computerNativePrerequisite')}</p>
      <RefreshButton {...props} />
    </div>
    <ComputerObservations observation={state.phase === 'ready' ? state.device?.computer : undefined}
      loading={state.phase === 'loading'} t={t} />
    <div className={css.computerHowTo} data-settings-anchor="computer-usage">
      <h3>{t('computerHowToUse')}</h3><p>{t('computerHowToUseDescription')}</p>
      <FeatureCards cards={COMPUTER_CARDS} t={t} />
    </div>
  </>
}

function BrowserCapabilityBody(props: BodyProps & BrowserResourcesProps & Pick<CapabilitySectionProps,
  'useBrowserPreferences' | 'saveBrowserPreferences' | 'resetBrowserPreferences' | 'browserControls' | 'target'
  | 'useBrowserRouting' | 'saveBrowserRouting' | 'resetBrowserRouting'>): ReactNode {
  const { state, t } = props
  const configured = props.useBrowserPreferences(snapshot => snapshot.status === 'ready')
  const status = inventoryStatus(state)
  return <div className={css.setupCard}>
    <section className={css.computerCard} data-settings-anchor="browser-readiness">
      <HeroHeader icon={IconGlobeOutline14} title={t('browserHeroTitle')} description={t('browserHeroDescription')}
        badge={<Badge status={status}>{t(STATUS_KEYS[status])}</Badge>} />
      <p>{t('browserProviderLimit')}</p>
      <RefreshButton {...props} />
    </section>
    <BrowserResourcesSection {...props} />
    <BrowserRoutingForm useBrowserRouting={props.useBrowserRouting} saveBrowserRouting={props.saveBrowserRouting}
      resetBrowserRouting={props.resetBrowserRouting} t={t} />
    <BrowserPreferencesForm useBrowserPreferences={props.useBrowserPreferences}
      saveBrowserPreferences={props.saveBrowserPreferences} resetBrowserPreferences={props.resetBrowserPreferences} t={t} />
    <section className={css.agentSetup} data-settings-anchor="browser-actions">
      <h2>{t('browserSessionTitle')}</h2><p>{t('browserCookieDescription')}</p>
      <p>{t('browserSessionOwner')}</p>
      {!configured || props.browserControls === undefined
        ? <p role="status" data-settings-anchor="browser-transfers">{t('browserActionsUnavailable')}</p>
        : <BrowserControls callbacks={props.browserControls} {...props.target === undefined ? {} : { target: props.target }} t={t} />}
    </section>
    <section className={css.examples} data-settings-anchor="browser-usage">
      <h2>{t('browserSkillTitle')}</h2><p>{t('browserSkillDescription')}</p>
      <p>{t('browserExamplesDescription')}</p>
      <CopyText text={t('browserExample')} labelKey="copyExample" t={t} />
    </section>
  </div>
}

function MobileCapabilityBody(props: BodyProps & Pick<CapabilitySectionProps,
  'checkSdk' | 'listMobileDevices' | 'useMobileSettings' | 'saveMobileSettings' | 'resetMobileSettings'>): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <div className={css.setupCard}>
    <section className={css.computerCard} data-settings-anchor="mobile-readiness">
      <HeroHeader icon={IconPanelLeftOutline16} title={t('mobileHeroTitle')} description={t('mobileHeroDescription')}
        badge={<Badge status={status}>{t(DEVICE_STATUS_KEYS[status])}</Badge>} />
      <p>{deviceReason(state, t)}</p>
      <RefreshButton {...props} />
    </section>
    <MobilePreferences useMobileSettings={props.useMobileSettings} saveMobileSettings={props.saveMobileSettings}
      resetMobileSettings={props.resetMobileSettings} checkSdk={props.checkSdk} listMobileDevices={props.listMobileDevices} t={t} />
    <section className={css.agentSetup} data-settings-anchor="mobile-usage">
      <h2>{t('mobileAgentControl')}</h2><p>{t('mobileHowToUseDescription')}</p>
      <p>{t('devicePrerequisite')}</p>
      <CopyText text={t('computerInstallCommand')} t={t} />
      <p>{t('mobileOperateDescription')}</p>
      <CopyText text={t('mobileExample')} labelKey="copyExample" t={t} />
    </section>
  </div>
}

/** Render a capability page through injected Host reads; no installation or device input occurs here.
 * @param props - Settings slot hooks, explicit preference/actions callbacks, and optional search target.
 * @returns The localized capability page and collapsed component diagnostics.
 */
export function CapabilitySection({
  list, definition, checkDevice, checkSdk, listMobileDevices, useBrowserPreferences, saveBrowserPreferences,
  browserControls, useMobileSettings, saveMobileSettings, resetMobileSettings,
  useBrowserResources, watchBrowserResources, refreshBrowserResources, runBrowserResource, cancelBrowserResource, closeBrowserRuntime,
  listProviderEntries, setProviderEnabled,
  resetBrowserPreferences, useBrowserRouting, saveBrowserRouting, resetBrowserRouting, target, t,
}: CapabilitySectionProps): ReactNode {
  const diagnostics = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (target?.anchorId === definition.id + '-components' && diagnostics.current !== null) diagnostics.current.open = true
  }, [target, definition.id])
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  useEffect(() => {
    let current = true
    const abort = new AbortController()
    const device = definition.id === 'computer' || definition.id === 'mobile' ? definition.id : undefined
    setState({ phase: 'loading' })
    void Promise.resolve().then(() => Promise.all([
      list(),
      device === undefined ? undefined : checkDevice(device, abort.signal),
    ])).then(
      ([snapshot, readiness]) => {
        if (current) setState({ phase: 'ready', components: capabilityComponents(snapshot.entries, CAPABILITY_MATCHERS[definition.id]), device: readiness })
      },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false; abort.abort() }
  }, [definition, list, checkDevice, request])
  const body = { state, t, onRefresh: () => { setRequest(value => value + 1) } }
  return <section className={css.section} data-capability={definition.id} aria-busy={state.phase === 'loading'}>
    <header className={css.heading}><h1>{t(definition.titleKey)}</h1><p>{t(definition.descriptionKey)}</p></header>
    {state.phase === 'error' && <p className={css.failure} role="alert">{t('loadFailed')}</p>}
    {definition.id !== 'mobile' && <ProviderActivation capability={definition.id} listProviderEntries={listProviderEntries}
      setProviderEnabled={setProviderEnabled} onChanged={body.onRefresh} revision={request} t={t} />}
    {definition.id === 'computer' ? <ComputerCapabilityBody {...body} />
      : definition.id === 'browser' ? <BrowserCapabilityBody
        {...body}
        useBrowserPreferences={useBrowserPreferences}
        saveBrowserPreferences={saveBrowserPreferences}
        resetBrowserPreferences={resetBrowserPreferences}
        useBrowserRouting={useBrowserRouting}
        saveBrowserRouting={saveBrowserRouting}
        resetBrowserRouting={resetBrowserRouting}
        browserControls={browserControls}
        useBrowserResources={useBrowserResources} watchBrowserResources={watchBrowserResources}
        refreshBrowserResources={refreshBrowserResources}
        runBrowserResource={runBrowserResource} cancelBrowserResource={cancelBrowserResource} closeBrowserRuntime={closeBrowserRuntime}
        {...target === undefined ? {} : { target }}
      />
        : <MobileCapabilityBody {...body} checkSdk={checkSdk} listMobileDevices={listMobileDevices}
          useMobileSettings={useMobileSettings} saveMobileSettings={saveMobileSettings} resetMobileSettings={resetMobileSettings} />}
    <details ref={diagnostics} className={css.diagnostics} data-settings-anchor={definition.id + '-components'}>
      <summary>{t('hostFact')}{state.phase === 'ready' ? ` · ${state.components.length}` : ''}</summary>
      <p>{t('inventoryCaveat')}</p>
      {state.phase === 'loading' && <p>{t('loading')}</p>}
      {state.phase === 'ready' && (state.components.length === 0 ? <p>{t('missingDescription')}</p> : <ul className={css.cards}>
        {state.components.map(component => <li key={component.moduleName} className={css.card}>
          <span className={css.cardTitle}>{component.moduleName}</span>
          <span>{t(STATUS_KEYS[component.status])}</span>
        </li>)}
      </ul>)}
    </details>
  </section>
}
