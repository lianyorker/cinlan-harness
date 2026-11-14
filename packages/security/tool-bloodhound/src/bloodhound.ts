/**
 * bloodhound-python argv construction and collector-output aggregation. Pure
 * functions so the tool wrapper stays thin and the parser is unit-testable
 * without bloodhound-python.
 *
 * @module @cinlan/tool-bloodhound/bloodhound
 */

/** Validated collection request accepted by {@link buildBloodhoundArgv}. */
export interface BloodhoundEnumRequest {
  /** Fully-qualified domain to collect from. Never starts with `-`. */
  readonly domain: string
  /** Authenticated account name whose resolved password performs the collection. */
  readonly username: string
  /** Secret resolved from `credential_ref` by the tool wrapper; never a model-visible value. */
  readonly password: string
  /** `-ns` nameserver (domain controller address) used to resolve the domain. */
  readonly nameserver?: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

const MAX_DOMAIN_LENGTH = 253
const DOMAIN_PATTERN = /^[A-Za-z0-9._\-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@\-]+$/
const NAMESERVER_PATTERN = /^[A-Za-z0-9.:]+$/
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/

/** Validate one fully-qualified domain name and return it trimmed. */
function validateDomain(domain: string): string {
  const trimmed = domain.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_DOMAIN_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-bloodhound: invalid domain ${JSON.stringify(domain)}`)
  }
  if (!DOMAIN_PATTERN.test(trimmed) || !trimmed.includes('.')) {
    throw new TypeError(`tool-bloodhound: domain contains unsupported characters or is not a DNS name ${JSON.stringify(domain)}`)
  }
  return trimmed
}

/** Validate one account name and return it trimmed. */
function validateUsername(username: string): string {
  const trimmed = username.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-bloodhound: invalid username ${JSON.stringify(username)}`)
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-bloodhound: username contains unsupported characters ${JSON.stringify(username)}`)
  }
  return trimmed
}

/** Validate one nameserver address and return it trimmed. */
function validateNameserver(nameserver: string): string {
  const trimmed = nameserver.trim()
  if (trimmed.length === 0 || trimmed.length > 45 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-bloodhound: invalid nameserver ${JSON.stringify(nameserver)}`)
  }
  if (!NAMESERVER_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-bloodhound: nameserver contains unsupported characters ${JSON.stringify(nameserver)}`)
  }
  return trimmed
}

/** Validate one credential reference name and return it trimmed. */
function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-bloodhound: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-bloodhound: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Build the bloodhound-python argv for one authenticated collection. The run
 * always uses `-c All`, resolves with an optional `-ns` nameserver, and
 * leaves the collector JSON files in the working directory the caller
 * provides at spawn time; no archive or output-file arguments are emitted.
 * @param bloodhoundPath - resolved bloodhound-python executable path.
 * @param request - validated collection request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildBloodhoundArgv(bloodhoundPath: string, request: BloodhoundEnumRequest): string[] {
  const domain = validateDomain(request.domain)
  const username = validateUsername(request.username)
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [
    bloodhoundPath, '-c', 'All', '-d', domain, '-u', username, '-p', request.password,
  ]
  if (request.nameserver !== undefined) argv.push('-ns', validateNameserver(request.nameserver))
  return argv
}

/** One collector file's contribution to the summary. */
export interface BloodhoundCollectorCount {
  /** Collector file name, e.g. `users.json`. */
  readonly file: string
  /** Number of rows the collector emitted. */
  readonly count: number
}

/** Aggregated triage summary over one collection run. */
export interface BloodhoundSummary {
  readonly collectors: readonly BloodhoundCollectorCount[]
  /** Accounts with service principal names — immediate Kerberoasting candidates. */
  readonly kerberoastable: readonly string[]
  /** Accounts without Kerberos pre-authentication — immediate AS-REP Roasting candidates. */
  readonly asrepRoastable: readonly string[]
}

interface BloodhoundRow {
  readonly Properties?: {
    readonly name?: unknown
    readonly serviceprincipalnames?: unknown
    readonly dontreqpreauth?: unknown
  }
}

/** Extract collector rows from one parsed document (array or `{data}` wrapper). */
function rowsOf(parsed: unknown): readonly BloodhoundRow[] {
  if (Array.isArray(parsed)) return parsed as readonly BloodhoundRow[]
  if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: readonly BloodhoundRow[] }).data
  }
  return []
}

/**
 * Aggregate the collector JSON files one run left behind into a triage
 * summary. Both the plain-array and `{"data": [...]}` document shapes are
 * accepted because bloodhound-python output shape varies across versions;
 * unparseable or unexpected files are skipped rather than failing the run.
 * @param files - collector file names with their complete text.
 * @returns aggregated counts and roastable-account lists.
 */
export function aggregateBloodhoundFiles(files: readonly { readonly name: string; readonly text: string }[]): BloodhoundSummary {
  const collectors: BloodhoundCollectorCount[] = []
  const kerberoastable: string[] = []
  const asrepRoastable: string[] = []
  for (const file of files) {
    if (!file.name.endsWith('.json')) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(file.text)
    } catch {
      continue
    }
    const rows = rowsOf(parsed)
    collectors.push({ file: file.name, count: rows.length })
    if (file.name !== 'users.json') continue
    for (const row of rows) {
      const properties = row.Properties
      if (properties === undefined) continue
      const name = typeof properties.name === 'string' && properties.name.length > 0 ? properties.name : undefined
      if (name === undefined) continue
      if (Array.isArray(properties.serviceprincipalnames) && properties.serviceprincipalnames.length > 0) {
        kerberoastable.push(name)
      }
      if (properties.dontreqpreauth === true) {
        asrepRoastable.push(name)
      }
    }
  }
  return { collectors, kerberoastable, asrepRoastable }
}
