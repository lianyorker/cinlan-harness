/**
 * tccli argv construction and JSON output parsing for the three model-facing
 * read-only Tencent Cloud tools. Pure functions so the tool wrapper stays
 * thin and every parser is unit-testable without the tccli executable.
 *
 * @module @cinlan/tool-tencent/tencent
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
/** Tencent Cloud region id shape such as `ap-guangzhou`. */
const REGION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** Tencent credential entries that may be injected into the subprocess environment. */
export const TENCENT_ENV_KEYS = ['TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY', 'TENCENTCLOUD_SESSION_TOKEN'] as const
const REQUIRED_ENV_KEYS = ['TENCENTCLOUD_SECRETID', 'TENCENTCLOUD_SECRETKEY'] as const

/** Validated identity-confirmation request accepted by {@link buildIdentityArgv}. */
export interface TencentIdentityRequest {
  /** Explicit `--region` for the tccli call. */
  readonly region: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** One CAM resource the enumeration tool may list. */
export type CamResource = 'users' | 'roles'

const CAM_COMMANDS: Record<CamResource, string> = {
  users: 'ListUsers',
  roles: 'ListRoles',
}

/** Validated CAM enumeration request accepted by {@link buildCamArgv}. */
export interface CamRequest {
  /** Resource collection to list. */
  readonly resource: CamResource
  /** Row bound for the listing page, 1 through 1000. */
  readonly limit: number
  /** Explicit `--region` for the tccli call. */
  readonly region: string
}

/** Validated COS enumeration request accepted by {@link buildCosServiceArgv}. */
export interface CosServiceRequest {
  /** Explicit `--region` for the tccli call. */
  readonly region: string
}

/** Validated per-bucket ACL request accepted by {@link buildCosAclArgv}. */
export interface CosAclRequest {
  /** Bucket name as reported by GetService. Never starts with `-`. */
  readonly bucket: string
  /** Explicit `--region` of the bucket. */
  readonly region: string
}

function validateRegion(region: string): string {
  const trimmed = region.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !REGION_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-tencent: invalid region ${JSON.stringify(region)}`)
  }
  return trimmed
}

function validateBucket(bucket: string): string {
  const trimmed = bucket.trim()
  if (trimmed.length === 0 || trimmed.length > 255 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-tencent: invalid bucket name ${JSON.stringify(bucket)}`)
  }
  if (!/^[A-Za-z0-9.\-]+$/.test(trimmed)) {
    throw new TypeError(`tool-tencent: bucket name contains unsupported characters ${JSON.stringify(bucket)}`)
  }
  return trimmed
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-tencent: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-tencent: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Parse the secret stored under one `credential_ref` into environment entries.
 * The secret format is `KEY=VALUE` lines restricted to
 * {@link TENCENT_ENV_KEYS}; both the secret id and secret key lines are
 * required, a session-token line is optional. Values never reach argv or the
 * conversation.
 * @param secret - resolved credential secret value.
 * @returns environment entries for the tccli subprocess.
 */
export function parseTencentEnvSecret(secret: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new TypeError('tool-tencent: credential secret must use KEY=VALUE lines')
    }
    const key = trimmed.slice(0, separator)
    if (!(TENCENT_ENV_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`tool-tencent: credential secret carries an unsupported key ${JSON.stringify(key)}`)
    }
    entries[key] = trimmed.slice(separator + 1)
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!(key in entries)) {
      throw new TypeError(`tool-tencent: credential secret is missing ${key}`)
    }
  }
  return entries
}

/**
 * Build the `tccli sts GetCallerIdentity` argv. Output is always JSON
 * (`--output json`); no output-file arguments are ever emitted and
 * credentials ride in the subprocess environment, never argv.
 * @param tccliPath - resolved tccli executable path.
 * @param request - validated identity-confirmation request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIdentityArgv(tccliPath: string, request: TencentIdentityRequest): string[] {
  validateCredentialRef(request.credentialRef)
  return [tccliPath, 'sts', 'GetCallerIdentity', '--region', validateRegion(request.region), '--output', 'json']
}

/**
 * Build the `tccli cam ListUsers` / `ListRoles` argv. Users use the
 * `--limit`/`--offset` paging parameters; roles use the `--page`/`--rp`
 * paging parameters their API declares.
 * @param tccliPath - resolved tccli executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCamArgv(tccliPath: string, request: CamRequest): string[] {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
    throw new TypeError(`tool-tencent: invalid limit ${JSON.stringify(request.limit)}`)
  }
  const argv: string[] = [tccliPath, 'cam', CAM_COMMANDS[request.resource]]
  argv.push(...(request.resource === 'users' ? ['--limit', String(request.limit), '--offset', '0'] : ['--page', '1', '--rp', String(request.limit)]))
  argv.push('--region', validateRegion(request.region), '--output', 'json')
  return argv
}

/**
 * Build the `tccli cos GetService` argv for the account-wide bucket listing.
 * @param tccliPath - resolved tccli executable path.
 * @param request - validated listing request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCosServiceArgv(tccliPath: string, request: CosServiceRequest): string[] {
  return [tccliPath, 'cos', 'GetService', '--region', validateRegion(request.region), '--output', 'json']
}

/**
 * Build the `tccli cos GetBucketAcl` argv for one bucket. Output is always
 * JSON on stdout.
 * @param tccliPath - resolved tccli executable path.
 * @param request - validated ACL request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildCosAclArgv(tccliPath: string, request: CosAclRequest): string[] {
  return [tccliPath, 'cos', 'GetBucketAcl', '--bucket', validateBucket(request.bucket), '--region', validateRegion(request.region), '--output', 'json']
}

/** One row of the caller-identity report. */
export interface CallerIdentityRow {
  /** Caller user id as reported by STS. */
  readonly userId: string
  /** Owning account id as reported by STS. */
  readonly accountId: string
  /** Caller ARN as reported by STS. */
  readonly arn: string
}

