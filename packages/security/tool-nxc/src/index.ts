/**
 * Model-facing nxc (NetExec) password-spray tool. Registers `nxc_spray` on
 * `ctx.tools` and shells out through `ctx.subprocess`. Hit lines are parsed
 * into bounded structured rows with the secret scrubbed; the account secret
 * is resolved from `credential_ref` at execution time and never appears in
 * model-visible arguments or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * call must carry a well-formed `credential_ref`, the `target_id` host must
 * match a target declared in the active assessment-scope grant, the tool
 * name must appear in that policy's `credentialTools` list, and the mapped
 * `credential-use` action must be granted with the presented credential
 * reference. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-nxc
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildNxcSprayArgv, parseNxcSprayLines } from './nxc.ts'
import type { NxcSprayRequest } from './nxc.ts'

export const name = 'tool-nxc'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the nxc tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `nxc`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds; also the subprocess grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Deployment cap for the model-selected `--threads`. Default 10. */
  readonly maxThreads?: number
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const DEFAULT_MAX_THREADS = 10
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes', 'maxThreads'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly maxThreads: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-nxc: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'nxc',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxThreads: config.maxThreads ?? DEFAULT_MAX_THREADS,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-nxc: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-nxc: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-nxc: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxThreads) || resolved.maxThreads < 1 || resolved.maxThreads > 100) {
    throw new TypeError('tool-nxc: maxThreads must be an integer between 1 and 100')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-nxc: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its secret value. */
async function resolvePassword(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-nxc: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-nxc: credential ${ref} is not configured.`)
  }
  return resolved.value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Register the `nxc_spray` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, output size, and thread cap.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'nxc_spray',
    description:
      'Try one granted credential against candidate accounts on one authorized assessment '
      + 'host with nxc (NetExec) and return structured hit rows with the secret scrubbed. '
      + 'The host must match a target declared in the active assessment-scope grant and the '
      + 'credential reference must be granted for that target; the thread count is bounded '
      + 'by deployment config. This is credential validation, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Host to validate credentials against, as declared in the assessment scope grant (hostname or IP).',
      },
      usernames: {
        type: 'array',
        required: true,
        description: 'Candidate account names to try with the granted secret (1-100 entries).',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_AD_PASS). The value never enters the conversation.',
      },
      protocol: {
        type: 'string',
        description: 'Protocol subcommand: smb (default), ldap, mssql, winrm, or ssh.',
      },
      domain: {
        type: 'string',
        description: 'Fully-qualified domain for domain-qualified authentication attempts (-d).',
      },
      threads: {
        type: 'integer',
        description: 'Parallel workers (--threads). The deployment-configured cap (maxThreads) limits the accepted value.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hits: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          hitCount: { type: 'integer', required: true },
          failures: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const hits = value.hits as readonly { user?: string }[]
        const lines = hits.map(hit => `  ${hit.user ?? '(unparsed hit)'}`)
        return [{
          type: 'text',
          text: `nxc: ${value.hitCount} hit(s), ${value.failures} failure(s)\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const usernames = Array.isArray(args.usernames)
        ? args.usernames.map(name => optionalString(name)).filter((name): name is string => name !== undefined)
        : []
      const request: NxcSprayRequest = {
        target: String(args.target_id),
        usernames,
        password,
        credentialRef: refName,
        ...(optionalString(args.protocol) !== undefined ? { protocol: String(args.protocol) } : {}),
        ...(optionalString(args.domain) !== undefined ? { domain: String(args.domain) } : {}),
        ...(args.threads !== undefined ? { threads: optionalNumber(args.threads) ?? 1 } : {}),
      }
      const argv = buildNxcSprayArgv(resolved.command, request, resolved.maxThreads)
      let nxcPath: string
      try {
        nxcPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-nxc: nxc executable not found (${resolved.command}). Install NetExec or set config.command.`)
        }
        throw error
      }
      argv[0] = nxcPath
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
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      if (outcome.exitCode !== 0) {
        const detail = stderr.trim().length > 0 ? stderr.trim().slice(-500) : `exit code ${outcome.exitCode ?? 'signal ' + String(outcome.signal)}`
        throw new Error(`tool-nxc: nxc failed — ${detail}`)
      }
      const parsed = parseNxcSprayLines(stdout, [password])
      const value = {
        hits: parsed.hits as unknown as Record<string, JsonValue>[],
        hitCount: parsed.hits.length,
        failures: parsed.failures,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Validate credentials (nxc)', kind: 'other', rawInput: args }),
  }))
}
