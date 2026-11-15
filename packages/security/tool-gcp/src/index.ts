/**
 * Model-facing GCP read-only tools. Registers `gcp_identity_get`,
 * `gcp_iam_enum`, and `gcs_enum` on `ctx.tools` and shells out through
 * `ctx.subprocess` with the gcloud CLI. Every call parses JSON stdout into
 * bounded rows; the service-account JSON is resolved from the model-provided
 * `credential_ref` at execution time, written to a private temporary file
 * (mode 0600), and exposed to gcloud only through the
 * `CLOUDSDK_AUTH_CREDENTIALS_FILE_OVERRIDE` environment variable. The secret
 * never reaches argv, model-visible arguments, tool results, or the Session
 * log, and the temporary file is deleted when the call finishes.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`:
 * `gcp_identity_get` maps to `credential-use` through that policy's
 * `credentialTools`, while `gcp_iam_enum` and `gcs_enum` map to
 * `reconnaissance` through `cloudTools`. `target_id` must match a `cloud`
 * grant target whose account id is the target value, and explicit project
 * arguments must fall inside the target's declared project allowlist. This
 * package performs no scope checks of its own.
 *
 * @module @cinlan/tool-gcp
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import {
  buildGcsListArgv, buildIamPolicyArgv, buildIdentityArgv,
  parseAncestors, parseGcsBuckets, parseIamBindings, parseServiceAccountSecret,
} from './gcp.ts'

export const name = 'tool-gcp'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the GCP tools. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `gcloud`. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-gcp: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'gcloud',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-gcp: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-gcp: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-gcp: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-gcp: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its raw secret value. */
async function resolveSecret(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-gcp: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-gcp: credential ${ref} is not configured.`)
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
 * Spawn one gcloud subprocess under the deployment timeout with the
 * service-account file override in the environment, and read its collected
 * streams. The temporary credential file is removed after the subprocess
 * settles, on every path.
 */
async function runGcloud(
  ctx: Context,
  exec: { readonly signal: AbortSignal },
  resolved: ResolvedConfig,
  argv: string[],
  serviceAccountJson: string,
): Promise<RunOutcome> {
  let gcloudPath: string
  try {
    gcloudPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-gcp: gcloud executable not found (${resolved.command}). Install gcloud or set config.command.`)
    }
    throw error
  }
  argv[0] = gcloudPath
  const dir = await mkdtemp(join(tmpdir(), 'tool-gcp-'))
  const credentialsFile = join(dir, 'service-account.json')
  try {
    await writeFile(credentialsFile, serviceAccountJson, { encoding: 'utf8', mode: 0o600 })
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
      env: {
        CLOUDSDK_AUTH_CREDENTIALS_FILE_OVERRIDE: credentialsFile,
        // Explicit project routing keeps the operator's local gcloud defaults
        // out of the path; the argv also carries explicit project arguments.
        CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
      },
    })
    const outcome = await handle.done
    return {
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      exitCode: outcome.exitCode,
      signal: outcome.signal,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function requireSuccess(run: RunOutcome, label: string): string {
  if (run.exitCode !== 0) {
    const detail = run.stderr.trim().length > 0
      ? run.stderr.trim().slice(-500)
      : `exit code ${run.exitCode ?? 'signal ' + String(run.signal)}`
    throw new Error(`tool-gcp: ${label} failed — ${detail}`)
  }
  return run.stdout
}

const PROJECT_DESCRIPTION =
  'GCP project id; must fall inside the project allowlist of the matched cloud target.'

/**
 * Register the three read-only GCP tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'gcp_identity_get',
    description:
      'Confirm which GCP identity the granted service-account credentials resolve to '
      + '(gcloud projects get-ancestors) and return the ancestor chain of one authorized project. '
      + 'The target_id must match a cloud target declared in the active assessment-scope grant, the '
      + 'project must fall inside the target allowlist, and the credential reference must be granted; '
      + 'this is a read-only identity confirmation, not enumeration.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'GCP account to confirm access to, as declared in the assessment scope grant.',
      },
      project: {
        type: 'string',
        required: true,
        description: PROJECT_DESCRIPTION,
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted service-account JSON (e.g. ASSESS_GCP_SA). The value never enters the conversation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ancestors: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const ancestors = value.ancestors as readonly { kind?: string; id?: string }[]
        const names = ancestors.map(row => `${row.kind ?? '?'}:${row.id ?? '?'}`)
        return [{ type: 'text', text: `ancestors: ${names.join(' → ') || '(none)'}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const secret = parseServiceAccountSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runGcloud(
        ctx, exec, resolved,
        buildIdentityArgv(resolved.command, { projectId: String(args.project), credentialRef: refName }),
        secret,
      ), 'projects get-ancestors')
      const value = { ancestors: parseAncestors(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Confirm GCP project ancestry', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'gcp_iam_enum',
    description:
      'Enumerate the IAM policy of one authorized GCP project through the granted service-account '
      + 'credentials (gcloud projects get-iam-policy) and return role-binding rows. The target_id must '
      + 'match a cloud target declared in the active assessment-scope grant and the project must fall '
      + 'inside the target allowlist; this is read-only IAM reconnaissance, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'GCP account to enumerate, as declared in the assessment scope grant.',
      },
      project: {
        type: 'string',
        required: true,
        description: PROJECT_DESCRIPTION,
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted service-account JSON. The value never enters the conversation.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bindings: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const bindings = value.bindings as readonly { role?: string; members?: readonly string[] }[]
        const names = bindings.slice(0, 50).map(row => `${row.role ?? '?'} (${row.members?.length ?? 0} member(s))`)
        return [{ type: 'text', text: `iam: ${bindings.length} binding(s)\n  ${names.join('\n  ')}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const secret = parseServiceAccountSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runGcloud(
        ctx, exec, resolved,
        buildIamPolicyArgv(resolved.command, { projectId: String(args.project) }),
        secret,
      ), 'projects get-iam-policy')
      const value = { bindings: parseIamBindings(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate project IAM policy', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'gcs_enum',
    description:
      'List the Cloud Storage buckets of one authorized GCP project through the granted service-account '
      + 'credentials (gcloud storage buckets list) and return bucket rows with their '
      + 'public-access-prevention setting (enforced means public exposure is blocked). The target_id must '
      + 'match a cloud target declared in the active assessment-scope grant and the project must fall '
      + 'inside the target allowlist; this is read-only storage reconnaissance.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'GCP account to enumerate, as declared in the assessment scope grant.',
      },
      project: {
        type: 'string',
        required: true,
        description: PROJECT_DESCRIPTION,
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted service-account JSON. The value never enters the conversation.',
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
        const buckets = value.buckets as readonly { name?: string; publicAccessPrevention?: string }[]
        const names = buckets.slice(0, 50).map(row => row.name ?? '?')
        const exposed = buckets.filter(row => row.publicAccessPrevention === 'inherited').length
        return [{
          type: 'text',
          text: `gcs: ${buckets.length} bucket(s), ${exposed} without enforced public-access prevention\n  ${names.join('\n  ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const secret = parseServiceAccountSecret(await resolveSecret(ctx, refName))
      const stdout = await requireSuccess(await runGcloud(
        ctx, exec, resolved,
        buildGcsListArgv(resolved.command, { projectId: String(args.project) }),
        secret,
      ), 'storage buckets list')
      const value = { buckets: parseGcsBuckets(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate GCS buckets', kind: 'other', rawInput: args }),
  }))
}
