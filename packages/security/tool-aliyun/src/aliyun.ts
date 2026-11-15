/**
 * aliyun CLI argv construction and output parsing for the three model-facing
 * read-only Alibaba Cloud tools. Pure functions so the tool wrapper stays
 * thin and every parser is unit-testable without the aliyun executable.
 *
 * @module @cinlan/tool-aliyun/aliyun
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
/** Alibaba Cloud region id shape such as `cn-hangzhou`. */
const REGION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** Alibaba credential entries that may be injected into the subprocess environment. */
export const ALIYUN_ENV_KEYS = ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'] as const
const REQUIRED_ENV_KEYS = ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET'] as const

/** Validated identity-confirmation request accepted by {@link buildIdentityArgv}. */
export interface AliyunIdentityRequest {
  /** Explicit `--region` for the aliyun call. */
  readonly region: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** Validated RAM enumeration request accepted by {@link buildRamArgv}. */
export interface RamRequest {
  /** Row count for one listing page, 1 through 1000. */
  readonly limit: number
  /** Explicit `--region` for the aliyun call. RAM is global; use the account's center region. */
  readonly region: string
}

/** Validated OSS listing request accepted by {@link buildOssListArgv}. */
export interface OssRequest {
  /** Explicit `--region` for the aliyun call. */
  readonly region: string
}

function validateRegion(region: string): string {
  const trimmed = region.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !REGION_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-aliyun: invalid region ${JSON.stringify(region)}`)
  }
  return trimmed
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-aliyun: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-aliyun: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Parse the secret stored under one `credential_ref` into environment entries.
 * The secret format is `KEY=VALUE` lines restricted to {@link ALIYUN_ENV_KEYS};
 * both the key id and secret lines are required, a security-token line is
 * optional. Values never reach argv or the conversation.
 * @param secret - resolved credential secret value.
 * @returns environment entries for the aliyun subprocess.
 */
export function parseAliyunEnvSecret(secret: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new TypeError('tool-aliyun: credential secret must use KEY=VALUE lines')
    }
    const key = trimmed.slice(0, separator)
    if (!(ALIYUN_ENV_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`tool-aliyun: credential secret carries an unsupported key ${JSON.stringify(key)}`)
    }
    entries[key] = trimmed.slice(separator + 1)
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!(key in entries)) {
      throw new TypeError(`tool-aliyun: credential secret is missing ${key}`)
    }
  }
  return entries
}

/**
 * Build the `aliyun sts GetCallerIdentity` argv. The aliyun CLI prints JSON
 * on stdout by default; no output-file arguments are ever emitted and
 * credentials ride in the subprocess environment, never argv.
 * @param aliyunPath - resolved aliyun executable path.
 * @param request - validated identity-confirmation request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIdentityArgv(aliyunPath: string, request: AliyunIdentityRequest): string[] {
  validateCredentialRef(request.credentialRef)
  return [aliyunPath, 'sts', 'GetCallerIdentity', '--region', validateRegion(request.region)]
}

/**
 * Build the `aliyun ram ListUsers` argv. RAM is a global product; the region
 * routes to the account's center region.
 * @param aliyunPath - resolved aliyun executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildRamArgv(aliyunPath: string, request: RamRequest): string[] {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
    throw new TypeError(`tool-aliyun: invalid limit ${JSON.stringify(request.limit)}`)
  }
  return [
    aliyunPath, 'ram', 'ListUsers',
    '--region', validateRegion(request.region),
    '--PageSize', String(request.limit), '--PageNumber', '1',
  ]
}

/**
 * Build the `aliyun oss ls` argv. The oss listing comes from the CLI's
 * built-in ossutil, which prints text lines on stdout rather than JSON; the
 * caller parses those lines with {@link parseOssRows}.
 * @param aliyunPath - resolved aliyun executable path.
 * @param request - validated listing request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildOssListArgv(aliyunPath: string, request: OssRequest): string[] {
  return [aliyunPath, 'oss', 'ls', '--region', validateRegion(request.region)]
}

/** One row of the caller-identity report. */
export interface CallerIdentityRow {
  /** Caller identity type as reported by STS (e.g. RAMUser). */
  readonly identityType: string
  /** Owning account id as reported by STS. */
  readonly accountId: string
  /** Caller ARN as reported by STS. */
  readonly arn: string
}

function parseJsonObject(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

/**
 * Parse `aliyun sts GetCallerIdentity` JSON output into bounded identity rows.
 * Absent fields become empty strings; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed caller identity.
 */
export function parseCallerIdentity(stdout: string): CallerIdentityRow {
  const record = parseJsonObject(stdout)
  const field = (key: string): string => typeof record[key] === 'string' ? record[key] as string : ''
  return { identityType: field('IdentityType'), accountId: field('AccountId'), arn: field('Arn') }
}

/** One named RAM user row. */
export interface RamUserRow {
  /** Login or user name as RAM reported it. */
  readonly name: string
  /** Resource ARN as RAM reported it, when present. */
  readonly arn: string
}

/**
 * Parse one `aliyun ram ListUsers` response into bounded rows. RAM wraps the
 * rows under `Users.User`; rows without a name are skipped and a malformed
 * document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed rows in response order.
 */
export function parseRamUsers(stdout: string): readonly RamUserRow[] {
  const record = parseJsonObject(stdout)
  const users = record['Users']
  const value = typeof users === 'object' && users !== null && !Array.isArray(users)
    ? (users as Record<string, unknown>)['User']
    : undefined
  if (!Array.isArray(value)) return []
  const rows: RamUserRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const name = item['UserName']
    const arn = item['Arn']
    if (typeof name !== 'string' || name.length === 0) continue
    rows.push({ name, arn: typeof arn === 'string' ? arn : '' })
  }
  return rows
}

/** One OSS bucket row as the built-in ossutil reported it. */
export interface OssBucketRow {
  /** Bucket name without the `oss://` scheme. */
  readonly name: string
  /** The raw listing line, trimmed of the scheme prefix. */
  readonly detail: string
}

const OSS_LINE_PATTERN = /^oss:\/\/([A-Za-z0-9.\-]+)(.*)$/

/**
 * Parse `aliyun oss ls` text output into bounded bucket rows. The built-in
 * ossutil prints one `oss://bucket …` line per bucket; blank and non-bucket
 * lines (table headers, progress notes) are skipped.
 * @param stdout - complete stdout text.
 * @returns parsed bucket rows in response order.
 */
export function parseOssRows(stdout: string): readonly OssBucketRow[] {
  const rows: OssBucketRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = OSS_LINE_PATTERN.exec(trimmed)
    if (match === null) continue
    const name = match[1]
    const detail = (match[2] ?? '').trim()
    if (name === undefined || name.length === 0) continue
    rows.push({ name, detail })
  }
  return rows
}