function readEnvelope(stdout: string, path: readonly string[]): unknown | undefined {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return undefined
  let current: unknown
  try {
    current = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function readArray(stdout: string, path: readonly string[]): readonly unknown[] | undefined {
  const value = readEnvelope(stdout, path)
  return Array.isArray(value) ? value : undefined
}

/**
 * Parse `tccli sts GetCallerIdentity` output into bounded identity rows. The
 * tccli envelope carries the payload under `Response`; absent fields become
 * empty strings and a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed caller identity.
 */
export function parseCallerIdentity(stdout: string): CallerIdentityRow {
  const payload = readEnvelope(stdout, ['Response'])
  const field = (key: string): string => payload !== undefined && typeof payload === 'object' && payload !== null && !Array.isArray(payload) && typeof (payload as Record<string, unknown>)[key] === 'string'
    ? (payload as Record<string, unknown>)[key] as string
    : ''
  return { userId: field('UserId'), accountId: field('AccountId'), arn: field('Arn') }
}

/** One named CAM row (user or role). */
export interface CamRow {
  /** Resource name as CAM reported it. */
  readonly name: string
  /** Resource ARN as CAM reported it, when present. */
  readonly arn: string
}

const CAM_LIST_PATHS: Record<CamResource, readonly string[]> = {
  users: ['Response', 'Data'],
  roles: ['Response', 'ListData'],
}
const CAM_NAME_KEYS: Record<CamResource, string> = {
  users: 'Uin',
  roles: 'RoleName',
}

/**
 * Parse one `tccli cam ListUsers` / `ListRoles` response into bounded rows.
 * Rows without a resource name are skipped; a malformed document parses as
 * empty.
 * @param stdout - complete stdout text.
 * @param resource - which resource collection the response belongs to.
 * @returns parsed rows in response order.
 */
export function parseCamRows(stdout: string, resource: CamResource): readonly CamRow[] {
  const value = readArray(stdout, CAM_LIST_PATHS[resource])
  if (value === undefined) return []
  const rows: CamRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const name = record[CAM_NAME_KEYS[resource]]
    const arn = record['Arn']
    if (typeof name !== 'string' && typeof name !== 'number') continue
    rows.push({ name: String(name), arn: typeof arn === 'string' ? arn : '' })
  }
  return rows
}

/** One COS bucket row as GetService reported it. */
export interface CosBucketRow {
  /** Bucket full name as reported (typically `<name>-<appid>`). */
  readonly name: string
  /** Region string as reported, when present. */
  readonly location: string
  /** Creation date string as reported, when present. */
  readonly creationDate: string
}

/**
 * Parse `tccli cos GetService` output into bounded bucket rows. The envelope
 * path follows the API 3.0 wrapper of the XML GetService payload; buckets
 * without a name are skipped and a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed bucket rows in response order.
 */
export function parseCosBuckets(stdout: string): readonly CosBucketRow[] {
  const value = readArray(stdout, ['Response', 'ListAllMyBucketsResult', 'Buckets', 'Bucket'])
  if (value === undefined) return []
  const rows: CosBucketRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const name = record['Name']
    const location = record['Location']
    const creationDate = record['CreationDate']
    if (typeof name !== 'string' || name.length === 0) continue
    rows.push({
      name,
      location: typeof location === 'string' ? location : '',
      creationDate: typeof creationDate === 'string' ? creationDate : '',
    })
  }
  return rows
}

/** One ACL grant row of one bucket. */
export interface AclGrantRow {
  /** Grantee identifier (id or URI such as the AllUsers group). */
  readonly grantee: string
  /** Permission string as reported (`READ`, `FULL_CONTROL`, …). */
  readonly permission: string
}

/**
 * Parse `tccli cos GetBucketAcl` output into grant rows. A bucket without an
 * ACL envelope yields empty rows, which the caller reports as an unknown
 * public status rather than a failure.
 * @param stdout - complete stdout text.
 * @returns parsed grant rows in response order.
 */
export function parseAclGrants(stdout: string): readonly AclGrantRow[] {
  const value = readArray(stdout, ['Response', 'AccessControlList', 'Grant'])
  if (value === undefined) return []
  const rows: AclGrantRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const permission = record['Permission']
    const grantee = typeof record['Grantee'] === 'object' && record['Grantee'] !== null && !Array.isArray(record['Grantee'])
      ? (record['Grantee'] as Record<string, unknown>)
      : undefined
    const id = typeof grantee?.['ID'] === 'string' ? grantee['ID'] : undefined
    const uri = typeof grantee?.['URI'] === 'string' ? grantee['URI'] : undefined
    if (typeof permission !== 'string' || (id === undefined && uri === undefined)) continue
    rows.push({ grantee: id ?? uri ?? '', permission })
  }
  return rows
}

/**
 * Whether the parsed ACL grants admit anonymous `READ` access (the AllUsers
 * group grantee with the `READ` or `FULL_CONTROL` permission).
 * @param grants - rows from {@link parseAclGrants}.
 * @returns whether the bucket is anonymously readable.
 */
export function isPublicGrants(grants: readonly AclGrantRow[]): boolean {
  return grants.some(grant => grant.grantee.includes('AllUsers') && (grant.permission === 'READ' || grant.permission === 'FULL_CONTROL'))
}
