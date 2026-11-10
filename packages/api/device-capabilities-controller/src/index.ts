/** Read-only device readiness Remote; never installs software or performs device input. */
import { Context } from '@deepseek-ai/cordis'
import type { ComputerPermissionStatus } from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-mobile-device'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { requireLocalOperator } from './local-operator.ts'
import type {} from 'zod'
import { SdkProbeConfig, SdkProbes } from './sdk-probes.ts'
import { localMobileRuntime } from './mobile-resources.ts'
import type { MobileResourceRequest, MobileResourceTask, MobileResourceTaskId, MobileMirrorId, MobileMirrorStatus, MobileRuntimeStatus } from '@deepseek-ai/dsh-mobile-device-runtime'
import type { Config, DeviceCapabilityRequest, DeviceCapabilityReason, DeviceCapabilitySnapshot, MobileSdkSnapshot, MobileDeviceListSnapshot, MobileDeviceSummary } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of read-only device Provider readiness. */
    deviceCapabilitiesController: DeviceCapabilitiesController
  }
}

/** Probe the selected Provider without exposing desktop content or device identities. */
export class DeviceCapabilitiesController extends TypertRemoteService {
  static inject = ['typert']
  static Config = SdkProbeConfig

  /** Read the desktop OS permission state for Computer Use.
   * @param signal - Cancels only this observation.
   * @returns Current OS permission facts from the selected provider.
   */
  @Remote('computerPermissionStatus')
  async computerPermissionStatus(signal: AbortSignal): Promise<ComputerPermissionStatus> {
    requireLocalOperator(this.ctx)
    signal.throwIfAborted()
    return this.computerPermissionControls().permissionStatus(signal)
  }
  /** Request a desktop OS privilege through the provider's dialog flow.
   * @param signal - Cancels the pending native request.
   * @returns Permission state after the native request settles.
   */
  @Remote('requestComputerPermissions')
  async requestComputerPermissions(signal: AbortSignal): Promise<ComputerPermissionStatus> {
    requireLocalOperator(this.ctx)
    signal.throwIfAborted()
    return this.computerPermissionControls().requestPermissions(signal)
  }
  /** Open the OS screen-recording settings pane.
   * @param signal - Cancels the pending open request.
   * @returns Whether the OS accepted the open request.
   */
  @Remote('openComputerScreenRecordingSettings')
  async openComputerScreenRecordingSettings(signal: AbortSignal): Promise<boolean> {
    requireLocalOperator(this.ctx)
    signal.throwIfAborted()
    return this.computerPermissionControls().openScreenRecordingSettings(signal)
  }

  /** Resolve the Computer Use runtime for authenticated desktop permission work.
   * @returns The runtime; an unconfigured Host fails loud before any native request.
   */
  private computerPermissionControls(): {
    permissionStatus: (signal: AbortSignal) => Promise<ComputerPermissionStatus>
    requestPermissions: (signal: AbortSignal) => Promise<ComputerPermissionStatus>
    openScreenRecordingSettings: (signal: AbortSignal) => Promise<boolean>
  } {
    const service = this.ctx.get('computerUse')
    if (service === undefined) throw new Error('Computer Use is not configured on this Host')
    return service
  }

  /** Read native Android resources and connections from the local Host.
   * @param signal - Cancels only this observation.
   * @returns Resource and connection facts, independent from Provider activation.
   */
  @Remote('mobileRuntimeStatus')
  async mobileRuntimeStatus(signal: AbortSignal): Promise<MobileRuntimeStatus> {
    return localMobileRuntime(this.ctx).status(signal)
  }
  /** Start an explicit local component transaction.
   * @param request - Reviewed resource, operation, revision, and license acceptance.
   * @param signal - Admission cancellation.
   * @returns Host-owned task receipt.
   */
  @Remote('startMobileResource')
  async startMobileResource(request: MobileResourceRequest, signal: AbortSignal): Promise<MobileResourceTask> {
    return await Promise.resolve(localMobileRuntime(this.ctx).start(request, signal))
  }
  /** Cancel and join the exact displayed resource task.
   * @param request - Task receipt identity.
   * @param signal - Admission cancellation.
   * @returns Settled task after cleanup.
   */
  @Remote('cancelMobileResource')
  async cancelMobileResource(request: { taskId: MobileResourceTaskId }, signal: AbortSignal): Promise<MobileResourceTask> {
    signal.throwIfAborted(); return localMobileRuntime(this.ctx).cancel(request.taskId)
  }
  /** Open an owned native mirror window for one exact device.
   * @param request - Android identity from the connection inventory.
   * @param signal - Admission cancellation.
   * @returns Mirror process receipt, without claiming visible hardware acceptance.
   */
  @Remote('startMobileMirror')
  async startMobileMirror(request: { deviceId: string }, signal: AbortSignal): Promise<MobileMirrorStatus> {
    return await Promise.resolve(localMobileRuntime(this.ctx).startMirror(request.deviceId, signal))
  }
  /** Close only the native mirror owned by this receipt.
   * @param request - Exact mirror identity.
   * @param signal - Admission cancellation.
   * @returns Closed mirror facts after process-range settlement.
   */
  @Remote('closeMobileMirror')
  async closeMobileMirror(request: { mirrorId: MobileMirrorId }, signal: AbortSignal): Promise<MobileMirrorStatus> {
    signal.throwIfAborted(); return localMobileRuntime(this.ctx).closeMirror(request.mirrorId)
  }

