/**
 * naabu argv construction and `-json` line parsing. Pure functions so the
 * tool wrapper stays thin and the parser is unit-testable without naabu.
 *
 * @module @cinlan/tool-naabu/naabu
 */

/** Validated scan request accepted by {@link buildNaabuArgv}. */
export interface NaabuScanRequest {
  /** Scan target: hostname, IPv4/IPv6 address, or CIDR range. Never starts with `-`. */
  readonly targets: readonly string[]
  /** `-p` port specification (digits, commas, hyphens), e.g. `22,80,443` or `1-1000`. Required. */
  readonly ports: string
  /** `-top-ports N` shortcut; mutually exclusive with {@link ports}. */
  readonly topPorts?: number
  /** `-silent` is always emitted; this field is reserved and currently ignored. */
  readonly _reserved?: never
}

const MAX_TARGET_LENGTH = 253
const TARGET_PATTERN = /^[A-Za-z0-9._:\-[\]/]+$/
const PORTS_PATTERN = /^[0-9,\-]+$/
const MAX_TARGETS = 1000

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-naabu: invalid scan target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-naabu: scan target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

function validatePorts(ports: string): string {
  if (!PORTS_PATTERN.test(ports) || ports.length > 128) {
    throw new TypeError(`tool-naabu: invalid port specification ${JSON.stringify(ports)}`)
  }
  return ports
}

/**
 * Build the naabu argv for one scan. Output is always one JSON object per
 * line on stdout (`-json`); `-silent` suppresses banner noise. Service
 * identification is out of scope — this tool discovers open ports only.
 * @param naabuPath - resolved naabu executable path.
 * @param request - validated scan request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildNaabuArgv(naabuPath: string, request: NaabuScanRequest): string[] {
  const targets = request.targets.map(validateTarget)
  if (targets.length === 0) throw new TypeError('tool-naabu: at least one target is required')
  if (targets.length > MAX_TARGETS) throw new TypeError(`tool-naabu: at most ${MAX_TARGETS} targets per run`)
  const argv: string[] = [naabuPath, '-json', '-silent', '-exclude-cdn']
  if (request.topPorts !== undefined) {
    if (request.ports.length > 0) throw new TypeError('tool-naabu: ports and topPorts are mutually exclusive')
    if (!Number.isSafeInteger(request.topPorts) || request.topPorts < 1 || request.topPorts > 65535) {
      throw new TypeError('tool-naabu: topPorts must be an integer between 1 and 65535')
    }
    argv.push('-top-ports', String(request.topPorts))
  } else {
    if (request.ports.length === 0) throw new TypeError('tool-naabu: ports or topPorts is required')
    argv.push('-p', validatePorts(request.ports))
  }
  argv.push(...targets)
  return argv
}

/** One discovered open port row from naabu `-json` output. */
export interface NaabuPortResult {
  /** Host the port was found on. */
  readonly host: string
  /** IP address scanned. */
  readonly ip?: string
  /** Open port number. */
  readonly port: number
  /** Protocol, always `tcp` for naabu. */
  readonly protocol?: string
}

/**
 * Parse naabu `-json` stdout: one JSON object per line; unparseable lines are
 * skipped rather than failing the whole run.
 * @param stdout - complete stdout text.
 * @returns parsed port rows in output order.
 */
export function parseNaabuJsonLines(stdout: string): readonly NaabuPortResult[] {
  const results: NaabuPortResult[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || !trimmed.startsWith('{')) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const host = typeof record.host === 'string' && record.host.length > 0 ? record.host : undefined
    const ip = typeof record.ip === 'string' && record.ip.length > 0 ? record.ip : undefined
    const port = record.port
    if (host === undefined || typeof port !== 'number' || !Number.isSafeInteger(port)) continue
    const result: { host: string; ip?: string; port: number; protocol?: string } = { host, port }
    if (ip !== undefined) result.ip = ip
    if (typeof record.protocol === 'string' && record.protocol.length > 0) result.protocol = record.protocol
    results.push(result)
  }
  return results
}
