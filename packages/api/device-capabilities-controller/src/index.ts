/** Read-only device readiness Remote; never installs software or performs device input. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-mobile-device'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import { SdkProbeConfig, SdkProbes } from './sdk-probes.ts'
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
