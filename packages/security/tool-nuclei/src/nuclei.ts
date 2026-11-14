/**
 * nuclei argv construction and `-json` line parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without nuclei.
 *
 * @module @cinlan/tool-nuclei/nuclei
 */

/** Validated scan request accepted by {@link buildNucleiArgv}. */
export interface NucleiScanRequest {
  /** Targets to scan: URLs or bare hosts. Each never starts with `-`. */
  readonly targets: readonly string[]
  /** Template IDs or local template paths (`-t`); each token validated. */
  readonly templates?: readonly string[]
  /** Severity filter (`-severity`); subset of info/low/medium/high/critical. */
  readonly severities?: readonly NucleiSeverity[]
  /** Follow redirects (`-follow-redirects`). Default false. */
  readonly followRedirects?: boolean
  /** Per-request timeout in seconds (`-timeout`). Default upstream 10. */
  readonly timeoutSeconds?: number
}

export const NUCLEI_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const
export type NucleiSeverity = (typeof NUCLEI_SEVERITIES)[number]

const MAX_TARGET_LENGTH = 4096
const TARGET_PATTERN = /^(?:https?:\/\/)?[A-Za-z0-9._:\-[\]/]+$/
const TEMPLATE_PATTERN = /^[A-Za-z0-9._\-/]+$/
const MAX_TARGETS = 100
const MAX_TIMEOUT_SECONDS = 600

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-nuclei: invalid scan target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-nuclei: scan target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

function validateTemplate(template: string): string {
  const trimmed = template.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-nuclei: invalid template ${JSON.stringify(template)}`)
  }
  if (!TEMPLATE_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-nuclei: template contains unsupported characters ${JSON.stringify(template)}`)
  }
  return trimmed
}

/**
 * Build the nuclei argv for one scan. Output is always one JSON object per
 * line on stdout (`-json -silent -no-color`); out-of-band interaction through
 * interactsh is disabled by default (`-ni`) so scans stay within the session's
 * declared egress. `-dast` and exploit-grade flags are never emitted.
 * @param nucleiPath - resolved nuclei executable path.
 * @param request - validated scan request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildNucleiArgv(nucleiPath: string, request: NucleiScanRequest): string[] {
  const targets = request.targets.map(validateTarget)
  if (targets.length === 0) throw new TypeError('tool-nuclei: at least one target is required')
  if (targets.length > MAX_TARGETS) throw new TypeError(`tool-nuclei: at most ${MAX_TARGETS} targets per run`)
  if (request.timeoutSeconds !== undefined) {
    if (!Number.isSafeInteger(request.timeoutSeconds) || request.timeoutSeconds < 1 || request.timeoutSeconds > MAX_TIMEOUT_SECONDS) {
      throw new TypeError(`tool-nuclei: timeoutSeconds must be an integer between 1 and ${MAX_TIMEOUT_SECONDS}`)
    }
  }
  const argv: string[] = [nucleiPath, '-json', '-silent', '-no-color', '-ni']
  if (request.templates !== undefined && request.templates.length > 0) {
    argv.push('-t', request.templates.map(validateTemplate).join(','))
  }
  if (request.severities !== undefined && request.severities.length > 0) {
    for (const severity of request.severities) {
      if (!NUCLEI_SEVERITIES.includes(severity)) {
        throw new TypeError(`tool-nuclei: unsupported severity ${JSON.stringify(severity)}`)
      }
    }
    argv.push('-severity', request.severities.join(','))
  }
  if (request.followRedirects === true) argv.push('-follow-redirects')
  if (request.timeoutSeconds !== undefined) argv.push('-timeout', String(request.timeoutSeconds))
  argv.push(...targets)
  return argv
}

/** One finding row from nuclei `-json` output. */
export interface NucleiFinding {
  /** Template identifier that matched, e.g. `cve-2023-1234`. */
  readonly templateId?: string
  /** Human-readable finding name. */
  readonly name?: string
  /** Severity label reported by the template. */
  readonly severity?: string
  /** Host the template matched. */
  readonly host?: string
  /** Matched URL or request path. */
  readonly matchedAt?: string
  /** Probe type (http/network/dns/...). */
  readonly type?: string
  /** Template tags. */
  readonly tags?: readonly string[]
  /** Reference URL declared by the template. */
  readonly reference?: string
}

/**
 * Parse nuclei `-json` stdout: one JSON object per line; unparseable lines are
 * skipped rather than failing the whole run. Only matcher hits are kept
 * (`matcher-status === false` rows are dropped).
 * @param stdout - complete stdout text.
 * @returns parsed finding rows in output order.
 */
export function parseNucleiJsonLines(stdout: string): readonly NucleiFinding[] {
  const results: NucleiFinding[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    if (record['matcher-status'] === false) continue
    const result: { -readonly [K in keyof NucleiFinding]?: NucleiFinding[K] } = {}
    const templateId = record['template-id'] ?? record.template_id
    if (typeof templateId === 'string' && templateId.length > 0) result.templateId = templateId
    if (typeof record.name === 'string' && record.name.length > 0) result.name = record.name
    if (typeof record.severity === 'string' && record.severity.length > 0) result.severity = record.severity
    if (typeof record.host === 'string' && record.host.length > 0) result.host = record.host
    const matchedAt = record['matched-at'] ?? record.matched_at
    if (typeof matchedAt === 'string' && matchedAt.length > 0) result.matchedAt = matchedAt
    if (typeof record.type === 'string' && record.type.length > 0) result.type = record.type
    if (Array.isArray(record.tags)) {
      const tags = record.tags.filter((t): t is string => typeof t === 'string' && t.length > 0)
      if (tags.length > 0) result.tags = tags
    }
    if (Array.isArray(record.reference)) {
      const refs = record.reference.filter((t): t is string => typeof t === 'string' && t.length > 0)
      const first = refs.at(0)
      if (first !== undefined) result.reference = first
    } else if (typeof record.reference === 'string' && record.reference.length > 0) {
      result.reference = record.reference
    }
    if (result.templateId !== undefined || result.name !== undefined) results.push(result)
  }
  return results
}
