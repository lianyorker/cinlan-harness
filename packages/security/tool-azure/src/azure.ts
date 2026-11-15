/**
 * az CLI argv construction and JSON output parsing for the three model-facing
 * read-only Azure tools. Pure functions so the tool wrapper stays thin and
 * every parser is unit-testable without the az executable.
 *
 * @module @cinlan/tool-azure/azure
 */

/** Environment-variable-shaped credential reference accepted by all validators. */
const REF_SEGMENT_PATTERN = /^[A-Za-z0-9._\-]+$/
const GUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Azure service-principal entries accepted inside the credential secret. */
export const AZURE_SECRET_KEYS = ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SUBSCRIPTION_ID'] as const
const REQUIRED_SECRET_KEYS = ['AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_CLIENT_SECRET'] as const

/** Service principal resolved from one `credential_ref`. */
export interface AzurePrincipal {
  /** Entra application (client) id, a GUID. */
  readonly clientId: string
  /** Entra tenant id, a GUID. */
  readonly tenantId: string
  /** Client secret. Never a model-visible value. */
  readonly clientSecret: string
  /** Optional subscription scope for the follow-up call. */
  readonly subscriptionId?: string
}

/** Validated identity-confirmation request accepted by {@link buildLoginArgv}. */
export interface AzureIdentityRequest {
  /** Environment-variable-shaped credential reference the caller presented. */
  readonly credentialRef: string
}

/** One Azure resource the enumeration tool may list. */
export type AzureResource = 'users' | 'role-assignments'

const AZURE_ENUM_COMMANDS: Record<AzureResource, string[]> = {
  users: ['ad', 'user', 'list', '--output', 'json'],
  'role-assignments': ['role', 'assignment', 'list', '--output', 'json'],
}

/** Validated enumeration request accepted by {@link buildEnumArgv}. */
export interface AzureEnumRequest {
  /** Resource collection to list. */
  readonly resource: AzureResource
  /** Optional `--subscription` scope, a GUID. */
  readonly subscriptionId?: string
}

/** Validated storage enumeration request accepted by {@link buildStorageArgv}. */
export interface AzureStorageRequest {
  /** Optional `--subscription` scope, a GUID. */
  readonly subscriptionId?: string
}

function validateCredentialRef(ref: string): string {
  const trimmed = ref.trim()
  if (trimmed.length === 0 || trimmed.length > 64 || trimmed.startsWith('-')) {
    throw new TypeError(`tool-azure: invalid credential_ref ${JSON.stringify(ref)}`)
  }
  if (!REF_SEGMENT_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-azure: credential_ref contains unsupported characters ${JSON.stringify(ref)}`)
  }
  return trimmed
}

function validateGuid(value: string, label: string): string {
  const trimmed = value.trim()
  if (!GUID_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-azure: ${label} must be a GUID ${JSON.stringify(value)}`)
  }
  return trimmed
}

/**
 * Parse the secret stored under one `credential_ref` into a service
 * principal. The secret format is `KEY=VALUE` lines restricted to
 * {@link AZURE_SECRET_KEYS}; the client id, tenant id, and client secret are
 * required. The az CLI has no environment-based service-principal login, so
 * the client secret rides on the `az login` argv — a documented limitation
 * of this package.
 * @param secret - resolved credential secret value.
 * @returns the validated principal.
 */
export function parseAzureSecret(secret: string): AzurePrincipal {
  const entries: Record<string, string> = {}
  for (const line of secret.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      throw new TypeError('tool-azure: credential secret must use KEY=VALUE lines')
    }
    const key = trimmed.slice(0, separator)
    if (!(AZURE_SECRET_KEYS as readonly string[]).includes(key)) {
      throw new TypeError(`tool-azure: credential secret carries an unsupported key ${JSON.stringify(key)}`)
    }
    entries[key] = trimmed.slice(separator + 1)
  }
  for (const key of REQUIRED_SECRET_KEYS) {
    if (!(key in entries)) {
      throw new TypeError(`tool-azure: credential secret is missing ${key}`)
    }
  }
  return {
    clientId: validateGuid(entries['AZURE_CLIENT_ID'] ?? '', 'AZURE_CLIENT_ID'),
    tenantId: validateGuid(entries['AZURE_TENANT_ID'] ?? '', 'AZURE_TENANT_ID'),
    clientSecret: entries['AZURE_CLIENT_SECRET'] ?? '',
    ...(entries['AZURE_SUBSCRIPTION_ID'] !== undefined ? { subscriptionId: validateGuid(entries['AZURE_SUBSCRIPTION_ID'], 'AZURE_SUBSCRIPTION_ID') } : {}),
  }
}

