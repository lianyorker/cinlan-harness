/** Host-backed settings section for one Cinlan capability family. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconBrowseOutline16,
  IconCheckOutline16,
  IconCopyOutline16,
  IconDownloadOutline16,
  IconEnhanceOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPanelLeftOutline16,
  IconRefreshOutline16,
  IconSkillOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeviceCapabilityKind, DeviceCapabilitySnapshot, MobileSdkSnapshot, MobileDeviceListSnapshot, PluginInventorySnapshot, SecurityResearchSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
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
import type { SecurityResearchScopeSettings, SecurityResearchReportRequest, SecurityResearchReportValue } from '@deepseek-ai/dsh-api-remotes/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import { SecurityScopeEditor } from './SecurityScopeEditor.tsx'
import { SecurityReportExport } from './SecurityReportExport.tsx'
import { SkillInstallCard } from './SkillInstallCard.tsx'
import { BrowserPreferencesForm } from './BrowserPreferencesForm.tsx'
import { BrowserRoutingForm, type BrowserRoutingPreferences } from './BrowserRoutingForm.tsx'
import type { SidebarPrefs } from '@deepseek-ai/dsh-client-ui-better-sidebar/client/service'
import { ComputerObservations } from './ComputerObservations.tsx'
import { MobilePreferences } from './MobilePreferences.tsx'
import { BrowserControls, type BrowserControlsCallbacks } from './BrowserControls.tsx'

/** Capability pages contributed by this product plugin. */
export type CapabilityId = 'security' | 'browser' | 'computer' | 'mobile' | 'design'

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
  { id: 'design', navKey: 'designNav', titleKey: 'designTitle', descriptionKey: 'designDescription', order: 80 },
] as const

const CAPABILITY_MATCHERS = {
  security: new RegExp('^@deepseek-ai/dsh-(?:security-(?:skills|workflow-prompt)|assessment-scope(?:-static|-session|-settings)?'
    + '|finding(?:-session)?|vuln-kb(?:-service|-nvd)?|tool-(?:finding|vuln-kb))$', 'i'),
  browser: /^@deepseek-ai\/dsh-(?:browser(?:-cinlan|-playwright|-permission-policy)?|tool-browser)$/i,
  computer: /^@deepseek-ai\/dsh-(?:computer-use(?:-cinlan|-permission-policy)?|tool-computer-use)$/i,
  mobile: /^@deepseek-ai\/dsh-(?:mobile-device(?:-cinlan|-permission-policy)?|tool-mobile-device)$/i,
  design: /^@deepseek-ai\/dsh-(?:design-studio(?:-local|-prompt)?|tool-design-studio|cinlan-design)$/i,
} as const satisfies Record<CapabilityId, RegExp>

/** Injected Remote face shared by every page. */
export interface CapabilitySectionInjected {
  /** Explicit human Browser commands through the generated Remote. */
  browserControls: BrowserControlsCallbacks | undefined
  /** Settings-owned source bound by the renderer, including unavailable/read-only states. */
  hooks: {
    browserPreferences: SettingsScope<BrowserPreferences>
    browserRouting: SettingsScope<SidebarPrefs>
    securityScope: SettingsScope<SecurityResearchScopeSettings>
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
  /** Persist the security scope draft with its opening revision. */
  saveSecurityScope: (value: SecurityResearchScopeSettings['root'], revision: number) => Promise<void>
  /** Persist an explicit draft using the revision at which it was opened. */
  saveBrowserPreferences: (value: BrowserPreferences, revision: number) => Promise<void>
  /** Export a live Session's Findings as deterministic report bytes. */
  exportReport?: (request: SecurityResearchReportRequest, signal: AbortSignal) => Promise<SecurityResearchReportValue>
  /** Read the current Host Loader projection. */
  list: () => Promise<PluginInventorySnapshot>
  /** Page registration metadata. */
  definition: CapabilityDefinition
  /** Probe actual device Provider readiness; never infer it from Loader activation. */
  checkDevice: (capability: DeviceCapabilityKind, signal: AbortSignal) => Promise<DeviceCapabilitySnapshot>
  /** Detect Android SDK and iOS Simulator availability. */
  checkSdk: (signal: AbortSignal) => Promise<MobileSdkSnapshot>
  /** List mobile devices for the default-device selector. */
  listMobileDevices: (signal: AbortSignal) => Promise<MobileDeviceListSnapshot>
  /** Read redacted Harness-native Security Research status. */
  describeSecurity: (signal: AbortSignal) => Promise<SecurityResearchSnapshot>
}

/** Props assembled by the Settings renderer. */
export type CapabilitySectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.cinlanCapabilities'>
  & InjectFace<CapabilitySectionInjected>

type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly components: readonly CapabilityComponent[]; readonly device: DeviceCapabilitySnapshot | undefined; readonly security: SecurityResearchSnapshot | undefined }

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

