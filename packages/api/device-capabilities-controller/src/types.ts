/** Browser-safe results of read-only device Provider readiness checks. */

/** Device families supported by the readiness controller. */
export type DeviceCapabilityKind = 'computer' | 'mobile'

/** Exact device family selected in Settings. */
export interface DeviceCapabilityRequest {
  readonly capability: DeviceCapabilityKind
}

/** Readiness is separate from Loader activation and software installation. */
export type DeviceCapabilityStatus = 'not-configured' | 'available' | 'unavailable'

/** Redacted reasons; command paths, device identities, and input content are never returned. */
export type DeviceCapabilityReason = 'not-configured' | 'cli-missing' | 'provider-unavailable' | 'protocol-error' | 'probe-failed' | 'no-devices'

/** Result of one explicit Provider probe; action permissions are not tested. */
export interface DeviceCapabilitySnapshot {
  readonly capability: DeviceCapabilityKind
  readonly status: DeviceCapabilityStatus
  readonly reason: DeviceCapabilityReason | null
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
