/**
 * Provider-neutral Service Definition for mobile-device observation and input.
 * Providers own transport and short-lived observation state; Consumers own
 * permission policy, model tools, attachment persistence, and presentation.
 * @module @deepseek-ai/dsh-mobile-device
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema } from './settings.ts'
import type {
  Config,
  MobileButtonRequest,
  MobileDevice,
  MobileDeviceGeneration as MobileDeviceGenerationValue,
  MobileDeviceId as MobileDeviceIdValue,
  MobileDeviceProvider,
  MobileDeviceSettings,
  MobileMutationResult,
  MobileObservation,
  MobileObservationId as MobileObservationIdValue,
  MobileObserveRequest,
  MobileObserveSpec,
  MobileTouchRequest,
  MobileTypeRequest,
} from './types.ts'

export { MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema } from './settings.ts'
export type {
  Config,
  MobileButtonRequest,
  MobileDevice,
  MobileDeviceProvider,
  MobileDeviceSettings,
  MobileMutationRequest,
  MobileMutationResult,
  MobileObservation,
  MobileObserveRequest,
  MobileObserveSpec,
  MobileScreenshot,
  MobileScreenshotStatus,
  MobileTouchRequest,
  MobileTypeRequest,
} from './types.ts'

/** Exact provider-issued mobile device selector. */
export type MobileDeviceId = MobileDeviceIdValue

/**
 * Brand one provider-issued device selector.
 * @param value Provider-issued exact device id.
 * @returns Branded device id.
 */
export function MobileDeviceId(value: string): MobileDeviceId {
  return value as MobileDeviceId
}

/** Opaque generation of one provider-issued device instance. */
export type MobileDeviceGeneration = MobileDeviceGenerationValue

/**
 * Brand one provider-issued device generation.
 * @param value Provider-issued generation token.
 * @returns Branded device generation.
 */
export function MobileDeviceGeneration(value: string): MobileDeviceGeneration {
  return value as MobileDeviceGeneration
}

/** Opaque one-use observation token for one device generation. */
export type MobileObservationId = MobileObservationIdValue

/**
 * Brand one provider-issued observation token.
 * @param value Provider-issued one-use token.
 * @returns Branded observation id.
 */
export function MobileObservationId(value: string): MobileObservationId {
  return value as MobileObservationId
}

/** Typed mobile-device failure with a machine-routable open-string code. */
export class MobileDeviceError extends HarnessError {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mobileDevice: MobileDeviceRuntime
  }
}

const CONFIG_KEYS = new Set(['provider'])

function resolveConfig(config: Config): Config {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`mobile-device: unsupported config key '${key}'`)
  }
  if (config.provider !== undefined && (
    config.provider.length === 0
    || config.provider.trim() !== config.provider
  )) {
    throw new Error('mobile-device: provider must be a non-empty string without surrounding whitespace')
  }
  return config
}

/** Registry and execution facade for mobile-device Providers. */
export class MobileDeviceRuntime extends Service {
  static Config: z<Config> = z.object({ provider: z.string() })

  private readonly providers = new Map<string, MobileDeviceProvider>()
  private readonly providerId: string | undefined
  private settings: SettingsScope<MobileDeviceSettings> | undefined

  /** Create the provider-neutral mobile-device runtime. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mobileDevice')
    this.providerId = resolveConfig(config).provider
    ctx.inject(['settings'], (settingsCtx) => {
      this.settings = settingsCtx.settings.register(MOBILE_DEVICE_NAMESPACE, MobileDeviceSettingsSchema)
      settingsCtx.effect(() => () => { this.settings = undefined }, 'mobileDevice.settings()')
    })
  }

  /**
   * Read current resolved preferences without retaining a mutable settings reference.
   * @returns A detached settings value, or schema defaults when no settings service is mounted.
   */
  getPreferences(): MobileDeviceSettings {
    return { ...(this.settings?.get() ?? MobileDeviceSettingsSchema({} as never)) }
  }

  /**
   * Register one Provider for the calling plugin lifetime.
   * @param provider Provider implementation with a unique stable id.
   * @returns Disposer that removes the Provider registration.
   */
  registerProvider(provider: MobileDeviceProvider): () => void {
    if (provider.id.length === 0 || provider.id.trim() !== provider.id) {
      throw new MobileDeviceError('mobile-device provider id must be non-empty without surrounding whitespace', 'MOBILE_PROVIDER_ID_INVALID')
    }
    if (this.providers.has(provider.id)) {
      throw new MobileDeviceError(`mobile-device provider '${provider.id}' is already registered`, 'MOBILE_PROVIDER_DUPLICATE')
    }
    const dispose = this.ctx.effect(function* (this: MobileDeviceRuntime) {
      this.providers.set(provider.id, provider)
      yield () => { this.providers.delete(provider.id) }
    }.bind(this), 'mobileDevice.registerProvider()')
    return () => { void dispose() }
  }