const DESIGN_CARDS = [
  { id: 'create', icon: IconEnhanceOutline16, titleKey: 'designCreateTitle', descriptionKey: 'designCreateDescription' },
  { id: 'preview', icon: IconBrowseOutline16, titleKey: 'designPreviewTitle', descriptionKey: 'designPreviewDescription' },
  { id: 'export', icon: IconDownloadOutline16, titleKey: 'designExportTitle', descriptionKey: 'designExportDescription' },
] as const satisfies readonly FeatureCardDefinition[]

const SECURITY_CARDS = [
  { id: 'scope', icon: IconSkillOutline16, titleKey: 'securityScopeTitle', descriptionKey: 'securityScopeDescription' },
  { id: 'findings', icon: IconListPenOutline16, titleKey: 'securityFindingsTitle', descriptionKey: 'securityFindingsDescription' },
  { id: 'report', icon: IconDownloadOutline16, titleKey: 'securityReportTitle', descriptionKey: 'securityReportDescription' },
] as const satisfies readonly FeatureCardDefinition[]

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

function securityStatus(state: ViewState): CapabilityStatus {
  if (state.phase !== 'ready' || state.security === undefined) return state.phase === 'loading' ? 'loading' : 'attention'
  if (state.security.status === 'configured') return 'ready'
  if (state.security.status === 'not-configured') return 'missing'
  return 'attention'
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
      <p className={css.capabilityFact}>{t('devicePrerequisite')}</p>
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

function SecurityResearchBody(props: BodyProps & Pick<CapabilitySectionProps, 'useSecurityScope' | 'saveSecurityScope' | 'exportReport'>): ReactNode {
  const { state, t } = props
  const status = securityStatus(state)
  const security = state.phase === 'ready' ? state.security : undefined
  const unread = state.phase === 'loading' ? 'securityStatusLoading' : 'securityReadFailed'
  const presetMissing = security !== undefined && !security.preset.present && security.preset.broken === undefined
  const presetBroken = security !== undefined && security.preset.broken !== undefined
  const presetReady = security !== undefined && security.preset.present && security.preset.broken === undefined
  const scopeStatusText = {
    configured: t('securityScopeConfigured'), expired: t('securityScopeExpired'),
    'not-yet-valid': t('securityScopeFuture'), empty: t('securityScopeEmpty'), missing: t('securityScopeMissing'),
  } satisfies Record<SecurityResearchSnapshot['scope']['state'], string>
  const scopeLabel = security === undefined ? t(unread) : scopeStatusText[security.scope.state]
  const skillLabel = security === undefined
    ? t(unread)
    : t(security.skillsComplete ? 'securitySkillsCount' : 'securitySkillsPartial', { count: security.skillCount })
  return <>
    <div className={css.computerCard} data-settings-anchor="security-readiness">
      <HeroHeader icon={IconSkillOutline16} title={t('securityHeroTitle')} description={t('securityHeroDescription')}
        badge={<Badge status={status}>{t(status === 'ready' ? 'securityConfigured'
          : status === 'missing' ? 'securityNotConfigured' : status === 'loading' ? 'securityStatusLoading' : 'securityAttention')}</Badge>} />
      <p>{t('securityPresetGuidance')}</p>
      <p className={css.capabilityFact}>{t('securityExecutionCaveat')}</p>
      <div className={css.securitySummary}>
        <div><strong>{t('securityPresetLabel')}</strong><span>{security === undefined ? t(unread) : security.preset.broken !== undefined ? t('securityPresetBroken')
          : t(security.preset.present ? 'securityPresetPresent' : 'securityPresetMissing')}</span></div>
        <div><strong>{t('securityScopeLabel')}</strong><span>{scopeLabel}</span></div>
        <div><strong>{t('securitySkillLabel')}</strong><span>{skillLabel}</span></div>
      </div>
      <RefreshButton {...props} />
    </div>
    {presetMissing && <SkillInstallCard
      icon={<IconSkillOutline16 size={22} />}
      title={t('securityInstallTitle')}
      description={t('securityInstallDescription')}
      command={t('securityCommand')}
      status="not-installed"
      statusLabel={t('securityPresetMissing')}
      hint={t('securityInstallHint')}
      onRecheck={props.onRefresh}
      t={t} />}
    {presetBroken && <SkillInstallCard
      icon={<IconSkillOutline16 size={22} />}
      title={t('securityPresetBrokenTitle')}
      description={t('securityPresetBrokenDescription')}
      command={undefined}
      status="failed"
      statusLabel={t('securityPresetBroken')}
      hint={t('securityPresetBrokenHint')}
      onRecheck={props.onRefresh}
      t={t} />}
    <div className={css.computerHowTo} data-settings-anchor="security-usage">
      <h3>{t('securityHowToUse')}</h3><p>{t('securityHowToUseDescription')}</p>
      <FeatureCards cards={SECURITY_CARDS} t={t} />
      <section data-settings-anchor="security-scope">
        {presetReady ? <SecurityScopeEditor useSecurityScope={props.useSecurityScope} saveSecurityScope={async (value, revision) => {
          await props.saveSecurityScope(value, revision)
          props.onRefresh()
        }} t={t} /> : <div>
          <p role="status">{t(state.phase === 'loading' ? 'securityScopeLoading' : 'securityScopeUnavailable')}</p>
          <p data-settings-anchor="security-egress">{t('securityEgress')}: {t('securityScopeUnavailable')}</p>
          <p data-settings-anchor="security-credentials">{t('securityCredentials')}: {t('securityScopeUnavailable')}</p>
        </div>}
      </section>
      <section data-settings-anchor="security-report">
        {presetReady && props.exportReport !== undefined ? <SecurityReportExport exportReport={props.exportReport} t={t} />
          : <p role="status">{t('securityReportUnavailable')}</p>}
      </section>
    </div>
  </>
}

function DesignCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = inventoryStatus(state)
  return <>
    <div className={css.computerCard} data-settings-anchor="design-readiness">
      <HeroHeader icon={IconEnhanceOutline16}
        title={t('designHeroTitle')}
        description={t('designHeroDescription')}
        badge={<Badge status={status}>{t(STATUS_KEYS[status])}</Badge>} />
      <p>{t('designPending')}</p>
      <RefreshButton {...props} />
    </div>
    <div className={css.computerHowTo} data-settings-anchor="design-usage">
      <h3>{t('designHowToUse')}</h3>
      <p>{t('designHowToUseDescription')}</p>
      <FeatureCards cards={DESIGN_CARDS} t={t} />
    </div>
  </>
}

