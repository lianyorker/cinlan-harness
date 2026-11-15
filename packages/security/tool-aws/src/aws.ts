/**
 * AWS CLI v2 argv construction and JSON output parsing for the three
 * model-facing read-only tools. Pure functions so the tool wrapper stays thin
 * and every parser is unit-testable without the aws executable.
 *
 * @module @cinlan/tool-aws/aws
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
/** Region id shape such as `us-east-1` or `cn-north-1`. */
const REGION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** AWS credential entries that may be injected into the subprocess environment. */
export const AWS_ENV_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'] as const
const REQUIRED_ENV_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const

/** Validated identity-confirmation request accepted by {@link buildStsArgv}. */
export interface StsRequest {
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
  /** Explicit `--region`; absent uses no region flag. */
  readonly region?: string
}

/** One IAM resource the enumeration tool may list. */
export type IamResource = 'users' | 'roles' | 'policies'

const IAM_COMMANDS: Record<IamResource, string> = {
  users: 'list-users',
  roles: 'list-roles',
  policies: 'list-policies',
}

/** Validated IAM enumeration request accepted by {@link buildIamArgv}. */
export interface IamRequest {
  /** Resource collection to list. */
  readonly resource: IamResource
  /** `--max-items` page bound, 1 through 1000. */
  readonly limit: number
  /** Explicit `--region`; absent uses no region flag. */
  readonly region?: string
}

/** Validated S3 enumeration request accepted by {@link buildS3ListArgv}. */
export interface S3Request {
  /** Explicit `--region`; absent uses no region flag. */
  readonly region?: string
}

/** Validated per-bucket public-policy request accepted by {@link buildPolicyStatusArgv}. */
export interface PolicyStatusRequest {
  /** Bucket name as reported by list-buckets. Never starts with `-`. */
  readonly bucket: string
  /** `--region` of the bucket; required because the check is region-scoped. */
  readonly region: string
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-aws: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-aws: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

function validateRegion(region: string): string {
  const trimmed = region.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || !REGION_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-aws: invalid region ${JSON.stringify(region)}`)
  }
  return trimmed
}

function validateBucket(bucket: string): string {
  const trimmed = bucket.trim()
  if (trimmed.length === 0 || trimmed.length > 255 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-aws: invalid bucket name ${JSON.stringify(bucket)}`)
  }
  if (!/^[A-Za-z0-9._\-]+$/.test(trimmed)) {
    throw new TypeError(`tool-aws: bucket name contains unsupported characters ${JSON.stringify(bucket)}`)
  }
  return trimmed
}

/**
 * Parse the secret stored under one `credential_ref` into environment entries.
 * The secret format is `KEY=VALUE` lines restricted to {@link AWS_ENV_KEYS};
 * both AWS key and secret lines are required, a session-token line is
 * optional. Values never reach argv or the conversation.
 * @param secret - resolved credential secret value.
 * @returns environment entries for the aws subprocess.
 */
export function parseAwsEnvSecret(secret: string): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new TypeError('tool-aws: credential secret must use KEY=VALUE lines')
    }
    const key = trimmed.slice(0, separator)
    if (!(AWS_ENV_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`tool-aws: credential secret carries an unsupported key ${JSON.stringify(key)}`)
    }
    entries[key] = trimmed.slice(separator + 1)
  }
  for (const key of REQUIRED_ENV_KEYS) {
    if (!(key in entries)) {
      throw new TypeError(`tool-aws: credential secret is missing ${key}`)
    }
  }
  return entries
}

