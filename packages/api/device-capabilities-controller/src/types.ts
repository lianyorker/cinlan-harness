/** Browser-safe results of read-only device Provider readiness checks. */

import type { ComputerCapabilities, ComputerToolReadiness } from '@deepseek-ai/dsh-computer-use'

/** Read-only descriptor of the selected local Computer Use provider; permissions are not probed. */
export type ComputerCapabilityObservation = ComputerToolReadiness | {
  readonly kind: 'facade'
  readonly platform: string
  readonly provider: string
  readonly providerVersion: string
  readonly protocolVersion: number
  readonly supports: ComputerCapabilities['supports']
  readonly permissions: 'unknown'
}

/** Deployment bounds for managed SDK readiness commands. */
export interface Config {
  /** Total executable lookup and command deadline for one check; defaults to 5 seconds. */
  readonly probeTimeoutMs?: number
  /** Process-range termination and output-drain grace; defaults to 1 second. */
  readonly probeGraceMs?: number
  /** Maximum retained bytes per stdout/stderr stream; defaults to 64 KiB. */
  readonly maxProbeOutputBytes?: number
}

/** Device families supported by the readiness controller. */
export type DeviceCapabilityKind = 'computer' | 'mobile'

/** Exact device family selected in Settings. */
export interface DeviceCapabilityRequest {
  readonly capability: DeviceCapabilityKind
}

/** Readiness is separate from Loader activation and software installation. */
export type DeviceCapabilityStatus = 'not-configured' | 'available' | 'unavailable'

/** Redacted reasons; command paths, device identities, and input content are never returned. */
export type DeviceCapabilityReason = 'not-configured' | 'cli-missing' | 'provider-unavailable' | 'protocol-error' | 'probe-failed' | 'no-devices' | 'provider-initializing' | 'provider-disposing' | 'provider-failed'

/** Result of one explicit Provider probe; action permissions are not tested. */
export interface DeviceCapabilitySnapshot {
  readonly capability: DeviceCapabilityKind
  readonly status: DeviceCapabilityStatus
  readonly reason: DeviceCapabilityReason | null
  /** Provider catalog lifecycle or successful facade capability observation. */
  readonly computer?: ComputerCapabilityObservation
}

/** Android SDK detection result. */
export interface AndroidSdkAvailability {
  readonly found: boolean
  readonly sdkPath: string | null
  readonly message: string
}

/** iOS Simulator detection result (macOS only). */
export interface IosSimulatorAvailability {
  readonly simctlOk: boolean
  readonly message: string
}

/** SDK availability snapshot for the mobile emulator settings page. */
export interface MobileSdkSnapshot {
  readonly platform: string
  readonly android: AndroidSdkAvailability
  readonly ios: IosSimulatorAvailability | null
}

/** One redacted mobile device for the default-device selector. */
export interface MobileDeviceSummary {
  readonly id: string
  readonly name: string
  readonly state: string
  readonly isAvailable: boolean
}

/** Result of listing mobile devices for the settings UI. */
export interface MobileDeviceListSnapshot {
  readonly devices: readonly MobileDeviceSummary[]
  readonly available: boolean
}