function BrowserCapabilityBody(props: BodyProps & Pick<CapabilitySectionProps,
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
  list, definition, checkDevice, checkSdk, listMobileDevices, describeSecurity, useBrowserPreferences, saveBrowserPreferences,
  browserControls, useSecurityScope, saveSecurityScope, exportReport, useMobileSettings, saveMobileSettings, resetMobileSettings,
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
    const security = definition.id === 'security'
    setState({ phase: 'loading' })
    void Promise.resolve().then(() => Promise.all([
      list(),
      device === undefined ? undefined : checkDevice(device, abort.signal),
      security ? describeSecurity(abort.signal) : undefined,
    ])).then(
      ([snapshot, readiness, securityStatus]) => {
        if (current) setState({ phase: 'ready', components: capabilityComponents(snapshot.entries, CAPABILITY_MATCHERS[definition.id]), device: readiness, security: securityStatus })
      },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false; abort.abort() }
  }, [definition, list, checkDevice, describeSecurity, request])
  const body = { state, t, onRefresh: () => { setRequest(value => value + 1) } }
  return <section className={css.section} data-capability={definition.id} aria-busy={state.phase === 'loading'}>
    <header className={css.heading}><h1>{t(definition.titleKey)}</h1><p>{t(definition.descriptionKey)}</p></header>
    {state.phase === 'error' && <p className={css.failure} role="alert">{t('loadFailed')}</p>}
    {definition.id === 'security' ? <SecurityResearchBody {...body} useSecurityScope={useSecurityScope} saveSecurityScope={saveSecurityScope} {...exportReport === undefined ? {} : { exportReport }} />
      : definition.id === 'computer' ? <ComputerCapabilityBody {...body} />
        : definition.id === 'browser' ? <BrowserCapabilityBody
          {...body}
          useBrowserPreferences={useBrowserPreferences}
          saveBrowserPreferences={saveBrowserPreferences}
          resetBrowserPreferences={resetBrowserPreferences}
          useBrowserRouting={useBrowserRouting}
          saveBrowserRouting={saveBrowserRouting}
          resetBrowserRouting={resetBrowserRouting}
          browserControls={browserControls}
          {...target === undefined ? {} : { target }}
        />
          : definition.id === 'mobile' ? <MobileCapabilityBody {...body} checkSdk={checkSdk} listMobileDevices={listMobileDevices}
            useMobileSettings={useMobileSettings} saveMobileSettings={saveMobileSettings} resetMobileSettings={resetMobileSettings} />
            : <DesignCapabilityBody {...body} />}
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