/**
 * Build the `aws sts get-caller-identity` argv. Output is always JSON on
 * stdout (`--output json --no-cli-paginate`); no output-file arguments are
 * ever emitted and credentials ride in the subprocess environment, never argv.
 * @param awsPath - resolved aws executable path.
 * @param request - validated identity-confirmation request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildStsArgv(awsPath: string, request: StsRequest): string[] {
  validateCredentialRef(request.credentialRef)
  const argv: string[] = [awsPath, 'sts', 'get-caller-identity', '--output', 'json', '--no-cli-paginate']
  if (request.region !== undefined) argv.push('--region', validateRegion(request.region))
  return argv
}

/**
 * Build the `aws iam list-users` / `list-roles` / `list-policies` argv. The
 * policies collection is scoped to `Local` so the report stays bounded to
 * account-local policies.
 * @param awsPath - resolved aws executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIamArgv(awsPath: string, request: IamRequest): string[] {
  if (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
    throw new TypeError(`tool-aws: invalid limit ${JSON.stringify(request.limit)}`)
  }
  const argv: string[] = [awsPath, 'iam', IAM_COMMANDS[request.resource]]
  if (request.resource === 'policies') argv.push('--scope', 'Local')
  argv.push('--output', 'json', '--no-cli-paginate', '--max-items', String(request.limit))
  if (request.region !== undefined) argv.push('--region', validateRegion(request.region))
  return argv
}

/** Validated managed-policy grant request accepted by the attach/detach builders. */
export interface AttachPolicyRequest {
  /** ARN of an existing managed policy. Never starts with `-`. */
  readonly policyArn: string
  /** User name the policy is granted to. Never starts with `-`. */
  readonly userName: string
  /** Explicit `--region`; absent uses no region flag. */
  readonly region?: string
}

const POLICY_ARN_PATTERN = /^arn:aws[a-z0-9-]*:iam::[0-9*:]*:policy\/[A-Za-z0-9+=,.@_-]+$/

