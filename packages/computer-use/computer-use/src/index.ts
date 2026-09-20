/**
 * Provider-neutral Service Definition for local desktop Computer Use. Providers
 * own platform transport and short-lived observation state; Consumers own
 * permission policy, model tools, attachment persistence, and presentation.
 * @module @deepseek-ai/dsh-computer-use
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ComputerUseProviderName } from './brand.ts'

import type {
  ComputerActionResult,
  ComputerApp,
  ComputerAppId as ComputerAppIdValue,
  ComputerCapabilities,
  ComputerClickRequest,
  ComputerDragRequest,
  ComputerElementId as ComputerElementIdValue,
  ComputerHotkeyRequest,
  ComputerListWindowsRequest,
  ComputerObservation,
  ComputerObservationId as ComputerObservationIdValue,
  ComputerObserveRequest,
  ComputerPasteTextRequest,
  ComputerPressKeyRequest,
  ComputerScrollRequest,
  ComputerSecondaryActionRequest,
  ComputerSetValueRequest,
  ComputerTypeTextRequest,
  ComputerUseProvider,
  ComputerWindow,
  ComputerWindowId as ComputerWindowIdValue,
  Config,
} from './types.ts'

export { ComputerUseProviderName } from './brand.ts'

export type {
  ComputerActionMetadata,
  ComputerActionRequest,
  ComputerActionResult,
  ComputerActionVerification,
  ComputerApp,
  ComputerCapabilities,
  ComputerClickRequest,
  ComputerDragRequest,
  ComputerDragTarget,
  ComputerElement,
  ComputerHotkeyRequest,
  ComputerListWindowsRequest,
  ComputerMouseButton,
  ComputerObservation,
  ComputerObservationTruncation,
  ComputerObserveRequest,
  ComputerPasteTextRequest,
  ComputerPointerTarget,
  ComputerPressKeyRequest,
  ComputerScreenshot,
  ComputerScreenshotStatus,
  ComputerScrollDirection,
  ComputerScrollRequest,
  ComputerSecondaryActionRequest,
  ComputerSetValueRequest,
  ComputerTypeTextRequest,
  ComputerUseProvider,
  ComputerWindow,
  Config,
} from './types.ts'

/** Stable provider-issued desktop application selector. */
export type ComputerAppId = ComputerAppIdValue

/**
 * Brand one provider-issued desktop application selector.
 * @param value Provider-issued selector.
 * @returns Branded application id.
 */
export function ComputerAppId(value: string): ComputerAppId {
  return value as ComputerAppId
}

/** Stable provider-issued window selector. */
export type ComputerWindowId = ComputerWindowIdValue

/**
 * Brand one provider-issued window selector.
 * @param value Provider-issued selector.
 * @returns Branded window id.
 */
export function ComputerWindowId(value: string): ComputerWindowId {
  return value as ComputerWindowId
}

/** Identifier for one short-lived accessibility observation. */
export type ComputerObservationId = ComputerObservationIdValue

/**
 * Brand one provider-issued observation identifier.
 * @param value Provider-issued identifier.
 * @returns Branded observation id.
 */
export function ComputerObservationId(value: string): ComputerObservationId {
  return value as ComputerObservationId
}

/** Element identifier valid only within one observation. */
export type ComputerElementId = ComputerElementIdValue

/**
 * Brand one observation-scoped element identifier.
 * @param value Observation-scoped identifier.
 * @returns Branded element id.
 */
export function ComputerElementId(value: string): ComputerElementId {
  return value as ComputerElementId
}

/** Typed Computer Use failure with a machine-routable open-string code. */
export class ComputerUseError extends HarnessError {}

declare module '@deepseek-ai/cordis' {
  interface Context {
    computerUse: ComputerUseRuntime
  }
}

const CONFIG_KEYS = new Set(['provider'])

function resolveConfig(config: Config): Config {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`computer-use: unsupported config key '${key}'`)
  }
  if (config.provider !== undefined && (
    config.provider.length === 0
    || config.provider.trim() !== config.provider
  )) {
    throw new Error('computer-use: provider must be a non-empty string without surrounding whitespace')
  }
  return config
}

/** Registry and execution facade for desktop Computer Use providers. */
export class ComputerUseRuntime extends Service {
  static Config: z<Config> = z.object({ provider: z.string() })

  private registration: ComputerUseProviderName | undefined
  private readonly providers = new Map<string, ComputerUseProvider>()
  private readonly providerId: string | undefined

  /** Create the provider-neutral Computer Use runtime. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'computerUse')
    this.providerId = resolveConfig(config).provider
  }

  /** Name of the exclusive tool provider, retained until its resources finish closing. */
  get providerName(): ComputerUseProviderName | undefined {
    return this.registration
  }

  /**
   * Reserve computer use for a provider that publishes its own tools.
   * Registered facade providers also occupy computer use, including unavailable ones.
   * The caller must remove its tools and await owned work before releasing this effect.
   * @param name Provider-owned name used in registration diagnostics.
   * @returns Effect disposer for this exact exclusive registration.
   */
  register(name: ComputerUseProviderName): () => Promise<void> {
    if (this.registration !== undefined || this.providers.size > 0) {
      const current = this.registration ?? [...this.providers.keys()].join(', ')
      throw new ComputerUseError(
        `computer use provider "${current}" is already registered`,
        'COMPUTER_PROVIDER_EXCLUSIVE',
      )
    }
    return this.ctx.effect(() => {
      this.registration = name
      return () => { this.registration = undefined }
    }, 'computerUse.register()')
  }

