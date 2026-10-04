/** Host-backed settings section for the Mobile Emulator. */
import { useEffect, useState, type ReactNode } from 'react'
import type { DeviceCapabilityKind, DeviceCapabilitySnapshot, MobileSdkSnapshot, MobileDeviceListSnapshot } from '@deepseek-ai/dsh-api-device-capabilities-controller/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './CapabilitySection.module.css'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MobileDeviceSettings } from '@deepseek-ai/dsh-mobile-device/types'
import type { ProviderActivationCallbacks } from './capability-shared.ts'
import { MobilePreferences } from './MobilePreferences.tsx'
import { MobileAgentCard } from './MobileAgentCard.tsx'
import { MobileResourcesSection, type MobileResourcesInjected, type MobileResourcesProps } from './MobileResourcesSection.tsx'

/** Capability pages contributed by this product plugin. */
export type CapabilityId = 'mobile'

/** Registration metadata for one capability page. */
export interface CapabilityDefinition {
  readonly id: CapabilityId
  readonly navKey: CapabilitySettingsKey
  readonly titleKey: CapabilitySettingsKey
  readonly descriptionKey: CapabilitySettingsKey
  readonly order: number
}

/** Stable product capability roster. */
export const MOBILE_CAPABILITY = { id: 'mobile', navKey: 'mobileNav', titleKey: 'mobileTitle', descriptionKey: 'mobileDescription', order: 70 } as const

export const CAPABILITIES: readonly CapabilityDefinition[] = [MOBILE_CAPABILITY] as const

/** Inputs shared by capability registrations. */
interface CapabilitySectionShared extends ProviderActivationCallbacks {
  /** Page registration metadata. */
  definition: CapabilityDefinition
}

/** Required Mobile registration inputs and renderer-bound sources. */
export interface MobileSectionInjected extends CapabilitySectionShared, MobileResourcesInjected {
  definition: typeof MOBILE_CAPABILITY
  checkDevice: (capability: DeviceCapabilityKind, signal: AbortSignal) => Promise<DeviceCapabilitySnapshot>
  /** Settings-owned sources bound by the renderer. */
  hooks: MobileResourcesInjected['hooks'] & {
    mobileSettings: SettingsScope<MobileDeviceSettings>
  }
  /** Persist stored mobile preferences with their opening revision. */
  saveMobileSettings: (value: MobileDeviceSettings, revision: number) => Promise<void>
  /** Remove mobile preference overrides. */
  resetMobileSettings: (revision: number) => Promise<void>
  /** Detect Android SDK and iOS Simulator availability. */
  checkSdk: (signal: AbortSignal) => Promise<MobileSdkSnapshot>
  /** List mobile devices for the default-device selector. */
  listMobileDevices: (signal: AbortSignal) => Promise<MobileDeviceListSnapshot>
}

/** Each feature supplies only its own required inputs. */
export type CapabilitySectionInjected = MobileSectionInjected

/** Shared renderer props preserve each feature's required inputs. */
export type CapabilitySectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.cinlanCapabilities'>
  & InjectFace<CapabilitySectionInjected>

type ViewState =
  | { readonly phase: 'loading' }
  | { readonly phase: 'error' }
  | { readonly phase: 'ready'; readonly device: DeviceCapabilitySnapshot | undefined }

const DEVICE_STATUS_KEYS = {
  available: 'deviceAvailable',
  unavailable: 'deviceUnavailable',
  'not-configured': 'deviceNotConfigured',
  checking: 'deviceChecking',
} as const satisfies Record<DeviceCapabilitySnapshot['status'] | 'checking', CapabilitySettingsKey>

function deviceStatus(state: ViewState): DeviceCapabilitySnapshot['status'] | 'checking' {
  if (state.phase === 'loading') return 'checking'
  /* v8 ignore next -- the Mobile page always passes checkDevice, so a ready state carries its probe snapshot. */
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
    'provider-initializing': 'mobileProviderStarting',
    'provider-disposing': 'mobileProviderStopping',
    'provider-failed': 'mobileProviderFailed',
  } as const
  /* v8 ignore next -- the Mobile page always passes checkDevice, so a ready state carries its probe reason. */
  return t(reason === undefined ? 'deviceNotConfiguredDescription' : keys[reason])
}

interface BodyProps {
  /** Reload counter the page bumps whenever an action must re-read Host state. */
  revision: number
  state: ViewState
  t: CapabilitySectionProps['t']
  onRefresh: () => void
}

function MobileCapabilityBody(props: BodyProps & Pick<InjectFace<MobileSectionInjected>,
  'checkSdk' | 'listMobileDevices' | 'useMobileSettings' | 'saveMobileSettings' | 'resetMobileSettings'
  | 'listProviderEntries' | 'setProviderEnabled'> & MobileResourcesProps): ReactNode {
  const { state, t } = props
  const status = deviceStatus(state)
  return <div className={css.setupCard}>
    <MobilePreferences useMobileSettings={props.useMobileSettings} saveMobileSettings={props.saveMobileSettings}
      resetMobileSettings={props.resetMobileSettings} checkSdk={props.checkSdk} listMobileDevices={props.listMobileDevices}
      t={t} availability={{ status, statusKey: DEVICE_STATUS_KEYS[status], reason: deviceReason(state, t),
        checking: state.phase === 'loading', onRefresh: props.onRefresh }} />
    <MobileAgentCard listProviderEntries={props.listProviderEntries} setProviderEnabled={props.setProviderEnabled}
      onChanged={props.onRefresh} revision={props.revision} t={t} />
    <MobileResourcesSection {...props} />
    <p>{t('devicePrerequisite')}</p>
  </div>
}

/** Render the Mobile Emulator page through injected Host reads; no installation or device input occurs here.
 * @param props - Settings slot hooks, preference callbacks, and the read-only device probe.
 * @returns The localized Mobile Emulator page.
 */
export function CapabilitySection(props: CapabilitySectionProps): ReactNode {
  const { checkDevice, definition, t } = props
  const [request, setRequest] = useState(0)
  const [state, setState] = useState<ViewState>({ phase: 'loading' })
  useEffect(() => {
    let current = true
    const abort = new AbortController()
    setState({ phase: 'loading' })
    void checkDevice(definition.id, abort.signal).then(
      (device) => { if (current) setState({ phase: 'ready', device }) },
      () => { if (current) setState({ phase: 'error' }) },
    )
    return () => { current = false; abort.abort() }
  }, [definition, checkDevice, request])
  const body = { state, t, revision: request, onRefresh: () => { setRequest(value => value + 1) } }
  return <section className={css.section} data-capability={definition.id} aria-busy={state.phase === 'loading'}>
    <header className={css.heading}><h1>{t(definition.titleKey)}</h1><p>{t(definition.descriptionKey)}</p></header>
    {state.phase === 'error' && <p className={css.failure} role="alert">{t('loadFailed')}</p>}
    <MobileCapabilityBody {...props} {...body} />
  </section>
}
