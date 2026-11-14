/**
 * nmap argv construction and `-oX -` XML result parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without nmap.
 *
 * @module @cinlan/tool-nmap/nmap
 */

/** Validated scan request accepted by {@link buildNmapArgv}. */
export interface NmapScanRequest {
  /** Scan target: hostname, IPv4/IPv6 address, or CIDR range. Never starts with `-`. */
  readonly target: string
  /** `-p` port specification (digits, commas, hyphens), e.g. `22,80,443` or `1-1024`. */
  readonly ports?: string
  /** `--top-ports N` shortcut; mutually exclusive with {@link ports}. */
  readonly topPorts?: number
  /** `-sV` service/version detection. */
  readonly serviceDetection?: boolean
  /** `-O` OS detection (requires elevated privileges on most platforms). */
  readonly osDetection?: boolean
  /** `--open` — report only open (or open|filtered) ports. Default true. */
  readonly openOnly?: boolean
  /** `-T0`..`-T5` timing template. */
  readonly timing?: 0 | 1 | 2 | 3 | 4 | 5
}

const MAX_TARGET_LENGTH = 253
const TARGET_PATTERN = /^[A-Za-z0-9._:\-[\]/*]+$/
const PORTS_PATTERN = /^[0-9,\-]+$/

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-nmap: invalid scan target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-nmap: scan target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

function validatePorts(ports: string): string {
  if (!PORTS_PATTERN.test(ports) || ports.length > 128) {
    throw new TypeError(`tool-nmap: invalid port specification ${JSON.stringify(ports)}`)
  }
  return ports
}

/**
 * Build the nmap argv for one scan. Output is always XML on stdout (`-oX -`)
 * so the caller can parse structured results; no `--script` arguments are
 * ever emitted (vulnerability scripts stay out of this tool's scope).
 * @param nmapPath - resolved nmap executable path.
 * @param request - validated scan request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildNmapArgv(nmapPath: string, request: NmapScanRequest): string[] {
  const target = validateTarget(request.target)
  if (request.ports !== undefined && request.topPorts !== undefined) {
    throw new TypeError('tool-nmap: ports and topPorts are mutually exclusive')
  }
  const argv: string[] = [nmapPath, '-oX', '-']
  if (request.openOnly !== false) argv.push('--open')
  if (request.serviceDetection === true) argv.push('-sV')
  if (request.osDetection === true) argv.push('-O')
  if (request.ports !== undefined) argv.push('-p', validatePorts(request.ports))
  if (request.topPorts !== undefined) {
    if (!Number.isSafeInteger(request.topPorts) || request.topPorts < 1 || request.topPorts > 65535) {
      throw new TypeError('tool-nmap: topPorts must be an integer between 1 and 65535')
    }
    argv.push('--top-ports', String(request.topPorts))
  }
  if (request.timing !== undefined) argv.push(`-T${request.timing}`)
  argv.push(target)
  return argv
}

/** One reported port row. */
export interface NmapPortResult {
  readonly port: number
  readonly protocol: string
  readonly state: string
  readonly service?: string
  readonly product?: string
  readonly version?: string
  readonly extrainfo?: string
  readonly serviceConf?: number
}

/** One OS fingerprint candidate. */
export interface NmapOsMatch {
  readonly name: string
  readonly accuracy: number
}

/** One scanned host. */
export interface NmapHostResult {
  readonly address: string
  readonly status: string
  readonly addresses: readonly { readonly addr: string; readonly addrtype: string }[]
  readonly ports: readonly NmapPortResult[]
  readonly osMatches: readonly NmapOsMatch[]
}

/** Parsed `-oX -` document. */
export interface NmapScanResult {
  readonly hosts: readonly NmapHostResult[]
  readonly hostCount: number
  readonly upCount: number
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`).exec(tag)
  return match?.[1]
}

function parsePort(block: string): NmapPortResult | undefined {
  const portMatch = /<port\s+([^>]+)>/.exec(block)
  if (portMatch === null) return undefined
  const portid = attr(portMatch[1] ?? '', 'portid')
  const protocol = attr(portMatch[1] ?? '', 'protocol')
  if (portid === undefined || protocol === undefined) return undefined
  const port = Number.parseInt(portid, 10)
  if (!Number.isSafeInteger(port)) return undefined
  const stateMatch = /<state\s+([^>]+)\/>/.exec(block)
  const state = stateMatch !== null ? (attr(stateMatch[1] ?? '', 'state') ?? 'unknown') : 'unknown'
  const serviceMatch = /<service\s+([^>]+)\/>/.exec(block)
  const serviceTag = serviceMatch?.[1]
  const confRaw = serviceTag !== undefined ? attr(serviceTag, 'conf') : undefined
  const conf = confRaw !== undefined ? Number.parseInt(confRaw, 10) : Number.NaN
  const result: {
    port: number
    protocol: string
    state: string
    service?: string
    product?: string
    version?: string
    extrainfo?: string
    serviceConf?: number
  } = { port, protocol, state }
  if (serviceTag !== undefined) {
    const service = attr(serviceTag, 'name')
    const product = attr(serviceTag, 'product')
    const version = attr(serviceTag, 'version')
    const extrainfo = attr(serviceTag, 'extrainfo')
    if (service !== undefined) result.service = service
    if (product !== undefined) result.product = product
    if (version !== undefined) result.version = version
    if (extrainfo !== undefined) result.extrainfo = extrainfo
    if (Number.isSafeInteger(conf)) result.serviceConf = conf
  }
  return result
}

function parseHost(block: string): NmapHostResult | undefined {
  const statusMatch = /<status\s+([^>]+)\/>/.exec(block)
  const status = statusMatch !== null ? (attr(statusMatch[1] ?? '', 'state') ?? 'unknown') : 'unknown'
  const addresses: { addr: string; addrtype: string }[] = []
  for (const match of block.matchAll(/<address\s+([^>]+)\/>/g)) {
    const tag = match[1] ?? ''
    const addr = attr(tag, 'addr')
    const addrtype = attr(tag, 'addrtype') ?? 'unknown'
    if (addr !== undefined) addresses.push({ addr, addrtype })
  }
  const primary = addresses.find(a => a.addrtype === 'ipv4') ?? addresses[0]
  if (primary === undefined) return undefined
  const ports: NmapPortResult[] = []
  for (const match of block.matchAll(/<port\s+[^>]*>[\s\S]*?<\/port>/g)) {
    const parsed = parsePort(match[0])
    if (parsed !== undefined) ports.push(parsed)
  }
  const osMatches: NmapOsMatch[] = []
  for (const match of block.matchAll(/<osmatch\s+([^>]+)\/>/g)) {
    const tag = match[1] ?? ''
    const name = attr(tag, 'name')
    const accuracyRaw = attr(tag, 'accuracy')
    const accuracy = accuracyRaw !== undefined ? Number.parseInt(accuracyRaw, 10) : Number.NaN
    if (name !== undefined && Number.isSafeInteger(accuracy)) osMatches.push({ name, accuracy })
  }
  return {
    address: primary.addr,
    status,
    addresses,
    ports,
    osMatches,
  }
}

/**
 * Parse nmap `-oX -` XML output into structured host/port rows.
 * @param xml - complete XML document from stdout.
 * @returns parsed scan result; malformed documents yield empty host lists.
 */
export function parseNmapXml(xml: string): NmapScanResult {
  const hosts: NmapHostResult[] = []
  for (const match of xml.matchAll(/<host\s+[^>]*>[\s\S]*?<\/host>/g)) {
    const parsed = parseHost(match[0])
    if (parsed !== undefined) hosts.push(parsed)
  }
  return {
    hosts,
    hostCount: hosts.length,
    upCount: hosts.filter(h => h.status === 'up').length,
  }
}
