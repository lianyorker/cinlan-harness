/** Type-only declarations for provider-neutral mobile-device control. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Exact provider-issued mobile device selector. */
export type MobileDeviceId = Branded<'MobileDeviceId'>

/** Opaque generation of one provider-issued device instance. */
export type MobileDeviceGeneration = Branded<'MobileDeviceGeneration'>

/** Opaque one-use observation token for one device generation. */
export type MobileObservationId = Branded<'MobileObservationId'>

/** Canonical mobile device published by a Provider. */
export interface MobileDevice {
  readonly backend: string
  readonly id: MobileDeviceId
  readonly name: string
  readonly state: string
  readonly isAvailable: boolean
  readonly detail?: string
}

/** One validated PNG screenshot before Consumer-owned attachment persistence. */
export interface MobileScreenshot {
  readonly mediaType: 'image/png'
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

/** Explicit screenshot outcome accompanying an observation. */
export type MobileScreenshotStatus =
  | { readonly state: 'captured' }
  | { readonly state: 'skipped' }
  | { readonly state: 'failed'; readonly code: string; readonly message: string }

/** One fresh mobile-device observation. */
export interface MobileObservation {
  readonly device: MobileDevice
  readonly deviceGeneration: MobileDeviceGeneration
  readonly observationId: MobileObservationId
  readonly coordinateSpace: 'normalized'
  readonly tree: string
  readonly screenshot?: MobileScreenshot
  readonly screenshotStatus: MobileScreenshotStatus
}

/** Durable preferences owned by the mobile-device capability. */
export interface MobileDeviceSettings {
  /** Saved preference, not operation authorization or Provider activation. */
  enabled: boolean
  /** Exact default observation target; an empty string requires an explicit id. */
  defaultDeviceId: string
  /** Local SDK probe preference; does not configure an external device backend. */
  androidSdkPath: string
}

/** Observation request; an omitted id selects the saved default, never an arbitrary device. */
export interface MobileObserveRequest {
  readonly deviceId?: MobileDeviceId
  readonly captureScreenshot?: boolean
}

/** Fully resolved observation target passed to one selected Provider. */
export interface MobileObserveSpec extends MobileObserveRequest {
  readonly deviceId: MobileDeviceId
}

/** Shared exact target and one-use token for a mobile mutation. */
export interface MobileMutationRequest {
  readonly deviceId: MobileDeviceId
  readonly observationId: MobileObservationId
}

/** Tap or swipe request using normalized `0..1` coordinates. */
export type MobileTouchRequest = MobileMutationRequest & (
  | { readonly kind: 'tap'; readonly x: number; readonly y: number }
  | {
    readonly kind: 'swipe'
    readonly fromX: number
    readonly fromY: number
    readonly toX: number
    readonly toY: number
  }
)

/** Request to type literal text at the current device focus. */
export interface MobileTypeRequest extends MobileMutationRequest {
  readonly text: string
}

/** Request to press one provider-supported device button. */
export interface MobileButtonRequest extends MobileMutationRequest {
  readonly button: string
}

/** Acknowledgement that one exact observation token was consumed. */
export interface MobileMutationResult {
  readonly device: MobileDevice
  readonly deviceGeneration: MobileDeviceGeneration
  readonly observationId: MobileObservationId
}

/** Swappable mobile-device Provider contract. */
export interface MobileDeviceProvider {
  readonly id: string
  /** Return whether this Provider still accepts calls. */
  available(): boolean
  /** List canonical mobile devices currently known to the Provider. */
  listDevices(signal?: AbortSignal): Promise<readonly MobileDevice[]>
  /** Capture one fresh device observation. */
  observe(request: MobileObserveSpec, signal?: AbortSignal): Promise<MobileObservation>
  /** Perform one observation-bound tap or swipe. */
  touch(request: MobileTouchRequest, signal?: AbortSignal): Promise<MobileMutationResult>
  /** Type literal text through an observation-bound input operation. */
  typeText(request: MobileTypeRequest, signal?: AbortSignal): Promise<MobileMutationResult>
  /** Press one observation-bound device navigation button. */
  pressButton(request: MobileButtonRequest, signal?: AbortSignal): Promise<MobileMutationResult>
}

/** Mobile-device runtime configuration. */
export interface Config {
  /** Exact Provider id; omit only when exactly one available Provider is registered. */
  readonly provider?: string
}
