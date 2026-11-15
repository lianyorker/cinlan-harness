/**
 * gcloud argv construction and JSON output parsing for the three model-facing
 * read-only GCP tools. Pure functions so the tool wrapper stays thin and
 * every parser is unit-testable without the gcloud executable.
 *
 * @module @cinlan/tool-gcp/gcp
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
/** GCP project id shape: 6-30 lowercase alphanumerics and dashes. */
const PROJECT_PATTERN = /^[a-z0-9][a-z0-9-]{4,28}[a-z0-9]$/

/** Validated identity-confirmation request accepted by {@link buildIdentityArgv}. */
export interface GcpIdentityRequest {
  /** Project whose ancestor chain confirms access. */
  readonly projectId: string
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** Validated IAM enumeration request accepted by {@link buildIamPolicyArgv}. */
export interface GcpIamRequest {
  /** Project whose IAM policy is reported. */
  readonly projectId: string
}

/** Validated GCS enumeration request accepted by {@link buildGcsListArgv}. */
export interface GcsRequest {
  /** Project whose buckets are listed. */
  readonly projectId: string
}

function validateProject(projectId: string): string {
  const trimmed = projectId.trim()
  if (trimmed.length === 0 || trimmed.length > 30 || !PROJECT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-gcp: invalid project id ${JSON.stringify(projectId)}`)
  }
  return trimmed
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-gcp: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-gcp: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

/**
 * Validate the credential secret as a service-account JSON document. The
 * value must parse as JSON with `type: 'service_account'`; it is written to a
 * private temporary file by the tool wrapper and never reaches argv.
 * @param secret - resolved credential secret value.
 * @returns the secret text unchanged, after validation.
 */
export function parseServiceAccountSecret(secret: string): string {
  const trimmed = secret.trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new TypeError('tool-gcp: credential secret must be service-account JSON')
  }
  const type = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)['type']
    : undefined
  if (type !== 'service_account') {
    throw new TypeError(`tool-gcp: credential secret must be service-account JSON, got type ${JSON.stringify(type)}`)
  }
  return trimmed
}

/**
 * Build the `gcloud projects get-ancestors` argv. Output is always JSON
 * (`--format=json`); no output-file arguments are ever emitted and the
 * service-account file rides in the subprocess environment, never argv.
 * @param gcloudPath - resolved gcloud executable path.
 * @param request - validated identity-confirmation request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIdentityArgv(gcloudPath: string, request: GcpIdentityRequest): string[] {
  validateCredentialRef(request.credentialRef)
  return [gcloudPath, 'projects', 'get-ancestors', validateProject(request.projectId), '--format=json']
}

/**
 * Build the `gcloud projects get-iam-policy` argv.
 * @param gcloudPath - resolved gcloud executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildIamPolicyArgv(gcloudPath: string, request: GcpIamRequest): string[] {
  return [gcloudPath, 'projects', 'get-iam-policy', validateProject(request.projectId), '--format=json']
}

/**
 * Build the `gcloud storage buckets list` argv for one project.
 * @param gcloudPath - resolved gcloud executable path.
 * @param request - validated listing request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildGcsListArgv(gcloudPath: string, request: GcsRequest): string[] {
  return [gcloudPath, 'storage', 'buckets', 'list', '--project', validateProject(request.projectId), '--format=json']
}

/** One ancestor row (project, folder, or organization). */
export interface AncestorRow {
  /** Ancestor kind as reported by gcloud. */
  readonly kind: string
  /** Ancestor id as reported by gcloud. */
  readonly id: string
}

/**
 * Parse `gcloud projects get-ancestors --format=json` into bounded rows.
 * Rows without a kind or id are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed ancestor rows in response order.
 */
export function parseAncestors(stdout: string): readonly AncestorRow[] {
  return parseRows(stdout, (entry) => {
    const kind = entry['kind']
    const id = entry['id']
    return typeof kind === 'string' && typeof id === 'string' && kind.length > 0 && id.length > 0
      ? { kind, id }
      : undefined
  })
}

/** One IAM binding row. */
export interface IamBindingRow {
  /** Role name as reported by the policy. */
  readonly role: string
  /** Members bound to the role. */
  readonly members: readonly string[]
}

/**
 * Parse `gcloud projects get-iam-policy --format=json` into binding rows.
 * Bindings without a role are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed binding rows in response order.
 */
export function parseIamBindings(stdout: string): readonly IamBindingRow[] {
  const record = parseJsonObject(stdout)
  const value = record['bindings']
  if (!Array.isArray(value)) return []
  const rows: IamBindingRow[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const item = entry as Record<string, unknown>
    const role = item['role']
    if (typeof role !== 'string' || role.length === 0) continue
    const members = item['members']
    rows.push({
      role,
      members: Array.isArray(members) ? members.filter((member): member is string => typeof member === 'string') : [],
    })
  }
  return rows
}

/** One GCS bucket row. */
export interface GcsBucketRow {
  /** Bucket resource name as reported by gcloud. */
  readonly name: string
  /** Public-access-prevention setting as reported, when present. */
  readonly publicAccessPrevention: string
}

/**
 * Parse `gcloud storage buckets list --format=json` into bounded rows. The
 * `publicAccessPrevention` value (`enforced` or `inherited`) is the read-only
 * public-exposure signal; buckets without a name are skipped and a malformed
 * document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed bucket rows in response order.
 */
export function parseGcsBuckets(stdout: string): readonly GcsBucketRow[] {
  return parseRows(stdout, (entry) => {
    const name = entry['name']
    if (typeof name !== 'string' || name.length === 0) return undefined
    const iam = entry['iamConfiguration']
    const prevention = typeof iam === 'object' && iam !== null && !Array.isArray(iam)
      ? (iam as Record<string, unknown>)['publicAccessPrevention']
      : undefined
    return { name, publicAccessPrevention: typeof prevention === 'string' ? prevention : '' }
  })
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

function parseRows<T>(stdout: string, read: (entry: Record<string, unknown>) => T | undefined): readonly T[] {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const rows: T[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const row = read(entry as Record<string, unknown>)
    if (row !== undefined) rows.push(row)
  }
  return rows
}
