/**
 * Model-facing ADCS collection tool. Registers `adcs_find` on `ctx.tools` and
 * shells out through `ctx.subprocess`. The run parses certipy's JSON stdout
 * into bounded certificate-authority and template rows; the account secret is
 * resolved from the model-provided `credential_ref` at execution time and
 * never appears in model-visible arguments or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * tool name must be listed in that policy's `credentialTools`, the call must
 * carry a well-formed `credential_ref`, `target_id` must match a grant target,
 * and the mapped `credential-use` action must be granted with the presented
 * credential reference. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-certipy
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildCertipyFindArgv, parseCertipyFind } from './certipy.ts'
import type { CertipyFindRequest } from './certipy.ts'

export const name = 'tool-certipy'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the certipy tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `certipy`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds; also the subprocess grace period. Default 300000. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-certipy: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'certipy',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-certipy: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-certipy: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-certipy: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-certipy: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its secret value. */
async function resolvePassword(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-certipy: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-certipy: credential ${ref} is not configured.`)
  }
  return resolved.value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `adcs_find` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'adcs_find',
    description:
      'Collect Active Directory Certificate Services configuration from one authorized '
      + 'assessment domain with an authenticated account (certipy find -stdout) and return '
      + 'certificate-authority and template rows. `-vulnerable` restricts the report to '
      + 'entries with known escalation paths (ESC classes). The domain must match a target '
      + 'declared in the active assessment-scope grant and the credential reference must be '
      + 'granted; this is read-only directory collection, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain to collect ADCS configuration from, as declared in the assessment scope grant (e.g. lab.example.invalid).',
      },
      username: {
        type: 'string',
        required: true,
        description: 'Authenticated account name whose granted credential performs the collection.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_AD_PASS). The value never enters the conversation.',
      },
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip.',
      },
      vulnerable_only: {
        type: 'boolean',
        description: 'Report only certificate authorities and templates with known escalation paths (-vulnerable).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cas: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          templates: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const cas = value.cas as readonly { name?: string }[]
        const templates = value.templates as readonly { name?: string }[]
        const caNames = cas.slice(0, 20).map(row => row.name ?? '?')
        const templateNames = templates.slice(0, 50).map(row => row.name ?? '?')
        return [{
          type: 'text',
          text: `adcs: ${cas.length} CA(s) [${caNames.join(', ')}], ${templates.length} template(s)\n  ${templateNames.join('\n  ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const request: CertipyFindRequest = {
        domain: String(args.target_id),
        username: String(args.username),
        password,
        credentialRef: refName,
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
        ...(args.vulnerable_only !== undefined ? { vulnerableOnly: args.vulnerable_only === true } : {}),
      }
      const argv = buildCertipyFindArgv(resolved.command, request)
      let certipyPath: string
      try {
        certipyPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-certipy: certipy executable not found (${resolved.command}). Install certipy-adt or set config.command.`)
        }
        throw error
      }
      argv[0] = certipyPath
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
        throw new Error(`tool-certipy: certipy failed — ${detail}`)
      }
      const parsed = parseCertipyFind(stdout)
      const value = {
        cas: parsed.cas as unknown as Record<string, JsonValue>[],
        templates: parsed.templates as unknown as Record<string, JsonValue>[],
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Collect ADCS configuration', kind: 'other', rawInput: args }),
  }))
}
