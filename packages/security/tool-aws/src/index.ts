/**
 * Model-facing AWS read-only tools. Registers `sts_get_caller_identity`,
 * `iam_enum`, and `s3_enum` on `ctx.tools` and shells out through
 * `ctx.subprocess` with the AWS CLI v2. Every call parses JSON stdout into
 * bounded rows; the AWS key material is resolved from the model-provided
 * `credential_ref` at execution time and injected through the subprocess
 * environment, never argv, model-visible arguments, or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `sts_get_caller_identity` maps to `credential-use` through that policy's
 * `credentialTools`, while `iam_enum` and `s3_enum` map to `reconnaissance`
 * through `cloudTools`. `target_id` must match a `cloud` grant target whose
 * account id is the target value, and explicit region arguments must fall
 * inside the target's declared region allowlist. This package performs no
 * scope checks of its own.
 *
 * @module @cinlan/tool-aws
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildIamArgv, buildPolicyStatusArgv, buildS3ListArgv, buildStsArgv,
  parseAwsEnvSecret, parseIamRows, parsePolicyStatus, parseS3Buckets, parseStsIdentity,
} from './aws.ts'
import type { IamResource } from './aws.ts'

export const name = 'tool-aws'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the AWS tools. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `aws`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds per subprocess; also the grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Maximum buckets checked for a public policy in one `s3_enum` call. Default 20. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-aws: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'aws',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxPublicChecks: config.maxPublicChecks ?? DEFAULT_MAX_PUBLIC_CHECKS,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-aws: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-aws: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-aws: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxPublicChecks) || resolved.maxPublicChecks < 0 || resolved.maxPublicChecks > 1000) {
    throw new TypeError('tool-aws: maxPublicChecks must be an integer between 0 and 1000')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-aws: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-aws: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-aws: credential ${ref} is not configured.`)
  }
  return resolved.value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Resolve the optional `credential_ref` argument into environment entries.
 * An absent reference leaves the credentials to the local AWS configuration
 * chain; a presented reference must resolve and parse.
 * @param ctx - registrant context carrying the credential provider.
 * @param args - the tool call's arguments.
 * @returns environment entries for the aws subprocess, or undefined.
 */
