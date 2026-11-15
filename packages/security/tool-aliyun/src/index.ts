/**
 * Model-facing Alibaba Cloud read-only tools. Registers `aliyun_identity_get`,
 * `ram_enum`, and `oss_enum` on `ctx.tools` and shells out through
 * `ctx.subprocess` with the aliyun CLI. Every call parses stdout into bounded
 * rows; the AccessKey material is resolved from the model-provided
 * `credential_ref` at execution time and injected through the subprocess
 * environment (`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
 * / `ALIBABA_CLOUD_SECURITY_TOKEN`), never argv, model-visible arguments, tool
 * results, or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `aliyun_identity_get` maps to `credential-use` through that policy's
 * `credentialTools`, while `ram_enum` and `oss_enum` map to `reconnaissance`
 * through `cloudTools`. `target_id` must match a `cloud` grant target whose
 * account id is the target value, and explicit region arguments must fall
 * inside the target's declared region allowlist. This package performs no
 * scope checks of its own.
 *
 * @module @cinlan/tool-aliyun
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildIdentityArgv, buildOssAclArgv, buildOssListArgv, buildRamArgv,
  isPublicOssGrants, parseAliyunEnvSecret, parseCallerIdentity, parseOssAclGrants, parseOssRows, parseRamUsers,
} from './aliyun.ts'

export const name = 'tool-aliyun'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the Alibaba Cloud tools. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `aliyun`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds per subprocess; also the grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Maximum buckets checked for anonymous-read ACLs in one `oss_enum` call. Default 20. */
  readonly maxPublicChecks?: number
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const DEFAULT_MAX_PUBLIC_CHECKS = 20
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes', 'maxPublicChecks'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly maxPublicChecks: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-aliyun: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'aliyun',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxPublicChecks: config.maxPublicChecks ?? DEFAULT_MAX_PUBLIC_CHECKS,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-aliyun: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-aliyun: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-aliyun: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxPublicChecks) || resolved.maxPublicChecks < 0 || resolved.maxPublicChecks > 1000) {
    throw new TypeError('tool-aliyun: maxPublicChecks must be an integer between 0 and 1000')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-aliyun: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-aliyun: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-aliyun: credential ${ref} is not configured.`)
  }
  return resolved.value
}

/**
 * Resolve the optional `credential_ref` argument into environment entries.
 * An absent reference leaves the credentials to the local aliyun
 * configuration chain; a presented reference must resolve and parse.
 * @param ctx - registrant context carrying the credential provider.
 * @param args - the tool call's arguments.
 * @returns environment entries for the aliyun subprocess, or undefined.
 */
async function resolveAliyunEnv(ctx: Context, args: { readonly credential_ref?: unknown }): Promise<Record<string, string> | undefined> {
  const ref = typeof args.credential_ref === 'string' && args.credential_ref.length > 0 ? args.credential_ref : undefined
  if (ref === undefined) return undefined
  return parseAliyunEnvSecret(await resolveSecret(ctx, ref))
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Spawn one aliyun subprocess under the deployment timeout and read its
 * collected streams. Credentials ride in `env` and never in argv.
 */
async function runAliyun(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
  env?: Record<string, string>,
): Promise<RunOutcome> {
  let aliyunPath: string
  try {
    aliyunPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-aliyun: aliyun executable not found (${resolved.command}). Install Alibaba Cloud CLI or set config.command.`)
    }
    throw error
  }
  argv[0] = aliyunPath
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
    ...(env === undefined ? {} : { env }),
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
    throw new Error(`tool-aliyun: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const REGION_DESCRIPTION =
  'Explicit Alibaba Cloud region for --region; must fall inside the region allowlist of the matched cloud target. RAM is a global product: use the account\'s center region.'

const CREDENTIAL_REF_DESCRIPTION =
  'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_ALIYUN_KEYS). The value never enters the conversation.'

/**
 * Register the three read-only Alibaba Cloud tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'aliyun_identity_get',
    description:
      'Confirm which Alibaba Cloud identity the granted credentials resolve to (aliyun sts '
      + 'GetCallerIdentity) and return the identity type, account id, and ARN. The target_id must match '
      + 'a cloud target declared in the active assessment-scope grant and the credential reference must '
      + 'be granted; this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Alibaba Cloud account id to confirm access to, as declared in the assessment scope grant.',
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
          identityType: { type: 'string', required: true },
          accountId: { type: 'string', required: true },
          arn: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const identity = value as { identityType?: string; accountId?: string; arn?: string }
        return [{ type: 'text', text: `caller: ${identity.accountId ?? '?'} (${identity.identityType ?? '?'}) ${identity.arn ?? ''}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const env = parseAliyunEnvSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runAliyun(
        ctx, exec, resolved,
        buildIdentityArgv(resolved.command, { region: String(args.region), credentialRef: refName }),
        env,
      ), 'sts GetCallerIdentity')
      const identity = parseCallerIdentity(stdout)
      const value = { identityType: identity.identityType, accountId: identity.accountId, arn: identity.arn }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm Alibaba Cloud caller identity', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'ram_enum',
    description:
      'Enumerate the RAM users of one authorized Alibaba Cloud account through the granted credentials '
      + '(aliyun ram ListUsers) and return bounded user rows. The target_id must match a cloud target '
      + 'declared in the active assessment-scope grant; this is read-only RAM reconnaissance, not '
      + 'exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Alibaba Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      limit: {
        type: 'number',
        description: 'Row count for the listing page via --PageSize (1 through 1000). Default 100.',
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local aliyun configuration chain supplies the credentials.',
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
        const rows = value.rows as readonly { name?: string }[]
        const names = rows.slice(0, 50).map(row => row.name ?? '?')
        return [{ type: 'text', text: `ram: ${rows.length} user(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const env = await resolveAliyunEnv(ctx, args)
      const stdout = await requireSuccess(await runAliyun(
        ctx, exec, resolved,
        buildRamArgv(resolved.command, {
          limit: typeof args.limit === 'number' && Number.isSafeInteger(args.limit) ? args.limit : 100,
          region: String(args.region),
        }),
        env,
      ), 'ram ListUsers')
      const value = { rows: parseRamUsers(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate RAM users', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'oss_enum',
    description:
      'List the OSS buckets of one authorized Alibaba Cloud account through the granted credentials '
      + '(aliyun oss ls) and optionally check each bucket\'s ACL for anonymous-read grants with '
      + 'ossutil api get-bucket-acl. The target_id must match a cloud target declared in the active '
      + 'assessment-scope grant; this is read-only storage reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Alibaba Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local aliyun configuration chain supplies the credentials.',
      },
      region: {
        type: 'string',
        required: true,
        description: REGION_DESCRIPTION,
      },
      public_status: {
        type: 'boolean',
        description: 'Also run get-bucket-acl per bucket and report whether anonymous-read grants exist (requires an aliyun CLI with embedded ossutil 2.0).',
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
        const buckets = value.buckets as readonly { name?: string; publicStatus?: string }[]
        const names = buckets.slice(0, 50).map(row => row.name ?? '?')
        const publicCount = buckets.filter(row => row.publicStatus === 'public').length
        return [{
          type: 'text',
          text: `oss: ${buckets.length} bucket(s), ${publicCount} publicly readable\n  ${names.join('\n  ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const env = await resolveAliyunEnv(ctx, args)
      const region = String(args.region)
      const stdout = await requireSuccess(await runAliyun(
        ctx, exec, resolved,
        buildOssListArgv(resolved.command, { region }),
        env,
      ), 'oss ls')
      interface BucketRow { readonly name: string; readonly detail: string; publicStatus?: string }
      const rows: BucketRow[] = parseOssRows(stdout).map(bucket => ({ ...bucket }))
      if (args.public_status === true) {
        for (const bucket of rows.slice(0, resolved.maxPublicChecks)) {
          const aclRun = await runAliyun(ctx, exec, resolved,
            buildOssAclArgv(resolved.command, { bucket: bucket.name, region }), env)
          bucket.publicStatus = aclRun.exitCode === 0
            ? (isPublicOssGrants(parseOssAclGrants(aclRun.stdout)) ? 'public' : 'not-public')
            : 'unknown'
        }
        for (const bucket of rows.slice(resolved.maxPublicChecks)) {
          bucket.publicStatus = 'skipped'
        }
      }
      const value = { buckets: rows as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate OSS buckets', kind: 'other', rawInput: args }),
  }))
}
