/**
 * Vulnerability Knowledge Base Service Definition (`ctx.vulnKb`): a registry
 * that dispatches vulnerability queries to one or more registered
 * {@link VulnKbProvider} implementations. Providers own data sources (NVD,
 * OSV, GitHub Advisory); the runtime selects the active provider by id or
 * defaults to the first registered.
 *
 * @module @deepseek-ai/dsh-vuln-kb-service
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { VulnKbError } from './types.ts'
import { VulnKbProviderId as brandVulnKbProviderId } from './brand.ts'
import type {
  CveId,
  VulnEntry,
  VulnKbProviderId,
  VulnQueryRequest,
  VulnQueryResult,
} from './types.ts'

export type {
  VulnAffectedRange,
  VulnEntry,
  VulnKbErrorCode,
  VulnQueryRequest,
  VulnQueryResult,
  VulnReference,
  VulnSeverity,
} from './types.ts'
export { CveId, VulnKbProviderId } from './brand.ts'
export { VulnKbError } from './types.ts'

/**
 * Provider interface for vulnerability knowledge base backends. A provider
 * owns query resolution against one or more data sources (NVD, OSV, etc.).
 */
export interface VulnKbProvider {
  /** Stable unique provider id. */
  readonly id: VulnKbProviderId
  /** Query vulnerabilities by CVE id, package, or version. */
  query(request: VulnQueryRequest, signal?: AbortSignal): Promise<VulnQueryResult>
  /** Read a single vulnerability entry by CVE id. */
  read(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry>
  /** Dispose provider-owned resources. */
  dispose?(): void | Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    vulnKb: VulnKbRuntime
  }
}

/** Service configuration. */
export interface Config {
  /** Select a registered provider by id; defaults to the first registered. */
  provider?: string
}

/**
 * Registry and dispatch facade for vulnerability KB providers. Load one
 * implementation per context as `ctx.vulnKb`, then register providers via
 * {@link VulnKbRuntime.registerProvider}.
 */
export class VulnKbRuntime extends Service {
  private readonly providers = new Map<VulnKbProviderId, VulnKbProvider>()
  private readonly providerId: VulnKbProviderId | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'vulnKb')
    for (const key of Object.keys(config)) {
      if (key !== 'provider') throw new TypeError(`vuln-kb-service: unsupported config key ${JSON.stringify(key)}`)
    }
    if (config.provider !== undefined
      && (config.provider.length === 0 || config.provider.trim() !== config.provider)) {
      throw new TypeError('vuln-kb-service: provider must be non-empty without surrounding whitespace')
    }
    this.providerId = config.provider === undefined ? undefined : brandVulnKbProviderId(config.provider)
  }

  /**
   * Register one vulnerability KB provider for the calling plugin lifetime.
   * @param provider - provider implementation with a stable id.
   * @returns a disposer that unregisters this exact contribution.
   */
  registerProvider(provider: VulnKbProvider): () => Promise<void> {
    if (provider.id.length === 0 || provider.id.trim() !== provider.id) {
      throw new VulnKbError('unavailable', 'provider id must be a non-empty string without surrounding whitespace')
    }
    if (this.providers.has(provider.id)) {
      throw new VulnKbError('unavailable', `provider ${provider.id} is already registered`)
    }
    const dispose = this.ctx.effect(function* (this: VulnKbRuntime) {
      this.providers.set(provider.id, provider)
      yield async () => {
        this.providers.delete(provider.id)
        await provider.dispose?.()
      }
    }.bind(this), 'vulnKb.registerProvider()')
    return dispose
  }

  /** Select the active provider or throw. */
  private active(): VulnKbProvider {
    if (this.providerId !== undefined) {
      const p = this.providers.get(this.providerId)
      if (p) return p
      throw new VulnKbError('unavailable', `configured provider ${this.providerId} is not registered`)
    }
    const first = this.providers.values().next()
    if (first.done) {
      throw new VulnKbError('unavailable', 'no vulnerability KB provider is registered')
    }
    return first.value
  }

  /**
   * Query vulnerabilities by CVE id, package, or version.
   * @param request - Typed query filters: CVE id or ecosystem/package/version.
   * @param signal - Optional pre-completion cancellation.
   * @returns Matching vulnerability entries.
   */
  query(request: VulnQueryRequest, signal?: AbortSignal): Promise<VulnQueryResult> {
    return this.active().query(request, signal)
  }

  /**
   * Read a single vulnerability entry by CVE id.
   * @param cveId - Opaque CVE identifier.
   * @param signal - Optional pre-completion cancellation.
   * @returns The vulnerability entry with full details.
   */
  read(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry> {
    return this.active().read(cveId, signal)
  }
}

export default VulnKbRuntime
