/**
 * Provider-neutral Service Definition for mobile-device observation and input.
 * Providers own transport and short-lived observation state; Consumers own
 * permission policy, model tools, attachment persistence, and presentation.
 * @module @deepseek-ai/dsh-mobile-device
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {
  Config,
  MobileButtonRequest,
  MobileDevice,
  MobileDeviceGeneration as MobileDeviceGenerationValue,
  MobileDeviceId as MobileDeviceIdValue,
  MobileDeviceProvider,
  MobileMutationResult,
  MobileObservation,
  MobileObservationId as MobileObservationIdValue,
  MobileObserveRequest,
  MobileTouchRequest,
  MobileTypeRequest,
} from './types.ts'

export type {
  Config,
  MobileButtonRequest,
  MobileDevice,
  MobileDeviceProvider,
  MobileMutationRequest,
  MobileMutationResult,
  MobileObservation,
  MobileObserveRequest,
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

  /** Create the provider-neutral mobile-device runtime. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'mobileDevice')
    this.providerId = resolveConfig(config).provider
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
   * @param request Exact device and screenshot preference.
   * @param signal Cooperative cancellation signal.
   * @returns Observation valid for one later mutation only.
   */
  observe(request: MobileObserveRequest, signal?: AbortSignal): Promise<MobileObservation> {
    return this.provider().observe(request, signal)
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
