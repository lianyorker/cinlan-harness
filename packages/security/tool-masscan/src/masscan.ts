/**
 * masscan argv construction and `-oJ -` JSON result parsing. Pure functions so
 * the tool wrapper stays thin and the parser is unit-testable without masscan.
 *
 * @module @cinlan/tool-masscan/masscan
 */

/** Validated scan request accepted by {@link buildMasscanArgv}. */
export interface MasscanScanRequest {
  /** Scan target: IPv4/IPv6 address, CIDR range, or `start-end` IP range. Never starts with `-`. */
  readonly target: string
  /** `-p` port specification (digits, commas, hyphens), e.g. `22,80,443` or `1-1024`. */
  readonly ports?: string
  /** `--rate` packets per second; must be within `1..1000000` and the deployment rate cap. */
  readonly rate?: number
}

/** Deployment-side maximum for the model-selected `--rate`. */
export const MAX_RATE_ABSOLUTE = 1_000_000

const MAX_TARGET_LENGTH = 253
const TARGET_PATTERN = /^[A-Za-z0-9._:\-[\]/*]+$/
const PORTS_PATTERN = /^[0-9,\-]+$/
const DEFAULT_RATE = 100

function validateTarget(target: string): string {
  const trimmed = target.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_TARGET_LENGTH || trimmed.startsWith('-')) {
    throw new TypeError(`tool-masscan: invalid scan target ${JSON.stringify(target)}`)
  }
  if (!TARGET_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-masscan: scan target contains unsupported characters ${JSON.stringify(target)}`)
  }
  return trimmed
}

function validatePorts(ports: string): string {
  if (!PORTS_PATTERN.test(ports) || ports.length > 128) {
    throw new TypeError(`tool-masscan: invalid port specification ${JSON.stringify(ports)}`)
  }
  return ports
}

/**
 * Build the masscan argv for one rate-limited SYN scan. Output is always JSON
 * on stdout (`-oJ -`) so the caller can parse structured open-port rows; no
 * file-output or exclude-file arguments are ever emitted.
 * @param masscanPath - resolved masscan executable path.
 * @param request - validated scan request.
 * @param maxRate - deployment rate cap; the requested rate may not exceed it.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildMasscanArgv(masscanPath: string, request: MasscanScanRequest, maxRate: number): string[] {
  if (!Number.isSafeInteger(maxRate) || maxRate < 1 || maxRate > MAX_RATE_ABSOLUTE) {
    throw new TypeError(`tool-masscan: maxRate must be an integer between 1 and ${MAX_RATE_ABSOLUTE}`)
  }
  const target = validateTarget(request.target)
  const rate = request.rate ?? DEFAULT_RATE
  if (!Number.isSafeInteger(rate) || rate < 1 || rate > maxRate) {
    throw new TypeError(`tool-masscan: rate must be an integer between 1 and ${maxRate}`)
  }
  const argv: string[] = [masscanPath, '-oJ', '-', '--rate', String(rate)]
  if (request.ports !== undefined) argv.push('-p', validatePorts(request.ports))
  argv.push(target)
  return argv
}

/** One reported open-port row. */
export interface MasscanPortRow {
  readonly port: number
  readonly proto?: string
  readonly status?: string
}

/** One scanned host with its open ports. */
export interface MasscanHostRow {
  readonly ip: string
  readonly ports: readonly MasscanPortRow[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parsePortRow(value: unknown): MasscanPortRow | undefined {
  if (!isRecord(value)) return undefined
  const port = value.port
  if (typeof port !== 'number' || !Number.isSafeInteger(port) || port < 1 || port > 65535) return undefined
  const row: { port: number; proto?: string; status?: string } = { port }
  if (typeof value.proto === 'string' && value.proto.length > 0) row.proto = value.proto
  if (typeof value.status === 'string' && value.status.length > 0) row.status = value.status
  return row
}

function parseHostRow(value: unknown): MasscanHostRow | undefined {
  if (!isRecord(value)) return undefined
  const ip = value.ip
  if (typeof ip !== 'string' || ip.length === 0) return undefined
  const rawPorts = Array.isArray(value.ports) ? value.ports : []
  const ports = rawPorts
    .map(parsePortRow)
    .filter((row): row is MasscanPortRow => row !== undefined)
  return { ip, ports }
}

function parseArrayDocument(document: string): readonly MasscanHostRow[] | undefined {
  try {
    const parsed: unknown = JSON.parse(document)
    if (!Array.isArray(parsed)) return undefined
    return parsed.map(parseHostRow).filter((row): row is MasscanHostRow => row !== undefined)
  } catch {
    return undefined
  }
}

/**
 * masscan `-oJ` streams the array without closing it when truncated; cut back
 * to the last complete object and close the array.
 */
function repairTruncatedArray(text: string): string | undefined {
  if (!text.startsWith('[')) return undefined
  const lastObject = text.lastIndexOf('}')
  if (lastObject < 0) return undefined
  return `${text.slice(0, lastObject + 1)}]`
}

function regexRows(text: string): readonly MasscanHostRow[] {
  const rows: MasscanHostRow[] = []
  const pattern = /"ip"\s*:\s*"([^"]+)"[\s\S]*?"ports"\s*:\s*\[([\s\S]*?)\]/g
  for (const match of text.matchAll(pattern)) {
    const ip = match[1] ?? ''
    const ports: MasscanPortRow[] = []
    for (const portMatch of (match[2] ?? '').matchAll(/"port"\s*:\s*(\d+)/g)) {
      const port = Number.parseInt(portMatch[1] ?? '', 10)
      if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) ports.push({ port })
    }
    if (ip.length > 0) rows.push({ ip, ports })
  }
  return rows
}

/**
 * Parse masscan `-oJ -` output. The top-level array may be truncated (masscan
 * streams it without the closing bracket), so parsing falls back to repairing
 * the array and finally to regex extraction of ip/port pairs.
 * @param stdout - complete stdout text.
 * @returns parsed open-port rows in output order; empty output yields no rows.
 */
export function parseMasscanJson(stdout: string): readonly MasscanHostRow[] {
  const text = stdout.trim()
  if (text.length === 0) return []
  const direct = parseArrayDocument(text)
  if (direct !== undefined) return direct
  const repaired = repairTruncatedArray(text)
  if (repaired !== undefined) {
    const fromRepair = parseArrayDocument(repaired)
    if (fromRepair !== undefined) return fromRepair
  }
  return regexRows(text)
}
