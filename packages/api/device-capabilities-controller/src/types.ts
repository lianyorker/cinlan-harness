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
