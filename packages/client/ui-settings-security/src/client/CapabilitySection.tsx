/** Host-backed settings section for one Cinlan capability family. */
import { useEffect, useState, type ReactNode } from 'react'
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
import type { DeviceCapabilityKind, DeviceCapabilitySnapshot, PluginInventorySnapshot, SecurityResearchSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
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
import { SecurityScopeEditor } from './SecurityScopeEditor.tsx'
import { SecurityReportExport } from './SecurityReportExport.tsx'
import { BrowserPreferencesForm } from './BrowserPreferencesForm.tsx'
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
  hooks: { browserPreferences: SettingsScope<BrowserPreferences>; securityScope: SettingsScope<SecurityResearchScopeSettings> }
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
      <p className={css.computerCardDescription}>{description}</p>
    </div>
  </div>
}

function ComputerCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <>
    <div className={css.computerCard}>
      <HeroHeader icon={IconBrowseOutline16} title={t('computerHeroTitle')} description={t('computerInstallDescription')}
        badge={<Badge status={status}>{t(DEVICE_STATUS_KEYS[status])}</Badge>} />
      <p className={css.computerCardDescription}>{deviceReason(state, t)}</p>
      <CopyText text={t('computerInstallCommand')} t={t} />
      <p className={css.capabilityFact}>{t('devicePrerequisite')}</p>
      <RefreshButton {...props} />
    </div>
    <div className={css.computerHowTo}>
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
  const presetMissing = security !== undefined && security.preset.present !== true && security.preset.broken === undefined
  const scopeStatusText = {
    configured: t('securityScopeConfigured'), expired: t('securityScopeExpired'),
    'not-yet-valid': t('securityScopeFuture'), empty: t('securityScopeEmpty'), missing: t('securityScopeMissing'),
  } satisfies Record<SecurityResearchSnapshot['scope']['state'], string>
  const scopeLabel = security === undefined ? t(unread) : scopeStatusText[security.scope.state]
  const skillLabel = security === undefined
    ? t(unread)
    : t(security.skillsComplete ? 'securitySkillsCount' : 'securitySkillsPartial', { count: security.skillCount })
  return <>
    <div className={css.computerCard}>
      <HeroHeader icon={IconSkillOutline16} title={t('securityHeroTitle')} description={t('securityHeroDescription')}
        badge={<Badge status={status}>{t(status === 'ready' ? 'securityConfigured'
          : status === 'missing' ? 'securityNotConfigured' : status === 'loading' ? 'securityStatusLoading' : 'securityAttention')}</Badge>} />
      <p className={css.computerCardDescription}>{t('securityPresetGuidance')}</p>
      <p className={css.capabilityFact}>{t('securityExecutionCaveat')}</p>
      <div className={css.securitySummary}>
        <div><strong>{t('securityPresetLabel')}</strong><span>{security === undefined ? t(unread) : security.preset.broken !== undefined ? t('securityPresetBroken')
          : t(security.preset.present ? 'securityPresetPresent' : 'securityPresetMissing')}</span></div>
        <div><strong>{t('securityScopeLabel')}</strong><span>{scopeLabel}</span></div>
        <div><strong>{t('securitySkillLabel')}</strong><span>{skillLabel}</span></div>
      </div>
      <RefreshButton {...props} />
    </div>
    {presetMissing && <div className={css.computerCard}>
      <h3>{t('securityInstallTitle')}</h3>
      <p>{t('securityInstallDescription')}</p>
      <CopyText text={t('securityCommand')} t={t} />
      <p className={css.capabilityFact}>{t('securityInstallHint')}</p>
    </div>}
    <div className={css.computerHowTo}>
      <h3>{t('securityHowToUse')}</h3><p>{t('securityHowToUseDescription')}</p>
      <FeatureCards cards={SECURITY_CARDS} t={t} />
      {!presetMissing && <SecurityScopeEditor useSecurityScope={props.useSecurityScope} saveSecurityScope={async (value, revision) => {
        await props.saveSecurityScope(value, revision)
        props.onRefresh()
      }} t={t} />}
      {!presetMissing && props.exportReport !== undefined && <SecurityReportExport exportReport={props.exportReport} t={t} />}
    </div>
  </>
}

function DesignCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = inventoryStatus(state)
  return <>
    <div className={css.computerCard}>
      <HeroHeader icon={IconEnhanceOutline16}
        title={t('designHeroTitle')}
        description={t('designHeroDescription')}
        badge={<Badge status={status}>{t(STATUS_KEYS[status])}</Badge>} />
      <p className={css.computerCardDescription}>{t('designPending')}</p>
      <RefreshButton {...props} />
    </div>
    <div className={css.computerHowTo}>
      <h3>{t('designHowToUse')}</h3>
      <p>{t('designHowToUseDescription')}</p>
      <FeatureCards cards={DESIGN_CARDS} t={t} />
    </div>
  </>
}

