/**
 * Model-facing Tencent Cloud read-only tools. Registers `tencent_identity_get`,
 * `cam_enum`, and `cos_enum` on `ctx.tools` and shells out through
 * `ctx.subprocess` with the tccli. Every call parses JSON stdout into bounded
 * rows; the CAM secret key material is resolved from the model-provided
 * `credential_ref` at execution time and injected through the subprocess
 * environment (`TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` /
 * `TENCENTCLOUD_SESSION_TOKEN`), never argv, model-visible arguments, tool
 * results, or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `tencent_identity_get` maps to `credential-use` through that policy's
 * `credentialTools`, while `cam_enum` and `cos_enum` map to `reconnaissance`
 * through `cloudTools`. `target_id` must match a `cloud` grant target whose
 * account id is the target value, and explicit region arguments must fall
 * inside the target's declared region allowlist. This package performs no
 * scope checks of its own.
 *
 * @module @cinlan/tool-tencent
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildCamArgv, buildCosAclArgv, buildCosServiceArgv, buildIdentityArgv,
  isPublicGrants, parseAclGrants, parseCamRows, parseCallerIdentity, parseCosBuckets,
  parseTencentEnvSecret,
} from './tencent.ts'
import type { CamResource } from './tencent.ts'

export const name = 'tool-tencent'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the Tencent Cloud tools. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `tccli`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds per subprocess; also the grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Maximum buckets checked for anonymous-read ACLs in one `cos_enum` call. Default 20. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-tencent: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'tccli',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxPublicChecks: config.maxPublicChecks ?? DEFAULT_MAX_PUBLIC_CHECKS,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-tencent: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-tencent: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-tencent: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxPublicChecks) || resolved.maxPublicChecks < 0 || resolved.maxPublicChecks > 1000) {
    throw new TypeError('tool-tencent: maxPublicChecks must be an integer between 0 and 1000')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-tencent: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-tencent: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-tencent: credential ${ref} is not configured.`)
  }
  return resolved.value
}

/**
 * Resolve the optional `credential_ref` argument into environment entries.
 * An absent reference leaves the credentials to the local tccli
 * configuration chain; a presented reference must resolve and parse.
 * @param ctx - registrant context carrying the credential provider.
 * @param args - the tool call's arguments.
 * @returns environment entries for the tccli subprocess, or undefined.
 */
async function resolveTencentEnv(ctx: Context, args: { readonly credential_ref?: unknown }): Promise<Record<string, string> | undefined> {
  const ref = typeof args.credential_ref === 'string' && args.credential_ref.length > 0 ? args.credential_ref : undefined
  if (ref === undefined) return undefined
  return parseTencentEnvSecret(await resolveSecret(ctx, ref))
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Spawn one tccli subprocess under the deployment timeout and read its
 * collected streams. Credentials ride in `env` and never in argv.
 */
async function runTccli(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
  env?: Record<string, string>,
): Promise<RunOutcome> {
  let tccliPath: string
  try {
    tccliPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-tencent: tccli executable not found (${resolved.command}). Install Tencent Cloud tccli or set config.command.`)
    }
    throw error
  }
  argv[0] = tccliPath
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
    throw new Error(`tool-tencent: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const REGION_DESCRIPTION =
  'Explicit Tencent Cloud region for --region; must fall inside the region allowlist of the matched cloud target.'

const CREDENTIAL_REF_DESCRIPTION =
  'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_TENCENT_KEYS). The value never enters the conversation.'

/**
 * Register the three read-only Tencent Cloud tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, output size, and public-check budget.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'tencent_identity_get',
    description:
      'Confirm which Tencent Cloud CAM identity the granted credentials resolve to '
      + '(tccli sts GetCallerIdentity) and return the caller user id, account id, and ARN. The target_id '
      + 'must match a cloud target declared in the active assessment-scope grant and the credential '
      + 'reference must be granted; this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Tencent Cloud account id to confirm access to, as declared in the assessment scope grant.',
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
          arn: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const identity = value as { userId?: string; accountId?: string; arn?: string }
        return [{ type: 'text', text: `caller: ${identity.accountId ?? '?'} / ${identity.userId ?? '?'} (${identity.arn ?? '?'})` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const env = parseTencentEnvSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runTccli(
        ctx, exec, resolved,
        buildIdentityArgv(resolved.command, { region: String(args.region), credentialRef: refName }),
        env,
      ), 'sts GetCallerIdentity')
      const identity = parseCallerIdentity(stdout)
      const value = { userId: identity.userId, accountId: identity.accountId, arn: identity.arn }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm Tencent Cloud caller identity', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'cam_enum',
    description:
      'Enumerate one authorized Tencent Cloud account through the granted credentials (tccli cam '
      + 'ListUsers or ListRoles) and return bounded resource rows. The target_id must match a cloud '
      + 'target declared in the active assessment-scope grant; this is read-only CAM reconnaissance, '
      + 'not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Tencent Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      resource: {
        type: 'string',
        required: true,
        enum: ['users', 'roles'],
        description: 'CAM collection to list: users or roles.',
      },
      limit: {
        type: 'number',
        description: 'Row bound for the listing page (1 through 1000). Default 100.',
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local tccli configuration chain supplies the credentials.',
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
        return [{ type: 'text', text: `cam: ${rows.length} row(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const resource = String(args.resource) as CamResource
      const env = await resolveTencentEnv(ctx, args)
      const stdout = await requireSuccess(await runTccli(
        ctx, exec, resolved,
        buildCamArgv(resolved.command, {
          resource,
          limit: typeof args.limit === 'number' && Number.isSafeInteger(args.limit) ? args.limit : 100,
          region: String(args.region),
        }),
        env,
      ), `cam ${resource} listing`)
      const value = { rows: parseCamRows(stdout, resource) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate CAM resources', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'cos_enum',
    description:
      'List the COS buckets of one authorized Tencent Cloud account through the granted credentials '
      + '(tccli cos GetService) and optionally check each bucket\'s ACL for anonymous-read grants with '
      + 'GetBucketAcl. The target_id must match a cloud target declared in the active assessment-scope '
      + 'grant; this is read-only storage reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Tencent Cloud account id to enumerate, as declared in the assessment scope grant.',
      },
      region: {
        type: 'string',
        required: true,
        description: REGION_DESCRIPTION,
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local tccli configuration chain supplies the credentials.',
      },
      public_status: {
        type: 'boolean',
        description: 'Also run GetBucketAcl per bucket and report whether anonymous-read grants exist.',
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
          text: `cos: ${buckets.length} bucket(s), ${publicCount} publicly readable\n  ${names.join('\n  ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const region = String(args.region)
      const env = await resolveTencentEnv(ctx, args)
      const stdout = await requireSuccess(await runTccli(
        ctx, exec, resolved,
        buildCosServiceArgv(resolved.command, { region }),
        env,
      ), 'cos GetService')
      interface BucketRow { readonly name: string; readonly location: string; readonly creationDate: string; publicStatus?: string }
      const rows: BucketRow[] = parseCosBuckets(stdout).map(bucket => ({ ...bucket }))
      if (args.public_status === true) {
        for (const bucket of rows.slice(0, resolved.maxPublicChecks)) {
          const aclRun = await runTccli(ctx, exec, resolved,
            buildCosAclArgv(resolved.command, { bucket: bucket.name, region }), env)
          bucket.publicStatus = aclRun.exitCode === 0
            ? (isPublicGrants(parseAclGrants(aclRun.stdout)) ? 'public' : 'not-public')
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
    presentCall: args => ({ card: 'generic', title: 'Enumerate COS buckets', kind: 'other', rawInput: args }),
  }))
}