/**
 * Build the `az login --service-principal` argv. Output is always JSON
 * (`--output json`); no output-file arguments are ever emitted. The client
 * secret rides on the `-p` flag because the az CLI has no environment-based
 * service-principal login.
 * @param azPath - resolved az executable path.
 * @param request - validated identity-confirmation request.
 * @param principal - resolved service principal.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildLoginArgv(azPath: string, request: AzureIdentityRequest, principal: AzurePrincipal): string[] {
  validateCredentialRef(request.credentialRef)
  return [
    azPath, 'login', '--service-principal',
    '-u', validateGuid(principal.clientId, 'AZURE_CLIENT_ID'),
    '-p', principal.clientSecret,
    '-t', validateGuid(principal.tenantId, 'AZURE_TENANT_ID'),
    '--output', 'json',
  ]
}

/**
 * Build the `az ad user list` / `az role assignment list` argv. Output is
 * always JSON on stdout.
 * @param azPath - resolved az executable path.
 * @param request - validated enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildEnumArgv(azPath: string, request: AzureEnumRequest): string[] {
  const argv: string[] = [azPath, ...AZURE_ENUM_COMMANDS[request.resource]]
  if (request.subscriptionId !== undefined) argv.push('--subscription', validateGuid(request.subscriptionId, 'subscriptionId'))
  return argv
}

const STORAGE_QUERY =
  '[].{name:name, resourceGroup:resourceGroup, allowBlobPublicAccess:allowBlobPublicAccess, enableHttpsTrafficOnly:enableHttpsTrafficOnly}'

/**
 * Build the `az storage account list` argv with a fixed JMESPath projection
 * that keeps only the read-only public-exposure fields.
 * @param azPath - resolved az executable path.
 * @param request - validated storage enumeration request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildStorageArgv(azPath: string, request: AzureStorageRequest): string[] {
  const argv: string[] = [azPath, 'storage', 'account', 'list', '--output', 'json', '--query', STORAGE_QUERY]
  if (request.subscriptionId !== undefined) argv.push('--subscription', validateGuid(request.subscriptionId, 'subscriptionId'))
  return argv
}

/** Validated role-assignment change request accepted by the assignment builders. */
export interface RoleAssignmentRequest {
  /** Assignee object id, user principal name, or service principal id. Never starts with `-`. */
  readonly assignee: string
  /** Existing role display name or role-definition GUID. Never starts with `-`. */
  readonly role: string
  /** Assignment scope, as `/subscriptions/<guid>/...` style paths. Never starts with `-`. */
  readonly scope: string
  /** Optional subscription GUID scoping the call. */
  readonly subscriptionId?: string
}

const SCOPE_PATTERN = /^\/(subscriptions|resourceGroups|resourceGroups\/[A-Za-z0-9._\-]+)\/[A-Za-z0-9._\-/]+$/

function validateAssignee(assignee: string): string {
  const trimmed = assignee.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-') || !GUID_PATTERN.test(trimmed) && !/^[A-Za-z0-9._@\-]+@(?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,}$/.test(trimmed)) {
    throw new TypeError(`tool-azure: invalid assignee ${JSON.stringify(assignee)}`)
  }
  return trimmed
}

function validateRole(role: string): string {
  const trimmed = role.trim()
  if (trimmed.length === 0 || trimmed.length > 256 || trimmed.startsWith('-') || !/^[A-Za-z0-9][A-Za-z0-9 .()_\-]*$/.test(trimmed)) {
    throw new TypeError(`tool-azure: invalid role ${JSON.stringify(role)}`)
  }
  return trimmed
}

function validateScope(scope: string): string {
  const trimmed = scope.trim()
  if (trimmed.length === 0 || trimmed.length > 512 || trimmed.startsWith('-') || !SCOPE_PATTERN.test(trimmed)) {
    throw new TypeError(`tool-azure: invalid scope ${JSON.stringify(scope)}`)
  }
  return trimmed
}

/**
 * Build the `az role assignment create` argv granting an existing role to one
 * assignee at one scope. Only existing roles are accepted — no role
 * definition is ever composed or written.
 * @param azPath - resolved az executable path.
 * @param request - validated assignment request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildRoleCreateArgv(azPath: string, request: RoleAssignmentRequest): string[] {
  const argv: string[] = [
    azPath, 'role', 'assignment', 'create',
    '--assignee', validateAssignee(request.assignee),
    '--role', validateRole(request.role),
    '--scope', validateScope(request.scope),
    '--output', 'json',
  ]
  if (request.subscriptionId !== undefined) argv.push('--subscription', validateGuid(request.subscriptionId, 'subscriptionId'))
  return argv
}

/**
 * Build the `az role assignment delete` argv rolling back one role
 * assignment.
 * @param azPath - resolved az executable path.
 * @param request - validated assignment request.
 * @returns argv array for `ctx.subprocess.spawn`.
 */