  /**
   * Register one provider for the calling plugin lifetime.
   * @param provider Provider implementation with a unique stable id.
   * @returns Disposer that removes the provider registration.
   */
  registerProvider(provider: ComputerUseProvider): () => void {
    if (this.registration !== undefined) {
      throw new ComputerUseError(
        `computer use provider "${this.registration}" is already registered`,
        'COMPUTER_PROVIDER_EXCLUSIVE',
      )
    }
    if (provider.id.length === 0 || provider.id.trim() !== provider.id) {
      throw new ComputerUseError('computer-use provider id must be non-empty without surrounding whitespace', 'COMPUTER_PROVIDER_ID_INVALID')
    }
    if (this.providers.has(provider.id)) {
      throw new ComputerUseError(`computer-use provider '${provider.id}' is already registered`, 'COMPUTER_PROVIDER_DUPLICATE')
    }
    const dispose = this.ctx.effect(function* (this: ComputerUseRuntime) {
      this.providers.set(provider.id, provider)
      yield () => { this.providers.delete(provider.id) }
    }.bind(this), 'computerUse.registerProvider()')
    // oxlint-disable-next-line typescript/no-misused-promises -- Preserve public callback type and Cordis disposer metadata.
    return dispose
  }

  private provider(): ComputerUseProvider {
    if (this.providerId !== undefined) {
      const provider = this.providers.get(this.providerId)
      if (provider === undefined) {
        throw new ComputerUseError(`configured computer-use provider '${this.providerId}' is not registered`, 'COMPUTER_PROVIDER_CONFIGURED_MISSING')
      }
      if (!provider.available()) {
        throw new ComputerUseError(`configured computer-use provider '${this.providerId}' is unavailable`, 'COMPUTER_PROVIDER_CONFIGURED_UNAVAILABLE')
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider => provider.available())
    const [single] = usable
    if (single === undefined) {
      throw new ComputerUseError('no usable computer-use provider is registered', 'COMPUTER_PROVIDER_UNAVAILABLE')
    }
    if (usable.length > 1) {
      throw new ComputerUseError(`multiple usable computer-use providers are registered (${usable.map(provider => provider.id).join(', ')})`, 'COMPUTER_PROVIDER_AMBIGUOUS')
    }
    return single
  }

  /**
   * Read selected-provider capabilities.
   * @param signal Cooperative cancellation signal.
   * @returns Current provider capabilities.
   */
  capabilities(signal?: AbortSignal): Promise<ComputerCapabilities> {
    return this.provider().capabilities(signal)
  }

  /**
   * List local desktop applications.
   * @param signal Cooperative cancellation signal.
   * @returns Applications visible to the selected provider.
   */
  listApps(signal?: AbortSignal): Promise<readonly ComputerApp[]> {
    return this.provider().listApps(signal)
  }

  /**
   * List windows for one application.
   * @param request Application selector.
   * @param signal Cooperative cancellation signal.
   * @returns Windows owned by the selected application.
   */
  listWindows(request: ComputerListWindowsRequest, signal?: AbortSignal): Promise<readonly ComputerWindow[]> {
    return this.provider().listWindows(request, signal)
  }

  /**
   * Capture one fresh accessibility observation.
   * @param request Application, optional window, and capture options.
   * @param signal Cooperative cancellation signal.
   * @returns Observation valid until a new observation replaces it for the same target, a mutation consumes it,
   * the provider generation changes, or the provider is disposed.
   */
  observe(request: ComputerObserveRequest, signal?: AbortSignal): Promise<ComputerObservation> {
    return this.provider().observe(request, signal)
  }

  /**
   * Click an observation-bound element or point.
   * @param request Exact observation and click target.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  click(request: ComputerClickRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().click(request, signal)
  }

  /**
   * Perform an observation-bound secondary accessibility action.
   * @param request Exact observation, element, and advertised action.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  performSecondaryAction(request: ComputerSecondaryActionRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().performSecondaryAction(request, signal)
  }

  /**
   * Scroll an observation-bound element or point.
   * @param request Exact observation, target, direction, and distance.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  scroll(request: ComputerScrollRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().scroll(request, signal)
  }

  /**
   * Drag between observation-bound elements or points.
   * @param request Exact observation and drag endpoints.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  drag(request: ComputerDragRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().drag(request, signal)
  }

  /**
   * Type literal text at the observed focus.
   * @param request Exact observation and text.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  typeText(request: ComputerTypeTextRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().typeText(request, signal)
  }

  /**
   * Press one key at the observed focus.
   * @param request Exact observation and key.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  pressKey(request: ComputerPressKeyRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().pressKey(request, signal)
  }

  /**
   * Press one platform-aware hotkey at the observed focus.
   * @param request Exact observation and hotkey.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  hotkey(request: ComputerHotkeyRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().hotkey(request, signal)
  }

  /**
   * Paste exact text at the observed focus.
   * @param request Exact observation and text.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  pasteText(request: ComputerPasteTextRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().pasteText(request, signal)
  }

  /**
   * Set one observation-bound element value.
   * @param request Exact observation, element, and value.
   * @param signal Cooperative cancellation signal.
   * @returns Fresh post-action observation and provider metadata.
   */
  setValue(request: ComputerSetValueRequest, signal?: AbortSignal): Promise<ComputerActionResult> {
    return this.provider().setValue(request, signal)
  }
}

export { ComputerUseRuntime as ComputerUseRegistry }

export default ComputerUseRuntime
