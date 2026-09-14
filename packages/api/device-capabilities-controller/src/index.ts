/** Read-only device readiness Remote; never installs software or performs device input. */
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-computer-use'
import type {} from '@deepseek-ai/dsh-mobile-device'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from 'zod'
import type { DeviceCapabilityRequest, DeviceCapabilityReason, DeviceCapabilitySnapshot, MobileSdkSnapshot, MobileDeviceListSnapshot, MobileDeviceSummary } from './types.ts'

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

  /**
   * Detect Android SDK and iOS Simulator availability without installing software.
   * @param signal - Caller cancellation.
   * @returns SDK detection results for the mobile emulator settings page.
   */
  @Remote('checkSdk')
  async checkSdk(signal: AbortSignal): Promise<MobileSdkSnapshot> {
    signal.throwIfAborted()
    const osPlatform = platform()
    return {
      platform: osPlatform,
      android: detectAndroidSdk(),
      ios: osPlatform === 'darwin' ? detectIosSimulator(signal) : null,
    }
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

function detectAndroidSdk(): { found: boolean; sdkPath: string | null; message: string } {
  const envPath = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (envPath !== undefined && envPath.length > 0 && existsSync(envPath)) {
    return { found: true, sdkPath: envPath, message: 'Found via ANDROID_HOME' }
  }
  const home = homedir()
  const candidates = [
    join(home, 'Library', 'Android', 'sdk'),
    join(home, 'AppData', 'Local', 'Android', 'Sdk'),
    join(home, '.android', 'sdk'),
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { found: true, sdkPath: candidate, message: 'Found in default location' }
  }
  return { found: false, sdkPath: null, message: 'Not found. Install Android Studio, then create a Virtual Device.' }
}

function detectIosSimulator(signal: AbortSignal): { simctlOk: boolean; message: string } {
  try {
    const result = spawn('xcrun', ['simctl', 'help'], { stdio: 'ignore', signal })
    result.kill()
    return { simctlOk: true, message: 'simctl available' }
  } catch {
    if (signal.aborted) return { simctlOk: false, message: 'Cancelled' }
    return { simctlOk: false, message: 'Install Xcode and add an iOS Simulator runtime.' }
  }
}

export default DeviceCapabilitiesController