export function buildRoleDeleteArgv(azPath: string, request: RoleAssignmentRequest): string[] {
  const argv: string[] = [
    azPath, 'role', 'assignment', 'delete',
    '--assignee', validateAssignee(request.assignee),
    '--role', validateRole(request.role),
    '--scope', validateScope(request.scope),
    '--output', 'json',
  ]
  if (request.subscriptionId !== undefined) argv.push('--subscription', validateGuid(request.subscriptionId, 'subscriptionId'))
  return argv
}

/** One login row (one authorized subscription of the principal). */
export interface AzureAccountRow {
  /** Principal name as reported by the login (the application id for service principals). */
  readonly userName: string
  /** Tenant id of the subscription. */
  readonly tenantId: string
  /** Subscription id. */
  readonly subscriptionId: string
  /** Subscription display name. */
  readonly subscriptionName: string
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

/**
 * Parse `az login --output json` into bounded subscription rows. Rows
 * without a subscription id are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed subscription rows in response order.
 */
export function parseLoginRows(stdout: string): readonly AzureAccountRow[] {
  return parseRows(stdout, (entry) => {
    const subscriptionId = entry['subscriptionId']
    if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) return undefined
    const tenantId = entry['tenantId']
    const subscriptionName = entry['subscriptionName']
    const user = typeof entry['user'] === 'object' && entry['user'] !== null && !Array.isArray(entry['user'])
      ? (entry['user'] as Record<string, unknown>)['name']
      : undefined
    return {
      userName: typeof user === 'string' ? user : '',
      tenantId: typeof tenantId === 'string' ? tenantId : '',
      subscriptionId,
      subscriptionName: typeof subscriptionName === 'string' ? subscriptionName : '',
    }
  })
}

/** One Entra user row. */
export interface AdUserRow {
  /** Object id of the user. */
  readonly id: string
  /** Display name, when present. */
  readonly name: string
  /** User principal name, when present. */
  readonly upn: string
}

/**
 * Parse `az ad user list --output json` into bounded rows. Rows without an
 * id are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed user rows in response order.
 */
export function parseAdUsers(stdout: string): readonly AdUserRow[] {
  return parseRows(stdout, (entry) => {
    const id = entry['id']
    if (typeof id !== 'string' || id.length === 0) return undefined
    const name = entry['name']
    const upn = entry['upn']
    return {
      id,
      name: typeof name === 'string' ? name : '',
      upn: typeof upn === 'string' ? upn : '',
    }
  })
}

/** One role-assignment row. */
export interface RoleAssignmentRow {
  /** Assignment id. */
  readonly id: string
  /** Role display name, when present. */
  readonly name: string
  /** Principal the role is assigned to, when present. */
  readonly principal: string
  /** Assignment scope, when present. */
  readonly scope: string
}

/**
 * Parse `az role assignment list --output json` into bounded rows. Rows
 * without an id are skipped; a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed assignment rows in response order.
 */
export function parseRoleAssignments(stdout: string): readonly RoleAssignmentRow[] {
  return parseRows(stdout, (entry) => {
    const id = entry['id']
    if (typeof id !== 'string' || id.length === 0) return undefined
    const name = entry['name']
    const principal = entry['principal']
    const scope = entry['scope']
    return {
      id,
      name: typeof name === 'string' ? name : '',
      principal: typeof principal === 'string' ? principal : '',
      scope: typeof scope === 'string' ? scope : '',
    }
  })
}

/** One storage-account row with its public-exposure fields. */
export interface StorageAccountRow {
  /** Storage account name. */
  readonly name: string
  /** Resource group containing the account. */
  readonly resourceGroup: string
  /** Whether blob public access is allowed for the account. */
  readonly allowBlobPublicAccess: string
  /** Whether HTTPS-only traffic is enforced for the account. */
  readonly enableHttpsTrafficOnly: string
}

/**
 * Parse `az storage account list --query` output into bounded rows. The
 * fixed JMESPath projection emits `name`, `resourceGroup`,
 * `allowBlobPublicAccess`, and `enableHttpsTrafficOnly`; rows without a name
 * are skipped and a malformed document parses as empty.
 * @param stdout - complete stdout text.
 * @returns parsed account rows in response order.
 */
export function parseStorageAccounts(stdout: string): readonly StorageAccountRow[] {
  return parseRows(stdout, (entry) => {
    const name = entry['name']
    if (typeof name !== 'string' || name.length === 0) return undefined
    const resourceGroup = entry['resourceGroup']
    const allowBlobPublicAccess = entry['allowBlobPublicAccess']
    const enableHttpsTrafficOnly = entry['enableHttpsTrafficOnly']
    const field = (value: unknown): string => {
      if (typeof value === 'string') return value
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (value === null || value === undefined) return 'unknown'
      return String(value)
    }
    return {
      name,
      resourceGroup: typeof resourceGroup === 'string' ? resourceGroup : '',
      allowBlobPublicAccess: field(allowBlobPublicAccess),
      enableHttpsTrafficOnly: field(enableHttpsTrafficOnly),
    }
  })
}
