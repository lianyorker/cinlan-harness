/**
 * NVD + OSV vulnerability knowledge base provider. Queries the public NVD
 * REST API (2.0) and OSV.dev API for CVE data, affected packages, severity,
 * and references. No API key required for basic usage (rate-limited).
 *
 * @module @deepseek-ai/dsh-vuln-kb-nvd
 */

import { Context } from '@deepseek-ai/cordis'
import { CVSS } from '@turingpointde/cvss.js'
import { VulnKbError, VulnKbProviderId } from '@deepseek-ai/dsh-vuln-kb-service'
import type {
  CveId,
  VulnAffectedRange,
  VulnEntry,
  VulnKbProvider,
  VulnQueryRequest,
  VulnQueryResult,
  VulnReference,
  VulnSeverity,
} from '@deepseek-ai/dsh-vuln-kb-service'

export const name = 'vuln-kb-nvd'
export const inject = ['vulnKb']

/** Provider configuration. */
export interface Config {
  /** NVD API base URL. */
  nvdBaseUrl?: string
  /** OSV API base URL. */
  osvBaseUrl?: string
  /** Request timeout in milliseconds; must be a positive safe integer within Node's timer limit. */
  timeoutMs?: number
  /** Maximum results per query; must be a positive safe integer. */
  maxResults?: number
  /** Maximum UTF-8 response body accepted from either upstream API. */
  maxResponseBytes?: number
}

/** Default API endpoints. */
const DEFAULT_NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0'
const DEFAULT_OSV_BASE = 'https://api.osv.dev/v1'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESULTS = 20
const DEFAULT_MAX_RESPONSE_BYTES = 8_388_608
const MAX_TIMEOUT_MS = 2_147_483_647

/** NVD CVSS severity to internal severity. */
function nvdSeverity(baseScore: number | undefined): VulnSeverity {
  if (baseScore === undefined) return 'unknown'
  if (baseScore >= 9) return 'critical'
  if (baseScore >= 7) return 'high'
  if (baseScore >= 4) return 'medium'
  if (baseScore >= 0.1) return 'low'
  return 'unknown'
}