  private provider(): MobileDeviceProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        throw new MobileDeviceError(`configured mobile-device provider '${this.providerId}' is not registered`, 'MOBILE_PROVIDER_CONFIGURED_MISSING')
      }
      if (!provider.available()) {
        throw new MobileDeviceError(`configured mobile-device provider '${this.providerId}' is unavailable`, 'MOBILE_PROVIDER_CONFIGURED_UNAVAILABLE')
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new MobileDeviceError('no usable mobile-device provider is registered', 'MOBILE_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      throw new MobileDeviceError(`multiple usable mobile-device providers are registered (${usable.map(provider => provider.id).join(', ')})`, 'MOBILE_PROVIDER_AMBIGUOUS')
    }
    return single
  }

  /**
   * List mobile devices visible to the selected Provider.
   * @param signal Cooperative cancellation signal.
   * @returns Canonical device records.
   */
  listDevices(signal?: AbortSignal): Promise<readonly MobileDevice[]> {
    return this.provider().listDevices(signal)
  }

  /**
   * Capture one fresh device observation.
   * @param request Explicit device or omitted id for the saved default, and screenshot preference.
   * @param signal Cooperative cancellation signal.
   * @returns Observation valid for one later mutation only.
   * @throws {MobileDeviceError} When an omitted target has no unique available saved default; no failure selects another device.
   */
  async observe(request: MobileObserveRequest, signal?: AbortSignal): Promise<MobileObservation> {
    const provider = this.provider()
    const preferences = this.getPreferences()
    const spec = await this.resolve(request, provider, preferences, signal)
    signal?.throwIfAborted()
    return provider.observe(spec, signal)
  }

  private async resolve(
    request: MobileObserveRequest,
    provider: MobileDeviceProvider,
    preferences: MobileDeviceSettings,
    signal?: AbortSignal,
  ): Promise<MobileObserveSpec> {
    signal?.throwIfAborted()
    if (request.deviceId !== undefined) {
      if (request.deviceId.length === 0 || request.deviceId.trim() !== request.deviceId) {
        throw new MobileDeviceError('mobile device id must be non-empty without surrounding whitespace', 'MOBILE_DEVICE_ID_INVALID')
      }
      return { ...request, deviceId: request.deviceId }
    }
    const deviceId = preferences.defaultDeviceId
    if (deviceId.length === 0) {
      throw new MobileDeviceError(
        'No default mobile device is configured; specify device_id or save a default device.',
        'MOBILE_DEFAULT_DEVICE_MISSING',
      )
    }
    if (deviceId.trim() !== deviceId) {
      throw new MobileDeviceError('saved default mobile device id has surrounding whitespace', 'MOBILE_DEFAULT_DEVICE_INVALID')
    }
    const devices = await provider.listDevices(signal)
    signal?.throwIfAborted()
    const matches = devices.filter(device => device.id === deviceId)
    if (matches.length > 1) {
      throw new MobileDeviceError(
        `saved default mobile device '${deviceId}' is ambiguous`,
        'MOBILE_DEFAULT_DEVICE_AMBIGUOUS',
      )
    }
    const device = matches[0]
    if (device === undefined) {
      throw new MobileDeviceError(`saved default mobile device '${deviceId}' was not found`, 'MOBILE_DEVICE_NOT_FOUND')
    }
    if (!device.isAvailable) {
      throw new MobileDeviceError(`saved default mobile device '${deviceId}' is unavailable`, 'MOBILE_DEVICE_UNAVAILABLE')
    }
    return { ...request, deviceId: device.id }
  }

  /**
   * Tap or swipe using one exact observation.
   * @param request Exact device, one-use token, and normalized coordinates.
   * @param signal Cooperative cancellation signal.
   * @returns Mutation acknowledgement; callers must observe again before another mutation.
   */
  touch(request: MobileTouchRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.provider().touch(request, signal)
  }

  /**
   * Type literal text using one exact observation.
   * @param request Exact device, one-use token, and text.
   * @param signal Cooperative cancellation signal.
   * @returns Mutation acknowledgement; callers must observe again before another mutation.
   */
  typeText(request: MobileTypeRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.provider().typeText(request, signal)
  }

  /**
   * Press one device navigation button using an exact observation.
   * @param request Exact device, one-use token, and button name.
   * @param signal Cooperative cancellation signal.
   * @returns Mutation acknowledgement; callers must observe again before another mutation.
   */
  pressButton(request: MobileButtonRequest, signal?: AbortSignal): Promise<MobileMutationResult> {
    return this.provider().pressButton(request, signal)
  }
}

export default MobileDeviceRuntime