async function resolveAwsEnv(ctx: Context, args: { readonly credential_ref?: unknown }): Promise<Record<string, string> | undefined> {
  const ref = optionalString(args.credential_ref)
  if (ref === undefined) return undefined
  return parseAwsEnvSecret(await resolveSecret(ctx, ref))
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/**
 * Spawn one aws subprocess under the deployment timeout and read its
 * collected streams. Credentials ride in `env` and never in argv.
 */
async function runAws(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
  env?: Record<string, string>,
): Promise<RunOutcome> {
  let awsPath: string
  try {
    awsPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-aws: aws executable not found (${resolved.command}). Install AWS CLI v2 or set config.command.`)
    }
    throw error
  }
  argv[0] = awsPath
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
    throw new Error(`tool-aws: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const REGION_DESCRIPTION =
  'Explicit AWS region for --region; must fall inside the region allowlist of the matched cloud target.'

const CREDENTIAL_REF_DESCRIPTION =
  'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_AWS_KEYS). '
  + 'The value never enters the conversation.'

/**
 * Register the three read-only AWS tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, output size, and public-check budget.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'sts_get_caller_identity',
    description:
      'Confirm which AWS identity the granted credentials resolve to (aws sts get-caller-identity) '
      + 'and return the caller user id, account id, and ARN. The target_id must match a cloud target '
      + 'declared in the active assessment-scope grant and the credential reference must be granted; '
      + 'this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'AWS account id to confirm access to, as declared in the assessment scope grant.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: CREDENTIAL_REF_DESCRIPTION,
      },
      region: {
        type: 'string',
        description: REGION_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          userId: { type: 'string', required: true },
          account: { type: 'string', required: true },
          arn: { type: 'string', required: true },
        },
      },
      render: (_args, value) => {
        const identity = value as { userId?: string; account?: string; arn?: string }
        return [{ type: 'text', text: `caller: ${identity.account ?? '?'} / ${identity.userId ?? '?'} (${identity.arn ?? '?'})` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const secret = await resolveSecret(ctx, refName)
      const env = parseAwsEnvSecret(secret)
      const stdout = await requireSuccess(await runAws(
        ctx, exec, resolved,
        buildStsArgv(resolved.command, {
          credentialRef: refName,
          ...(optionalString(args.region) !== undefined ? { region: String(args.region) } : {}),
        }),
        env,
      ), 'sts get-caller-identity')
      const identity = parseStsIdentity(stdout)
      const value = { userId: identity.userId, account: identity.account, arn: identity.arn }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm AWS caller identity', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'iam_enum',
    description:
      'Enumerate one authorized AWS account through the granted credentials (aws iam list-users, '
      + 'list-roles, or account-local list-policies) and return bounded resource rows. The target_id '
      + 'must match a cloud target declared in the active assessment-scope grant; this is read-only '
      + 'IAM reconnaissance, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'AWS account id to enumerate, as declared in the assessment scope grant.',
      },
      resource: {
        type: 'string',
        required: true,
        enum: ['users', 'roles', 'policies'],
        description: 'IAM collection to list: users, roles, or account-local policies.',
      },
      limit: {
        type: 'number',
        description: 'Maximum rows returned via --max-items (1 through 1000). Default 100.',
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local AWS configuration chain supplies the credentials.',
      },
      region: {
        type: 'string',
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
        return [{ type: 'text', text: `iam: ${rows.length} row(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const resource = String(args.resource) as IamResource
      const env = await resolveAwsEnv(ctx, args)
      const stdout = await requireSuccess(await runAws(
        ctx, exec, resolved,
        buildIamArgv(resolved.command, {
          resource,
          limit: typeof args.limit === 'number' && Number.isSafeInteger(args.limit) ? args.limit : 100,
          ...(optionalString(args.region) !== undefined ? { region: String(args.region) } : {}),
        }),
        env,
      ), `iam ${resource} listing`)
      const value = { rows: parseIamRows(stdout, resource) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate IAM resources', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 's3_enum',
    description:
      'List the S3 buckets of one authorized AWS account through the granted credentials '
      + '(aws s3api list-buckets) and optionally check each bucket\'s public-policy status with '
      + 'get-bucket-policy-status. The target_id must match a cloud target declared in the active '
      + 'assessment-scope grant; the public-policy check is region-scoped, so a region that does not '
      + 'match a bucket reports that bucket as unknown. This is read-only storage reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'AWS account id to enumerate, as declared in the assessment scope grant.',
      },
      region: {
        type: 'string',
        description: REGION_DESCRIPTION,
      },
      credential_ref: {
        type: 'string',
        description: CREDENTIAL_REF_DESCRIPTION + ' Optional: without it the local AWS configuration chain supplies the credentials.',
      },
      public_status: {
        type: 'boolean',
        description: 'Also run get-bucket-policy-status per bucket (requires region); buckets without a policy report as unknown.',
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
          text: `s3: ${buckets.length} bucket(s), ${publicCount} public\n  ${names.join('\n  ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const region = optionalString(args.region)
      const env = await resolveAwsEnv(ctx, args)
      const stdout = await requireSuccess(await runAws(
        ctx, exec, resolved,
        buildS3ListArgv(resolved.command, { ...(region !== undefined ? { region } : {}) }),
        env,
      ), 's3api list-buckets')
      interface BucketRow { readonly name: string; readonly creationDate: string; publicStatus?: string }
      const rows: BucketRow[] = parseS3Buckets(stdout).map(bucket => ({ ...bucket }))
      if (args.public_status === true) {
        if (region === undefined) {
          throw new Error('tool-aws: public_status requires an explicit region because get-bucket-policy-status is region-scoped.')
        }
        for (const bucket of rows.slice(0, resolved.maxPublicChecks)) {
          const statusRun = await runAws(ctx, exec, resolved,
            buildPolicyStatusArgv(resolved.command, { bucket: bucket.name, region }), env)
          bucket.publicStatus = statusRun.exitCode === 0
            ? (parsePolicyStatus(statusRun.stdout) === true ? 'public' : 'not-public')
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
    presentCall: args => ({ card: 'generic', title: 'Enumerate S3 buckets', kind: 'other', rawInput: args }),
  }))
}
