/**
 * Model-facing Azure read-only tools. Registers `az_account_show`,
 * `azure_ad_enum`, and `azure_storage_enum` on `ctx.tools` and shells out
 * through `ctx.subprocess` with the az CLI. Every call first logs the
 * service principal in (`az login`) and then runs its read-only listing; the
 * client secret is resolved from the model-provided `credential_ref` at
 * execution time through `ctx.get('credentials')` and never appears in
 * model-visible arguments, tool results, or the Session log — but the az CLI
 * has no environment-based service-principal login, so the secret rides on
 * the `az login` argv, a documented limitation.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `az_account_show` maps to `credential-use` through that policy's
 * `credentialTools`, while `azure_ad_enum` and `azure_storage_enum` map to
 * `reconnaissance` through `cloudTools`. `target_id` must match a `cloud`
 * grant target whose account id is the target value, and explicit
 * subscription arguments must fall inside the target's declared allowlist.
 * This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-azure
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildEnumArgv, buildLoginArgv, buildStorageArgv,
  parseAdUsers, parseAzureSecret, parseLoginRows, parseRoleAssignments, parseStorageAccounts,
} from './azure.ts'
import type { AzurePrincipal, AzureResource } from './azure.ts'

export const name = 'tool-azure'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the Azure tools. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `az`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds per subprocess; also the grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-azure: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'az',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-azure: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-azure: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-azure: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-azure: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-azure: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-azure: credential ${ref} is not configured.`)
  }
  return resolved.value
}

function optionalSubscription(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Spawn one az subprocess under the deployment timeout and read its
 * collected streams. The service principal's client secret rides in argv on
 * the `az login` call (az CLI limitation) and never in a model-visible
 * argument.
 */
async function runAz(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
): Promise<RunOutcome> {
  let azPath: string
  try {
    azPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-azure: az executable not found (${resolved.command}). Install Azure CLI or set config.command.`)
    }
    throw error
  }
  argv[0] = azPath
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: tmpdir(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 33_554_432 },
      stderr: { maxBytes: 65_536 },
    },
    graceMs: resolved.timeoutMs,
    signal: exec.signal,
  })
  const outcome = await handle.done
  return {
    stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    stderr: handle.collected.stderr?.readFrom(0).text ?? '',
    exitCode: outcome.exitCode,
    signal: outcome.signal,
  }
}

function requireSuccess(run: RunOutcome, label: string): string {
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim().length > 0
      ? run.stderr.trim().slice(-500)
      : `exit code ${run.exitCode ?? 'signal ' + String(run.signal)}`
    throw new Error(`tool-azure: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const SUBSCRIPTION_DESCRIPTION =
  'Azure subscription GUID to scope the call via --subscription; must fall inside the subscription allowlist of the matched cloud target.'

const CREDENTIAL_REF_DESCRIPTION =
  'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_AZURE_SP). The value never enters the conversation.'

/**
 * Register the three read-only Azure tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'az_account_show',
    description:
      'Confirm which Azure subscriptions the granted service principal can reach (az login '
      + '--service-principal) and return the subscription rows with tenant ids. The target_id must '
      + 'match a cloud target declared in the active assessment-scope grant and the credential reference '
      + 'must be granted; this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Azure tenant or account id to confirm access to, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          subscriptions: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const subscriptions = value.subscriptions as readonly { subscriptionName?: string; subscriptionId?: string }[]
        const names = subscriptions.slice(0, 20).map(row => `${row.subscriptionName ?? '?'} (${row.subscriptionId ?? '?'})`)
        return [{ type: 'text', text: `subscriptions: ${subscriptions.length}\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const principal: AzurePrincipal = parseAzureSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runAz(
        ctx, exec, resolved,
        buildLoginArgv(resolved.command, { credentialRef: refName }, principal),
      ), 'az login')
      const value = { subscriptions: parseLoginRows(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm Azure subscriptions', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'azure_ad_enum',
    description:
      'Enumerate one authorized Azure tenant through the granted service principal (az ad user list or '
      + 'az role assignment list) and return bounded rows. The target_id must match a cloud target '
      + 'declared in the active assessment-scope grant; this is read-only Entra reconnaissance, not '
      + 'exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Azure tenant or account id to enumerate, as declared in the assessment scope grant.',
      },
      resource: {
        type: 'string',
        required: true,
        enum: ['users', 'role-assignments'],
        description: 'Entra collection to list: directory users or role assignments.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      subscription: {
        type: 'string',
        description: SUBSCRIPTION_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rows: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const rows = value.rows as readonly { name?: string; upn?: string; principal?: string }[]
        const names = rows.slice(0, 50).map(row => row.upn ?? row.name ?? row.principal ?? '?')
        return [{ type: 'text', text: `entra: ${rows.length} row(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const principal: AzurePrincipal = parseAzureSecret(await resolveSecret(ctx, refName))
      const subscription = optionalSubscription(args.subscription)
      await requireSuccess(await runAz(
        ctx, exec, resolved,
        buildLoginArgv(resolved.command, { credentialRef: refName }, principal),
      ), 'az login')
      const stdout = await requireSuccess(await runAz(
        ctx, exec, resolved,
        buildEnumArgv(resolved.command, {
          resource: String(args.resource) as AzureResource,
          ...(subscription !== undefined ? { subscriptionId: subscription } : {}),
        }),
      ), `entra ${String(args.resource)} listing`)
      const value = {
        rows: (String(args.resource) === 'users'
          ? parseAdUsers(stdout) as unknown as Record<string, JsonValue>[]
          : parseRoleAssignments(stdout) as unknown as Record<string, JsonValue>[]),
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate Entra directory', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'azure_storage_enum',
    description:
      'List the storage accounts of the granted Azure service principal (az storage account list) and '
      + 'return rows with each account\'s blob-public-access and HTTPS-only settings. The target_id must '
      + 'match a cloud target declared in the active assessment-scope grant; this is read-only storage '
      + 'reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Azure tenant or account id to enumerate, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      subscription: {
        type: 'string',
        description: SUBSCRIPTION_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          accounts: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const accounts = value.accounts as readonly { name?: string; allowBlobPublicAccess?: string }[]
        const names = accounts.slice(0, 50).map(row => `${row.name ?? '?'} [public-access: ${row.allowBlobPublicAccess ?? '?'}]`)
        return [{ type: 'text', text: `storage: ${accounts.length} account(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const principal: AzurePrincipal = parseAzureSecret(await resolveSecret(ctx, refName))
      const subscription = optionalSubscription(args.subscription) ?? principal.subscriptionId
      await requireSuccess(await runAz(
        ctx, exec, resolved,
        buildLoginArgv(resolved.command, { credentialRef: refName }, principal),
      ), 'az login')
      const stdout = await requireSuccess(await runAz(
        ctx, exec, resolved,
        buildStorageArgv(resolved.command, { ...(subscription !== undefined ? { subscriptionId: subscription } : {}) }),
      ), 'storage account list')
      const value = { accounts: parseStorageAccounts(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate Azure storage accounts', kind: 'other', rawInput: args }),
  }))
}