function BrowserCapabilityBody(props: BodyProps & Pick<CapabilitySectionProps, 'useBrowserPreferences' | 'saveBrowserPreferences' | 'browserControls'>): ReactNode {
  const { state, t } = props
  const configured = props.useBrowserPreferences(snapshot => snapshot.status === 'ready')
  const status = inventoryStatus(state)
  return <div className={css.setupCard}>
    <HeroHeader icon={IconGlobeOutline14} title={t('browserHeroTitle')} description={t('browserHeroDescription')}
      badge={<Badge status={status}>{t(STATUS_KEYS[status])}</Badge>} />
    <div className={css.setupNotice}><h4>{t('browserSessionTitle')}</h4><p>{t('browserSessionDescription')}</p></div>
    <ol className={css.steps}>
      <li className={css.step}><span className={css.stepNumber} aria-hidden="true">1</span><div>
        <h4>{t('browserProviderTitle')}</h4><p>{t('browserProviderDescription')}</p>
        <p>{t('browserProviderLimit')}</p>
        <BrowserPreferencesForm
          useBrowserPreferences={props.useBrowserPreferences}
          saveBrowserPreferences={props.saveBrowserPreferences}
          t={t}
        />
        <RefreshButton {...props} />
      </div></li>
      <li className={css.step}><span className={css.stepNumber} aria-hidden="true">2</span><div>
        <h4>{t('browserSkillTitle')}</h4><p>{t('browserSkillDescription')}</p>
      </div></li>
      <li className={css.step}><span className={css.stepNumber} aria-hidden="true">3</span><div>
        <h4>{t('browserCookieTitle')}</h4><p>{t('browserCookieDescription')}</p>
        <span className={css.capabilityFact}>{t('browserSessionOwner')}</span>
        {!configured || props.browserControls === undefined ? null : <BrowserControls callbacks={props.browserControls} t={t} />}
      </div></li>
    </ol>
    <div className={css.examples}><h4>{t('examplesTitle')}</h4><p>{t('browserExamplesDescription')}</p>
      <CopyText text={t('browserExample')} labelKey="copyExample" t={t} />
    </div>
  </div>
}

function MobileCapabilityBody(props: BodyProps): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <div className={css.setupCard}>
    <HeroHeader icon={IconPanelLeftOutline16} title={t('mobileHeroTitle')} description={t('mobileHeroDescription')}
      badge={<Badge status={status}>{t(DEVICE_STATUS_KEYS[status])}</Badge>} />
    <div className={css.availability}>
      <h4>{t('mobileAvailabilityTitle')}</h4><p>{deviceReason(state, t)}</p>
      <RefreshButton {...props} />
    </div>
    <dl className={css.facts}>
      <div><dt>{t('mobileSdkTitle')}</dt><dd>{t('mobileSdkDescription')}</dd></div>
      <div><dt>{t('mobileDefaultTitle')}</dt><dd>{t('mobileDefaultDescription')}</dd></div>
    </dl>
    <div className={css.agentSetup}>
      <h4>{t('mobileAgentControl')}</h4><p>{t('mobileHowToUseDescription')}</p>
      <ol className={css.steps}>
        <li className={css.step}><span className={css.stepNumber} aria-hidden="true">1</span><div>
          <h4>{t('mobileProviderTitle')}</h4><p>{t('devicePrerequisite')}</p>
          <CopyText text={t('computerInstallCommand')} t={t} />
        </div></li>
        <li className={css.step}><span className={css.stepNumber} aria-hidden="true">2</span><div>
          <h4>{t('mobileOperateTitle')}</h4><p>{t('mobileOperateDescription')}</p>
        </div></li>
      </ol>
      <div className={css.examples}><h4>{t('examplesTitle')}</h4>
        <CopyText text={t('mobileExample')} labelKey="copyExample" t={t} />
      </div>
    </div>
  </div>
}

/** Render a capability page through injected Host reads; no installation or device input occurs here.
 * @param props - Settings slot props and read-only capability callbacks.
 * @returns The localized capability page and collapsed component diagnostics.
 */
export function CapabilitySection({
  list, definition, checkDevice, describeSecurity, useBrowserPreferences, saveBrowserPreferences,
  browserControls, useSecurityScope, saveSecurityScope, exportReport, t,
}: CapabilitySectionProps): ReactNode {
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
    <header className={css.heading}><h2>{t(definition.titleKey)}</h2><p>{t(definition.descriptionKey)}</p></header>
    {state.phase === 'error' && <p className={css.failure} role="alert">{t('loadFailed')}</p>}
    {definition.id === 'security' ? <SecurityResearchBody {...body} useSecurityScope={useSecurityScope} saveSecurityScope={saveSecurityScope} {...exportReport === undefined ? {} : { exportReport }} />
      : definition.id === 'computer' ? <ComputerCapabilityBody {...body} />
        : definition.id === 'browser' ? <BrowserCapabilityBody
          {...body}
          useBrowserPreferences={useBrowserPreferences}
          saveBrowserPreferences={saveBrowserPreferences}
          browserControls={browserControls}
        />
          : definition.id === 'mobile' ? <MobileCapabilityBody {...body} />
            : <DesignCapabilityBody {...body} />}
    <details className={css.diagnostics}>
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
