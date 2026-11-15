/**
 * Model-facing Huawei Cloud read-only tools. Registers `huawei_identity_get`,
 * `huawei_iam_enum`, and `obs_enum` on `ctx.tools` and shells out through
 * `ctx.subprocess` with the Huawei Cloud KooCLI (`hcloud`) — the binary name
 * is shared with the unrelated Hetzner Cloud CLI; all error messages name the
 * Huawei Cloud KooCLI explicitly. `obs_enum` uses the separate `obsutil`
 * binary for the account-wide bucket listing. The access key pair is resolved
 * from the model-provided `credential_ref` at execution time through
 * `ctx.get('credentials')` and never appears in model-visible arguments, tool
 * results, or the Session log — but neither KooCLI nor obsutil has an
 * environment-based credential channel, so the values ride on the argv, a
 * documented limitation.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `huawei_identity_get` maps to `credential-use` through that policy's
 * `credentialTools`, while `huawei_iam_enum` and `obs_enum` map to
 * `reconnaissance` through `cloudTools`. `target_id` must match a `cloud`
 * grant target whose account id is the target value, and explicit region
 * arguments must fall inside the target's declared region allowlist. This
 * package performs no scope checks of its own.
 *
 * @module @cinlan/tool-huawei
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildGroupAddArgv, buildGroupRemoveArgv, buildIamArgv, buildIdentityArgv, buildObsListArgv,
  parseCallerIdentity, parseHuaweiSecret, parseIamRows, parseObsRows,
} from './huawei.ts'
import type { HuaweiIamResource } from './huawei.ts'

export const name = 'tool-huawei'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the Huawei Cloud tools. */
export interface Config {
  /** KooCLI executable name or absolute path resolved through `ctx.subprocess`. Default `hcloud`. */
  readonly command?: string
  /** obsutil executable name or absolute path resolved through `ctx.subprocess`. Default `obsutil`. */
  readonly obsCommand?: string
  /** Whole-run timeout in milliseconds per subprocess; also the grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set(['command', 'obsCommand', 'timeoutMs', 'maxOutputBytes'])

interface ResolvedConfig {
  readonly command: string
  readonly obsCommand: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-huawei: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'hcloud',
    obsCommand: config.obsCommand ?? 'obsutil',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-huawei: command must be non-empty')
  if (resolved.obsCommand.trim().length === 0) throw new TypeError('tool-huawei: obsCommand must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-huawei: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-huawei: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-huawei: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-huawei: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-huawei: credential ${ref} is not configured.`)
  }
  return resolved.value
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Spawn one Huawei Cloud CLI subprocess under the deployment timeout and
 * read its collected streams. The key pair rides in argv (KooCLI limitation)
 * and never in a model-visible argument.
 */
async function runHuawei(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
  executable: string,
): Promise<RunOutcome> {
  let executablePath: string
  try {
    executablePath = await ctx.subprocess.resolveExecutable(executable, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-huawei: Huawei Cloud CLI executable not found (${executable}). Install the Huawei Cloud KooCLI or obsutil, or set config.command / config.obsCommand.`)
    }
    throw error
  }
  argv[0] = executablePath
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
    throw new Error(`tool-huawei: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const REGION_DESCRIPTION =
  'Explicit Huawei Cloud region for --cli-region; must fall inside the region allowlist of the matched cloud target.'

const CREDENTIAL_REF_DESCRIPTION =
  'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_HW_KEYS). The value never enters the conversation.'

/**
 * Register the three read-only Huawei Cloud tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for both commands, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'huawei_identity_get',
    description:
      'Confirm which Huawei Cloud identity the granted credentials resolve to (Huawei Cloud KooCLI: '
      + 'hcloud IAM5 GetCallerIdentity) and return the caller user id, account id, and URN. The target_id '
      + 'must match a cloud target declared in the active assessment-scope grant and the credential '
      + 'reference must be granted; this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Huawei Cloud account id to confirm access to, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      region: {
        type: 'string',
        required: true,
        description: REGION_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          userId: { type: 'string', required: true },
          accountId: { type: 'string', required: true },
          urn: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const identity = value as { userId?: string; accountId?: string; urn?: string }
        return [{ type: 'text', text: `caller: ${identity.accountId ?? '?'} / ${identity.userId ?? '?'} (${identity.urn ?? '?'})` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const pair = parseHuaweiSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runHuawei(
        ctx, exec, resolved,
        buildIdentityArgv(resolved.command, { region: String(args.region), credentialRef: refName }, pair),
        resolved.command,
      ), 'IAM5 GetCallerIdentity')
      const identity = parseCallerIdentity(stdout)
      const value = { userId: identity.userId, accountId: identity.accountId, urn: identity.urn }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm Huawei Cloud caller identity', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'huawei_iam_enum',
    description:
      'Enumerate the IAM users or permanent access keys of one authorized Huawei Cloud account through '
      + 'the granted credentials (Huawei Cloud KooCLI: hcloud IAM ListUsers or ListPermanentAccessKeys) '
      + 'and return bounded rows. The target_id must match a cloud target declared in the active '
      + 'assessment-scope grant; this is read-only IAM reconnaissance, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Huawei Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      resource: {
        type: 'string',
        required: true,
        enum: ['users', 'keys'],
        description: 'IAM collection to list: users, or the account\'s permanent access keys.',
      },
      project_id: {
        type: 'string',
        required: true,
        description: 'Huawei Cloud project id the IAM API is scoped to (the IAM v3 listings are project-scoped).',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      region: {
        type: 'string',
        required: true,
        description: REGION_DESCRIPTION,
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
        const rows = value.rows as readonly { name?: string; accessKeyId?: string }[]
        const names = rows.slice(0, 50).map(row => row.name ?? row.accessKeyId ?? '?')
        return [{ type: 'text', text: `iam: ${rows.length} row(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const resource = String(args.resource) as HuaweiIamResource
      const refName = String(args.credential_ref)
      const pair = parseHuaweiSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runHuawei(
        ctx, exec, resolved,
        buildIamArgv(resolved.command, {
          resource,
          region: String(args.region),
          projectId: String(args.project_id),
        }, pair),
        resolved.command,
      ), `IAM ${resource === 'users' ? 'ListUsers' : 'ListPermanentAccessKeys'}`)
      const value = { rows: parseIamRows(stdout, resource) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate Huawei Cloud IAM resources', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'obs_enum',
    description:
      'List the OBS buckets of one authorized Huawei Cloud account through the granted credentials '
      + '(obsutil ls) and return bucket rows with their listing details. The target_id must match a '
      + 'cloud target declared in the active assessment-scope grant; this is read-only storage '
      + 'reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Huawei Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      region: {
        type: 'string',
        required: true,
        description: 'Explicit Huawei Cloud region for the obsutil -region flag; must fall inside the region allowlist of the matched cloud target.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          buckets: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const buckets = value.buckets as readonly { name?: string; detail?: string }[]
        const names = buckets.slice(0, 50).map(row => row.name ?? '?')
        return [{ type: 'text', text: `obs: ${buckets.length} bucket(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const pair = parseHuaweiSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runHuawei(
        ctx, exec, resolved,
        buildObsListArgv(resolved.obsCommand, { region: String(args.region) }, pair),
        resolved.obsCommand,
      ), 'obsutil ls')
      const value = { buckets: parseObsRows(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate OBS buckets', kind: 'other', rawInput: args }),
  }))

  const GROUP_PARAMETERS = {
    target_id: {
      type: 'string',
      required: true,
      description: 'Huawei Cloud account id holding the user and group, as declared in the assessment scope grant.',
    },
    user_id: {
      type: 'string',
      required: true,
      description: 'IAM user id to add to or remove from the authorization group.',
    },
    group_id: {
      type: 'string',
      required: true,
      description: 'IAM user-group id — the group\'s own policies govern what the membership grants; no group or policy document is ever composed.',
    },
    credential_ref: {
      type: 'string',
      required: true,
      description: CREDENTIAL_REF_DESCRIPTION,
    },
    region: {
      type: 'string',
      required: true,
      description: REGION_DESCRIPTION,
    },
  } as const

  ctx.tools.register(defineTool({
    name: 'iam_group_add_user',
    description:
      'Add one authorized Huawei Cloud user to one IAM user group (Huawei Cloud KooCLI: hcloud IAM '
      + 'KeystoneAddUserToGroup) — group membership inherits the group\'s policies, which verifies the write path. '
      + 'This is a persistence change on the account: the target_id must match a cloud target declared in the '
      + 'active assessment-scope grant, the write action must be granted, and deployments typically require '
      + 'approval for every call. Verify with iam_group_remove_user afterwards.',
    parameters: GROUP_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          added: { type: 'boolean', required: true },
          userId: { type: 'string', required: true },
          groupId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { userId?: string; groupId?: string }
        return [{ type: 'text', text: `added ${result.userId ?? '?'} to group ${result.groupId ?? '?'}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const pair = parseHuaweiSecret(await resolveSecret(ctx, refName))
      const request = { userId: String(args.user_id), groupId: String(args.group_id), region: String(args.region) }
      await requireSuccess(await runHuawei(ctx, exec, resolved,
        buildGroupAddArgv(resolved.command, request, pair), resolved.command), 'IAM KeystoneAddUserToGroup')
      const value = { added: true, userId: request.userId, groupId: request.groupId }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Add a user to an IAM group', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'iam_group_remove_user',
    description:
      'Remove one authorized Huawei Cloud user from one IAM user group (Huawei Cloud KooCLI: hcloud IAM '
      + 'KeystoneRemoveUserFromGroup). This is a persistence change on the account: the target_id must match a '
      + 'cloud target declared in the active assessment-scope grant and the write action must be granted; '
      + 'deployments typically require approval for every call. Removing a membership that does not exist fails '
      + 'with a clear CLI error.',
    parameters: GROUP_PARAMETERS,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          removed: { type: 'boolean', required: true },
          userId: { type: 'string', required: true },
          groupId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { userId?: string; groupId?: string }
        return [{ type: 'text', text: `removed ${result.userId ?? '?'} from group ${result.groupId ?? '?'}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const pair = parseHuaweiSecret(await resolveSecret(ctx, refName))
      const request = { userId: String(args.user_id), groupId: String(args.group_id), region: String(args.region) }
      await requireSuccess(await runHuawei(ctx, exec, resolved,
        buildGroupRemoveArgv(resolved.command, request, pair), resolved.command), 'IAM KeystoneRemoveUserFromGroup')
      const value = { removed: true, userId: request.userId, groupId: request.groupId }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Remove a user from an IAM group', kind: 'other', rawInput: args }),
  }))
}