function validatePolicyArn(arn: string): string {
  const trimmed = arn.trim()
  if (trimmed.length === 0 || trimmed.length > 2048 || trimmed.startsWith('-') || !POLICY_ARN_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-aws: invalid policy ARN ${JSON.stringify(arn)}`)
  }
  return trimmed
}

function validateUserName(userName: string): string {
  const trimmed = userName.trim()
  if (trimmed.length === 0 || trimmed.length > 128 || trimmed.startsWith('-') || !/^[A-Za-z0-9+=,.@_\-]+$/.test(trimmed)) {
    throw new TypeError(`tool-aws: invalid user name ${JSON.stringify(userName)}`)
  }
  return trimmed
}

/**
 * Build the `aws iam attach-user-policy` argv granting an existing managed
 * policy to one user. Only existing policy ARNs are accepted — no policy
 * document is ever composed or written.
 * @param awsPath - resolved aws executable path.
 * @param request - validated attach request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildAttachPolicyArgv(awsPath: string, request: AttachPolicyRequest): string[] {
  return [
    awsPath, 'iam', 'attach-user-policy',
    '--policy-arn', validatePolicyArn(request.policyArn),
    '--user-name', validateUserName(request.userName),
    '--output', 'json', '--no-cli-paginate',
    ...(request.region === undefined ? [] : ['--region', validateRegion(request.region)]),
  ]
}

/**
 * Build the `aws iam detach-user-policy` argv rolling back one managed-policy
 * grant.
 * @param awsPath - resolved aws executable path.
 * @param request - validated detach request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildDetachPolicyArgv(awsPath: string, request: AttachPolicyRequest): string[] {
  return [
    awsPath, 'iam', 'detach-user-policy',
    '--policy-arn', validatePolicyArn(request.policyArn),
    '--user-name', validateUserName(request.userName),
    '--output', 'json', '--no-cli-paginate',
    ...(request.region === undefined ? [] : ['--region', validateRegion(request.region)]),
  ]
}

/**
 * Build the `aws s3api list-buckets` argv. Account-level listing only; the
 * per-bucket public-policy check is a separate argv built by
 * {@link buildPolicyStatusArgv}.
 * @param awsPath - resolved aws executable path.
 * @param request - validated listing request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildS3ListArgv(awsPath: string, request: S3Request): string[] {
  const argv: string[] = [awsPath, 's3api', 'list-buckets', '--output', 'json', '--no-cli-paginate']
  if (request.region !== undefined) argv.push('--region', validateRegion(request.region))
  return argv
}

/**
 * Build the `aws s3api get-bucket-policy-status` argv for one bucket. Output
 * is always JSON on stdout.
 * @param awsPath - resolved aws executable path.
 * @param request - validated public-policy request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildPolicyStatusArgv(awsPath: string, request: PolicyStatusRequest): string[] {
  return [
    awsPath, 's3api', 'get-bucket-policy-status',
    '--bucket', validateBucket(request.bucket),
    '--region', validateRegion(request.region),
    '--output', 'json', '--no-cli-paginate',
  ]
}

/** One row of the caller-identity report. */
export interface StsIdentity {
  /** Caller user or role id as reported by STS. */
  readonly userId: string
  /** Owning account id as reported by STS. */
  readonly account: string
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
 * Parse `aws sts get-caller-identity` JSON output into bounded identity rows.
 * Absent fields become empty strings; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed caller identity.
 */
export function parseStsIdentity(stdout: string): StsIdentity {
  const record = parseJsonObject(stdout)
  const field = (key: string): string => typeof record[key] === 'string' ? record[key] as string : ''
  return { userId: field('UserId'), account: field('Account'), arn: field('Arn') }
}

/** One named IAM row (user, role, or policy). */
export interface IamRow {
  /** Resource name as IAM reported it. */
  readonly name: string
  /** Resource ARN as IAM reported it, when present. */
  readonly arn: string
}

const IAM_LIST_KEYS: Record<IamResource, string> = {
  users: 'UserList',
  roles: 'RoleList',
  policies: 'Policies',
}
const IAM_NAME_KEYS: Record<IamResource, string> = {
  users: 'UserName',
  roles: 'RoleName',
  policies: 'PolicyName',
}

/**
 * Parse one `aws iam list-*` JSON response into bounded rows. Rows without a
 * resource name are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @param resource - which resource collection the response belongs to.
 * @returns parsed rows in response order.
 */
export function parseIamRows(stdout: string, resource: IamResource): readonly IamRow[] {
  const value = parseJsonObject(stdout)[IAM_LIST_KEYS[resource]]
  if (!Array.isArray(value)) return []
  const rows: IamRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = record[IAM_NAME_KEYS[resource]]
    const arn = record['Arn']
    if (typeof name !== 'string' || name.length === 0) continue
    rows.push({ name, arn: typeof arn === 'string' ? arn : '' })
  }
  return rows
}

/** One S3 bucket row as list-buckets reported it. */
export interface S3Bucket {
  /** Bucket name. */
  readonly name: string
  /** Creation date string as reported, when present. */
  readonly creationDate: string
}

/**
 * Parse `aws s3api list-buckets` JSON into bounded bucket rows. Buckets
 * without a name are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed bucket rows in response order.
 */
export function parseS3Buckets(stdout: string): readonly S3Bucket[] {
  const value = parseJsonObject(stdout)['Buckets']
  if (!Array.isArray(value)) return []
  const rows: S3Bucket[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = record['Name']
    const creationDate = record['CreationDate']
    if (typeof name !== 'string' || name.length === 0) continue
    rows.push({ name, creationDate: typeof creationDate === 'string' ? creationDate : '' })
  }
  return rows
}

/**
 * Parse `aws s3api get-bucket-policy-status` JSON. A bucket without a
 * bucket policy (or an unrecognized document) yields `undefined`, which the
 * caller reports as an unknown public status rather than a failure.
 * @param stdout - complete stdout text.
 * @returns whether the bucket policy is public, or `undefined` when unknown.
 */
export function parsePolicyStatus(stdout: string): boolean | undefined {
  const status = parseJsonObject(stdout)['PolicyStatus']
  if (typeof status !== 'object' || status === null) return undefined
  const isPublic = (status as Record<string, unknown>)['IsPublic']
  return typeof isPublic === 'boolean' ? isPublic : undefined
}