/** Validate and normalize an HTTP API endpoint configured by the deployment. */
function apiBaseUrl(value: string | undefined, name: string, fallback: string): string {
  const raw = (value ?? fallback).trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch (error: unknown) {
    throw new TypeError(`vuln-kb-nvd: ${name} must be an absolute http(s) URL: ${String(error)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`vuln-kb-nvd: ${name} must use http or https`)
  }
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    throw new TypeError(`vuln-kb-nvd: ${name} must not contain credentials, query, or fragment`)
  }
  return parsed.href.replace(/\/+$/, '')
}

/** Validate a result bound before it controls response slicing. */
function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`vuln-kb-nvd: ${name} must be a positive safe integer`)
  }
  return value
}

/** Validate a timeout against Node's setTimeout delay limit. */
function timeoutMilliseconds(value: number): number {
  const timeoutMs = positiveSafeInteger(value, 'timeoutMs')
  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new TypeError(`vuln-kb-nvd: timeoutMs must be at most ${MAX_TIMEOUT_MS}ms`)
  }
  return timeoutMs
}

/** Map common user spellings to the canonical ecosystem names accepted by OSV. */
function osvEcosystem(value: string): string {
  const normalized = value.trim().toLowerCase()
  const aliases: Record<string, string> = {
    npm: 'npm',
    pypi: 'PyPI',
    python: 'PyPI',
    maven: 'Maven',
    go: 'Go',
    nuget: 'NuGet',
    cargo: 'crates.io',
    crates: 'crates.io',
    rubygems: 'RubyGems',
  }
  return aliases[normalized] ?? value.trim()
}

/** NVD CVE API response (subset). */
interface NvdResponse {
  totalResults?: number
  vulnerabilities?: readonly NvdVulnerability[]
}

interface NvdVulnerability {
  cve?: {
    id?: string
    descriptions?: readonly { lang: string; value: string }[]
    published?: string
    lastModified?: string
    metrics?: {
      cvssMetricV40?: readonly NvdCvssMetric[]
      cvssMetricV31?: readonly NvdCvssMetric[]
      cvssMetricV30?: readonly NvdCvssMetric[]
      cvssMetricV2?: readonly NvdCvssMetric[]
    }
    weaknesses?: readonly { description?: readonly { lang: string; value: string }[] }[]
    references?: readonly { url: string; source?: string }[]
    configurations?: readonly {
      nodes?: readonly NvdCpeNode[]
    }[]
  }
}

interface NvdCvssMetric {
  cvssData?: {
    baseScore?: number
    vectorString?: string
    baseSeverity?: string
  }
}

interface NvdCpeNode {
  cpeMatch?: readonly {
    criteria?: string
    vulnerable?: boolean
    versionStartIncluding?: string
    versionStartExcluding?: string
    versionEndIncluding?: string
    versionEndExcluding?: string
  }[]
  children?: readonly NvdCpeNode[]
}

/** Extract the vendor and product fields from an escaped CPE 2.3 binding. */
function cpePackage(criteria: string): string | undefined {
  if (!criteria.startsWith('cpe:2.3:')) return undefined
  const fields = splitCpeFields(criteria.slice('cpe:2.3:'.length))
  const vendor = fields[1]
  const product = fields[2]
  if (vendor === undefined || product === undefined) return undefined
  return `${vendor}:${product}`
}

/** Split CPE binding fields without treating escaped separators as delimiters. */
function splitCpeFields(value: string): string[] {
  const fields: string[] = []
  let field = ''
  let escaped = false
  for (const character of value) {
    if (escaped) {
      field += character
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === ':') {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }
  if (escaped) field += '\\'
  fields.push(field)
  return fields
}

/** OSV API response (subset). */
interface OsvResponse {
  vulns?: readonly OsvVuln[]
}

interface OsvVuln {
  id: string
  aliases?: readonly string[]
  summary?: string
  details?: string
  published?: string
  modified?: string
  severity?: readonly { type: string; score: string }[]
  affected?: readonly {
    package?: { ecosystem?: string; name?: string }
    ranges?: readonly {
      type?: string
      events?: readonly { introduced?: string; fixed?: string; last_affected?: string; limit?: string }[]
    }[]
    versions?: readonly string[]
  }[]
  references?: readonly { type?: string; url: string }[]
  database_specific?: { severity?: string }
}

/**
 * NVD + OSV vulnerability KB provider. Queries both APIs and merges results.
 */
export class NvdOsvProvider implements VulnKbProvider {
  readonly id = VulnKbProviderId('nvd-osv')
  private readonly nvdBaseUrl: string
  private readonly osvBaseUrl: string
  private readonly timeoutMs: number
  private readonly maxResults: number
  private readonly maxResponseBytes: number
  private readonly lifecycle = new AbortController()
  private disposed = false
  private readonly active = new Set<Promise<unknown>>()

  constructor(_ctx: Context, config: Config = {}) {
    for (const key of Object.keys(config)) {
      if (!['nvdBaseUrl', 'osvBaseUrl', 'timeoutMs', 'maxResults', 'maxResponseBytes'].includes(key)) {
        throw new TypeError(`vuln-kb-nvd: unsupported config key ${JSON.stringify(key)}`)
      }
    }
    this.nvdBaseUrl = apiBaseUrl(config.nvdBaseUrl, 'nvdBaseUrl', DEFAULT_NVD_BASE)
    this.osvBaseUrl = apiBaseUrl(config.osvBaseUrl, 'osvBaseUrl', DEFAULT_OSV_BASE)
    this.timeoutMs = timeoutMilliseconds(config.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.maxResults = positiveSafeInteger(config.maxResults ?? DEFAULT_MAX_RESULTS, 'maxResults')
    this.maxResponseBytes = positiveSafeInteger(config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 'maxResponseBytes')
  }

  private assertAvailable(): void {
    if (this.disposed) {
      throw new VulnKbError('unavailable', 'vulnerability KB provider has been disposed')
    }
  }

  async query(request: VulnQueryRequest, signal?: AbortSignal): Promise<VulnQueryResult> {
    return this.track(() => this.queryImpl(request, signal))
  }

  private async queryImpl(request: VulnQueryRequest, signal?: AbortSignal): Promise<VulnQueryResult> {
    this.assertAvailable()
    if (signal?.aborted) throw new VulnKbError('unavailable', 'operation cancelled')

    const max = positiveSafeInteger(request.maxResults ?? this.maxResults, 'maxResults')

    if (request.cveId) {
      const entry = await this.read(request.cveId, signal)
      return { entries: [entry], total: 1, truncated: false }
    }

    if (request.ecosystem && request.package) {
      return this.queryOsv(request.ecosystem, request.package, request.version, max, signal)
    }

    throw new VulnKbError('invalid_query', 'query must include cveId or ecosystem+package')
  }

  async read(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry> {
    return this.track(() => this.readImpl(cveId, signal))
  }

  private async readImpl(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry> {
    this.assertAvailable()
    if (signal?.aborted) throw new VulnKbError('unavailable', 'operation cancelled')

    const nvdEntry = await this.readNvd(cveId, signal).catch((err: unknown) => {
      if (err instanceof VulnKbError && err.code === 'not_found') return undefined
      throw err
    })
    if (nvdEntry) return nvdEntry

    const osvEntry = await this.readOsv(cveId, signal).catch((err: unknown) => {
      if (err instanceof VulnKbError && err.code === 'not_found') return undefined
      throw err
    })
    if (osvEntry) return osvEntry

    throw new VulnKbError('not_found', `vulnerability ${cveId} not found in NVD or OSV`)
  }

  private async readNvd(cveId: CveId, signal?: AbortSignal): Promise<VulnEntry> {
    const url = `${this.nvdBaseUrl}?cveId=${encodeURIComponent(cveId)}`
    const data = await this.fetchJson<NvdResponse>(url, signal)
    const vuln = data.vulnerabilities?.[0]?.cve
    if (!vuln || vuln.id !== cveId) {
      throw new VulnKbError('not_found', `${cveId} not found in NVD`)
    }
    const cve = vuln as NonNullable<typeof vuln> & { id: string }

    const descEn = cve.descriptions?.find(d => d.lang === 'en')
    const cvss = cve.metrics?.cvssMetricV40?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV31?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV30?.[0]?.cvssData
      ?? cve.metrics?.cvssMetricV2?.[0]?.cvssData
    const affected = this.extractNvdAffected(cve)
    const references: VulnReference[] = (cve.references ?? []).map(r => ({
      source: r.source ?? 'NVD',
      url: r.url,
    }))

    return {
      id: cve.id,
      source: 'nvd',
      summary: ((descEn?.value ?? '').split('\n')[0] ?? '').slice(0, 200),
      description: descEn?.value ?? '',
      severity: nvdSeverity(cvss?.baseScore),
      ...(cvss?.vectorString !== undefined ? { cvssVector: cvss.vectorString } : {}),
      ...(cve.published !== undefined ? { published: cve.published } : {}),
      ...(cve.lastModified !== undefined ? { modified: cve.lastModified } : {}),
      affected,
      references,
      hasFix: affected.some(r => r.fixed !== undefined && r.fixed !== ''),
    }
  }

  private async readOsv(cveId: string, signal?: AbortSignal): Promise<VulnEntry> {
    const url = `${this.osvBaseUrl}/vulns/${encodeURIComponent(cveId)}`
    const vuln = await this.fetchJson<OsvVuln>(url, signal)
    const aliases = vuln.aliases ?? []
    if (!vuln.id || (vuln.id !== cveId && !aliases.includes(cveId))) {
      throw new VulnKbError('not_found', `${cveId} not found in OSV`)
    }
    // Preserve a requested CVE alias for read(), while package queries retain
    // the OSV canonical id returned by their result list.
    const resultId = cveId.startsWith('CVE-') ? cveId : vuln.id

    const cvssVector = this.osvCvssVector(vuln)
    const severity = this.osvSeverity(vuln, cvssVector)
    const affected = this.extractOsvAffected(vuln)
    const references: VulnReference[] = (vuln.references ?? []).map(r => ({
      source: r.type ?? 'OSV',
      url: r.url,
    }))

    return {
      id: resultId,
      source: 'osv',
      summary: (vuln.summary ?? (vuln.details ?? '').split('\n')[0] ?? '').slice(0, 200),
      description: vuln.details ?? vuln.summary ?? '',
      severity,
      ...(cvssVector !== undefined ? { cvssVector } : {}),
      ...(vuln.published !== undefined ? { published: vuln.published } : {}),
      ...(vuln.modified !== undefined ? { modified: vuln.modified } : {}),
      affected,
      references,
      hasFix: affected.some(r => r.fixed !== undefined && r.fixed !== ''),
    }
  }

  private async queryOsv(
    ecosystem: string,
    pkg: string,
    version: string | undefined,
    max: number,
    signal?: AbortSignal,
  ): Promise<VulnQueryResult> {
    const url = `${this.osvBaseUrl}/query`
    const body = JSON.stringify({
      package: { ecosystem: osvEcosystem(ecosystem), name: pkg },
      ...(version ? { version } : {}),
    })
    const data = await this.fetchJson<OsvResponse>(url, signal, body)
    const vulns = data.vulns ?? []
    const entries: VulnEntry[] = []
    for (const v of vulns.slice(0, max)) {
      try {
        const entry = await this.readOsv(v.id, signal)
        entries.push(entry)
      } catch (err: unknown) {
        if (signal?.aborted) throw new VulnKbError('unavailable', 'operation cancelled')
        if (err instanceof VulnKbError && err.code === 'not_found') continue
        throw err
      }
    }
    return {
      entries,
      total: vulns.length,
      truncated: vulns.length > max,
    }
  }

  private extractNvdAffected(vuln: NonNullable<NvdVulnerability['cve']>): VulnAffectedRange[] {
    const ranges: VulnAffectedRange[] = []
    for (const config of vuln.configurations ?? []) {
      for (const node of config.nodes ?? []) {
        this.collectNvdNodeRanges(node, ranges)
      }
    }
    return ranges
  }

  /** Flatten vulnerable CPE matches while retaining exclusive CPE bounds. */
  private collectNvdNodeRanges(node: NvdCpeNode, ranges: VulnAffectedRange[]): void {
    for (const cpe of node.cpeMatch ?? []) {
      if (cpe.vulnerable === false || cpe.criteria === undefined) continue
      const pkg = cpePackage(cpe.criteria)
      if (pkg === undefined) continue
      ranges.push({
        rangeType: 'cpe',
        ecosystem: 'cpe',
        package: pkg,
        ...(cpe.versionStartIncluding !== undefined ? { introduced: cpe.versionStartIncluding } : {}),
        ...(cpe.versionStartExcluding !== undefined
          ? { introduced: cpe.versionStartExcluding, introducedInclusive: false }
          : {}),
        ...(cpe.versionEndExcluding !== undefined ? { fixed: cpe.versionEndExcluding } : {}),
        ...(cpe.versionEndIncluding !== undefined ? { lastAffected: cpe.versionEndIncluding } : {}),
      })
    }
    for (const child of node.children ?? []) this.collectNvdNodeRanges(child, ranges)
  }

  private extractOsvAffected(vuln: OsvVuln): VulnAffectedRange[] {
    const ranges: VulnAffectedRange[] = []
    for (const aff of vuln.affected ?? []) {
      const ecosystem = aff.package?.ecosystem ?? 'unknown'
      const pkg = aff.package?.name ?? 'unknown'
      if ((aff.versions ?? []).length > 0) {
        ranges.push({
          rangeType: 'versions',
          ecosystem,
          package: pkg,
          versions: [...new Set(aff.versions)],
        })
      }
      for (const range of aff.ranges ?? []) {
        const rangeType = range.type?.toLowerCase()
        if (rangeType !== 'semver' && rangeType !== 'ecosystem' && rangeType !== 'git') continue
        let introduced: string | undefined
        for (const event of range.events ?? []) {
          if (event.introduced !== undefined) {
            if (introduced !== undefined) ranges.push({ rangeType, ecosystem, package: pkg, introduced })
            introduced = event.introduced
            continue
          }
          if (event.fixed !== undefined && introduced !== undefined) {
            ranges.push({ rangeType, ecosystem, package: pkg, introduced, fixed: event.fixed })
            introduced = undefined
            continue
          }
          if (event.last_affected !== undefined && introduced !== undefined) {
            ranges.push({ rangeType, ecosystem, package: pkg, introduced, lastAffected: event.last_affected })
            introduced = undefined
            continue
          }
          if (event.limit !== undefined && introduced !== undefined) {
            ranges.push({ rangeType, ecosystem, package: pkg, introduced, limit: event.limit })
            introduced = undefined
          }
        }
        if (introduced !== undefined) ranges.push({ rangeType, ecosystem, package: pkg, introduced })
      }
    }
    return ranges
  }

  private osvSeverity(vuln: OsvVuln, vector = this.osvCvssVector(vuln)): VulnSeverity {
    const sev = vuln.database_specific?.severity?.toLowerCase()
    if (sev === 'critical' || sev === 'high' || sev === 'medium' || sev === 'low') return sev
    return vector === undefined ? 'unknown' : nvdSeverity(CVSS(vector).getScore())
  }

  /** Select the first OSV CVSS vector that the calculator can validate. */
  private osvCvssVector(vuln: OsvVuln): string | undefined {
    for (const { score } of vuln.severity ?? []) {
      if (!score.startsWith('CVSS:')) continue
      try {
        CVSS(score).getScore()
        return score
      } catch {
        // The parser is the only operation here; skip provider-specific strings it rejects.
      }
    }
    return undefined
  }

  /** Keep a public query/read promise in the provider's disposal join set. */
  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAvailable()
    const pending = operation()
    this.active.add(pending)
    return pending.finally(() => { this.active.delete(pending) })
  }

  private async fetchJson<T>(url: string, signal?: AbortSignal, body?: string): Promise<T> {
    this.assertAvailable()
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.timeoutMs)
    const combinedSignal = AbortSignal.any([
      controller.signal,
      this.lifecycle.signal,
      ...(signal === undefined ? [] : [signal]),
    ])
    try {
      const init: RequestInit = {
        method: body ? 'POST' : 'GET',
        signal: combinedSignal,
      }
      if (body) {
        init.headers = { 'content-type': 'application/json' }
        init.body = body
      }
      const response = await fetch(url, init)
      if (response.status === 404) {
        throw new VulnKbError('not_found', `resource not found at ${url}`)
      }
      if (!response.ok) {
        throw new VulnKbError('query_failed', `API returned ${response.status}: ${response.statusText}`)
      }
      return await this.readResponseJson<T>(response, combinedSignal)
    } catch (err) {
      if (err instanceof VulnKbError) throw err
      if (signal?.aborted) {
        throw new VulnKbError('unavailable', 'operation cancelled')
      }
      if (this.lifecycle.signal.aborted) {
        throw new VulnKbError('unavailable', 'vulnerability KB provider has been disposed')
      }
      if (controller.signal.aborted) {
        throw new VulnKbError('query_failed', `request timed out after ${this.timeoutMs}ms`)
      }
      const message = err instanceof Error ? err.message : String(err)
      throw new VulnKbError('query_failed', `request failed: ${message}`)
    } finally {
      clearTimeout(timeout)
    }
  }

  /** Abort active requests and wait until every owned operation settles. */
  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.lifecycle.abort()
    }
    await Promise.allSettled([...this.active])
  }

  /** Read and bound one complete upstream JSON body before parsing it. */
  private async readResponseJson<T>(response: Response, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted()
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > this.maxResponseBytes) {
        throw new VulnKbError('query_failed', `response exceeds the configured ${this.maxResponseBytes}-byte limit`)
      }
    }
    if (response.body === null) {
      const text = await response.text()
      if (Buffer.byteLength(text, 'utf8') > this.maxResponseBytes) {
        throw new VulnKbError('query_failed', `response exceeds the configured ${this.maxResponseBytes}-byte limit`)
      }
      return JSON.parse(text) as T
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let bytes = 0
    try {
      while (true) {
        const part = await reader.read()
        signal.throwIfAborted()
        if (part.done) break
        if (part.value === undefined) continue
        bytes += part.value.byteLength
        if (bytes > this.maxResponseBytes) {
          await reader.cancel()
          throw new VulnKbError('query_failed', `response exceeds the configured ${this.maxResponseBytes}-byte limit`)
        }
        chunks.push(Buffer.from(part.value))
      }
    } finally {
      reader.releaseLock()
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }
}

/**
 * Apply the NVD+OSV vulnerability KB provider.
 * @param ctx - Cordis context carrying the vulnKb runtime.
 * @param config - optional provider configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new NvdOsvProvider(ctx, config)
  ctx.effect(function* () {
    const unregister = ctx.vulnKb.registerProvider(provider)
    yield unregister
  }, 'vuln-kb-nvd.lifecycle')
}
