/** Read-only device readiness Remote; never installs software or performs device input. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-mobile-device'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { DeviceCapabilityRequest, DeviceCapabilityReason, DeviceCapabilitySnapshot } from './types.ts'

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

  /** @param ctx - Host context with optional Computer Use and Mobile Device services. */
  constructor(ctx: Context) {
    super(ctx, 'deviceCapabilitiesController', { namespace: 'deviceCapabilities' })
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
        await service.capabilities(signal)
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
