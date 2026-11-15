/**
 * KooCLI (`hcloud`) and obsutil argv construction and output parsing for the
 * three model-facing read-only Huawei Cloud tools. Pure functions so the
 * tool wrapper stays thin and every parser is unit-testable without the
 * executables.
 *
 * @module @cinlan/tool-huawei/huawei
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
/** Huawei Cloud region id shape such as `cn-north-4`. */
const REGION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** Huawei credential entries accepted inside the credential secret. */
export const HUAWEI_SECRET_KEYS = ['HW_ACCESS_KEY_ID', 'HW_SECRET_ACCESS_KEY', 'HW_SECURITY_TOKEN'] as const
const REQUIRED_SECRET_KEYS = ['HW_ACCESS_KEY_ID', 'HW_SECRET_ACCESS_KEY'] as const

/** Access key pair resolved from one `credential_ref`. */
export interface HuaweiKeyPair {
  /** Permanent or temporary access key id. */
  readonly accessKeyId: string
  /** Secret access key. Never a model-visible value. */
  readonly secretAccessKey: string
  /** Optional security token for temporary credentials. */
  readonly securityToken?: string
}

/** Validated identity-confirmation request accepted by {@link buildIdentityArgv}. */
export interface HuaweiIdentityRequest {
  /** Explicit `--cli-region` for the KooCLI call. */
  readonly region: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** Validated IAM enumeration request accepted by {@link buildIamArgv}. */
export interface HuaweiIamRequest {
  /** Resource collection to list. */
  readonly resource: HuaweiIamResource
  /** Explicit `--cli-region` for the KooCLI call. */
  readonly region: string
  /** Project id the IAM API is scoped to, as declared by the operator's grant context. */
  readonly projectId: string
}

/** One Huawei Cloud IAM resource the enumeration tool may list. */
export type HuaweiIamResource = 'users' | 'keys'

/** Validated OBS listing request accepted by {@link buildObsListArgv}. */
export interface ObsListRequest {
  /** Explicit `-region` for the obsutil call. */
  readonly region: string
}

function validateRegion(region: string): string {
  const trimmed = region.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !REGION_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-huawei: invalid region ${JSON.stringify(region)}`)
  }
  return trimmed
}

function validateProjectId(projectId: string): string {
  const trimmed = projectId.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(trimmed)) {
    throw new TypeError(`tool-huawei: invalid project id ${JSON.stringify(projectId)}`)
  }
  return trimmed
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-huawei: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-huawei: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Parse the secret stored under one `credential_ref` into a key pair. The
 * secret format is `KEY=VALUE` lines restricted to {@link HUAWEI_SECRET_KEYS};
 * both the key id and secret key lines are required, a security-token line is
 * optional. KooCLI has no environment-based credential channel, so these
 * values ride on the argv — a documented limitation of this package.
 * @param secret - resolved credential secret value.
 * @returns the validated key pair.
 */
export function parseHuaweiSecret(secret: string): HuaweiKeyPair {
  const entries: Record<string, string> = {}
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new TypeError('tool-huawei: credential secret must use KEY=VALUE lines')
    }
    const key = trimmed.slice(0, separator)
    if (!(HUAWEI_SECRET_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`tool-huawei: credential secret carries an unsupported key ${JSON.stringify(key)}`)
    }
    entries[key] = trimmed.slice(separator + 1)
  }
  for (const key of REQUIRED_SECRET_KEYS) {
    if (!(key in entries)) {
      throw new TypeError(`tool-huawei: credential secret is missing ${key}`)
    }
  }
  return {
    accessKeyId: entries['HW_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: entries['HW_SECRET_ACCESS_KEY'] ?? '',
    ...(entries['HW_SECURITY_TOKEN'] !== undefined ? { securityToken: entries['HW_SECURITY_TOKEN'] } : {}),
  }
}

/** KooCLI flag arguments that carry the key pair on every call. */
function keyFlags(pair: HuaweiKeyPair): string[] {
  const flags: string[] = [
    '--cli-access-key=' + pair.accessKeyId,
    '--cli-secret-key=' + pair.secretAccessKey,
  ]
  if (pair.securityToken !== undefined) flags.push('--cli-security-token=' + pair.securityToken)
  return flags
}

/**
 * Build the `hcloud IAM5 GetCallerIdentity` argv. No output-file arguments
 * are ever emitted; the key pair rides on the argv because KooCLI has no
 * environment-based credential channel.
 * @param hcloudPath - resolved hcloud executable path.
 * @param request - validated identity-confirmation request.
 * @param pair - resolved key pair.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIdentityArgv(hcloudPath: string, request: HuaweiIdentityRequest, pair: HuaweiKeyPair): string[] {
  validateCredentialRef(request.credentialRef)
  return [
    hcloudPath, 'IAM5', 'GetCallerIdentity',
    '--cli-region=' + validateRegion(request.region),
    ...keyFlags(pair),
  ]
}

/**
 * Build the `hcloud IAM ListUsers` / `IAM ListPermanentAccessKeys` argv. The
 * IAM (v3) user listing is project-scoped, so the project id rides on the
 * argv; the key listing covers the account.
 * @param hcloudPath - resolved hcloud executable path.
 * @param request - validated enumeration request.
 * @param pair - resolved key pair.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIamArgv(hcloudPath: string, request: HuaweiIamRequest, pair: HuaweiKeyPair): string[] {
  const command = request.resource === 'users' ? 'ListUsers' : 'ListPermanentAccessKeys'
  return [
    hcloudPath, 'IAM', command,
    '--cli-region=' + validateRegion(request.region),
    '--project_id=' + validateProjectId(request.projectId),
    ...keyFlags(pair),
  ]
}

/**
 * Build the `obsutil ls` argv for the account-wide bucket listing. obsutil
 * prints text lines on stdout rather than JSON; the caller parses those
 * lines with {@link parseObsRows}.
 * @param obsutilPath - resolved obsutil executable path.
 * @param request - validated listing request.
 * @param pair - resolved key pair.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildObsListArgv(obsutilPath: string, request: ObsListRequest, pair: HuaweiKeyPair): string[] {
  return [
    obsutilPath, 'ls',
    '-region=' + validateRegion(request.region),
    '-i=' + pair.accessKeyId,
    '-k=' + pair.secretAccessKey,
    ...(pair.securityToken !== undefined ? ['-t=' + pair.securityToken] : []),
  ]
}

/** One row of the caller-identity report. */
export interface CallerIdentityRow {
  /** Caller user id as reported by IAM5. */
  readonly userId: string
  /** Owning account id as reported by IAM5. */
  readonly accountId: string
  /** Caller URN as reported by IAM5. */
  readonly urn: string
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
 * Parse `hcloud IAM5 GetCallerIdentity` JSON output into bounded identity
 * rows. KooCLI prints the payload fields at the top level (`user_id`,
 * `account_id`, `urn`); absent fields become empty strings and a malformed
 * document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed caller identity.
 */
export function parseCallerIdentity(stdout: string): CallerIdentityRow {
  const record = parseJsonObject(stdout)
  const field = (key: string): string => typeof record[key] === 'string' ? record[key] as string : ''
  return { userId: field('user_id'), accountId: field('account_id'), urn: field('urn') }
}

/** One named IAM user row. */
export interface IamUserRow {
  /** User name as IAM reported it. */
  readonly name: string
  /** User id as IAM reported it, when present. */
  readonly userId: string
}

/** One permanent access key row. */
export interface IamKeyRow {
  /** Access key id as IAM reported it (masked shape, e.g. `HWAK…`). */
  readonly accessKeyId: string
  /** Owning user id as IAM reported it, when present. */
  readonly userId: string
  /** Key status as IAM reported it (`Active` / `Inactive`), when present. */
  readonly status: string
}

const IAM_LIST_KEYS: Record<HuaweiIamResource, readonly string[]> = {
  users: ['userlist', 'users'],
  keys: ['credentials', 'accesskeys'],
}

/**
 * Parse one `hcloud IAM ListUsers` / `IAM ListPermanentAccessKeys` response
 * into bounded rows. KooCLI serializes the IAM payload with snake_case keys
 * under a per-command list key; rows without a name or key id are skipped and
 * a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @param resource - which resource collection the response belongs to.
 * @returns parsed rows in response order.
 */
export function parseIamRows(stdout: string, resource: HuaweiIamResource): readonly (IamUserRow | IamKeyRow)[] {
  const record = parseJsonObject(stdout)
  for (const key of IAM_LIST_KEYS[resource]) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    if (resource === 'users') {
      const rows: IamUserRow[] = []
      for (const entry of value) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
        const item = entry as Record<string, unknown>
        const name = item['user_name']
        const userId = item['user_id']
        if (typeof name !== 'string' || name.length === 0) continue
        rows.push({ name, userId: typeof userId === 'string' ? userId : '' })
      }
      return rows
    }
    const rows: IamKeyRow[] = []
    for (const entry of value) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const item = entry as Record<string, unknown>
      const accessKeyId = item['access_key_id'] ?? item['access']
      if (typeof accessKeyId !== 'string' || accessKeyId.length === 0) continue
      const userId = item['user_id']
      const status = item['status']
      rows.push({
        accessKeyId,
        userId: typeof userId === 'string' ? userId : '',
        status: typeof status === 'string' ? status : '',
      })
    }
    return rows
  }
  return []
}

/** One OBS bucket row as obsutil reported it. */
export interface ObsBucketRow {
  /** Bucket name without the `obs://` scheme. */
  readonly name: string
  /** The raw listing line, trimmed of the scheme prefix. */
  readonly detail: string
}

const OBS_LINE_PATTERN = /^obs:\/\/([A-Za-z0-9.\-]+)(.*)$/

/**
 * Parse `obsutil ls` text output into bounded bucket rows. obsutil prints
 * one `obs://bucket …` line per bucket; blank and non-bucket lines (table
 * headers, progress notes) are skipped.
 * @param stdout - complete stdout text.
 * @returns parsed bucket rows in response order.
 */
export function parseObsRows(stdout: string): readonly ObsBucketRow[] {
  const rows: ObsBucketRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    const match = OBS_LINE_PATTERN.exec(trimmed)
    if (match === null) continue
    const name = match[1]
    const detail = (match[2] ?? '').trim()
    if (name === undefined || name.length === 0) continue
    rows.push({ name, detail })
  }
  return rows
}