  private readonly sdk: SdkProbes

  /**
   * @param ctx - Host context with optional device and subprocess services.
   * @param config - Bounds for read-only SDK executable checks.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'deviceCapabilitiesController', { namespace: 'deviceCapabilities' })
    this.sdk = new SdkProbes(ctx, config)
  }

  /**
   * Check Provider reachability independently from plugin activation.
   * @param request - Device family to check.
   * @param signal - Caller cancellation forwarded to the read-only Provider operation.
   * @returns Readiness and a redacted failure category, never installation or action authorization.
   */
  @Remote('check')
  async check(request: DeviceCapabilityRequest, signal: AbortSignal): Promise<DeviceCapabilitySnapshot> {
    signal.throwIfAborted()
    const capability = request.capability
    try {
      if (capability === 'computer') {
        const service = this.ctx.get('computerUse')
        if (service === undefined) return { capability, status: 'not-configured', reason: 'not-configured' }
        const readiness = await service.readiness(signal)
        signal.throwIfAborted()
        if (readiness.kind === 'tool-catalog') {
          return { capability, status: readiness.state === 'ready' ? 'available' : 'unavailable',
            reason: readiness.state === 'ready' ? null : `provider-${readiness.state}`, computer: readiness }
        }
        const descriptor = readiness.capabilities
        return { capability, status: 'available', reason: null, computer: {
          kind: 'facade', platform: descriptor.platform, provider: descriptor.provider,
          providerVersion: descriptor.providerVersion, protocolVersion: descriptor.protocolVersion,
          supports: descriptor.supports, permissions: 'unknown',
        } }
      } else {
        const service = this.ctx.get('mobileDevice')
        if (service === undefined) return { capability, status: 'not-configured', reason: 'not-configured' }
        const devices = await service.listDevices(signal)
        signal.throwIfAborted()
        if (!devices.some(device => device.isAvailable)) return { capability, status: 'unavailable', reason: 'no-devices' }
      }
      signal.throwIfAborted()
      return { capability, status: 'available', reason: null }
    } catch (error) {
      signal.throwIfAborted()
      return { capability, status: 'unavailable', reason: failureReason(error) }
    }
  }

  /**
   * Detect Android SDK and iOS Simulator availability without installing software.
   * @param signal - Caller cancellation.
   * @returns SDK detection results for the mobile emulator settings page.
   */
  @Remote('checkSdk')
  async checkSdk(signal: AbortSignal): Promise<MobileSdkSnapshot> {
    return await this.sdk.check(signal)
  }

  /**
   * List mobile devices for the default-device selector; redacted to id/name/state/available.
   * @param signal - Caller cancellation forwarded to the Provider.
   * @returns Redacted device list and Provider availability.
   */
  @Remote('listMobileDevices')
  async listMobileDevices(signal: AbortSignal): Promise<MobileDeviceListSnapshot> {
    signal.throwIfAborted()
    const service = this.ctx.get('mobileDevice')
    if (service === undefined) return { devices: [], available: false }
    try {
      const devices = await service.listDevices(signal)
      signal.throwIfAborted()
      const summaries: MobileDeviceSummary[] = devices.map(device => ({
        id: String(device.id),
        name: device.name,
        state: device.state,
        isAvailable: device.isAvailable,
      }))
      return { devices: summaries, available: true }
    } catch {
      signal.throwIfAborted()
      return { devices: [], available: false }
    }
  }
}

function failureReason(error: unknown): DeviceCapabilityReason {
  const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (typeof code !== 'string') return 'probe-failed'
  if (code.endsWith('_CLI_UNAVAILABLE')) return 'cli-missing'
  if (code.includes('_PROVIDER_')) return 'provider-unavailable'
  if (code.endsWith('_PROTOCOL')) return 'protocol-error'
  return 'probe-failed'
}


export default DeviceCapabilitiesController
