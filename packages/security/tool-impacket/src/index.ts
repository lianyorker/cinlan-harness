/**
 * Model-facing impacket domain-credential tools. Registers `kerberoast`,
 * `asrep_roast`, and `secrets_dump` on `ctx.tools` and shells out through
 * `ctx.subprocess`. Hashes are parsed into bounded structured rows; the
 * account secret is resolved from `credential_ref` at execution time and
 * never appears in model-visible arguments or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * call must carry a well-formed `credential_ref`, the `target_id` argument
 * must match a target declared in the active assessment-scope grant, the
 * tool name must appear in that policy's `credentialTools` list, and the
 * mapped `credential-use` action must be granted with the presented
 * credential reference. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-impacket
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildKerberoastArgv, parseKerberoastHashes } from './kerberoast.ts'
import { buildAsrepRoastArgv, parseAsrepRoastHashes } from './asreproast.ts'
import { buildSecretsDumpArgv, parseSecretsDumpRows, redactSecretsRows } from './secretsdump.ts'
import type { SecretsRedactionLevel } from './secretsdump.ts'

export const name = 'tool-impacket'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the impacket tools. */
export interface Config {
  /** impacket-GetUserSPNs executable name or path. Default `impacket-GetUserSPNs`. */
  readonly kerberoastCommand?: string
  /** impacket-GetNPUsers executable name or path. Default `impacket-GetNPUsers`. */
  readonly asreproastCommand?: string
  /** impacket-secretsdump executable name or path. Default `impacket-secretsdump`. */
  readonly secretsdumpCommand?: string
  /** Whole-run timeout in milliseconds per call; also the subprocess grace period. Default 300000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in one serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Redaction strength for `secrets_dump` hashes. `full` keeps values for offline cracking; `masked` replaces them. Default `full`. */
  readonly redactionLevel?: SecretsRedactionLevel
}

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set([
  'kerberoastCommand',
  'asreproastCommand',
  'secretsdumpCommand',
  'timeoutMs',
  'maxOutputBytes',
  'redactionLevel',
])

interface ResolvedConfig {
  readonly kerberoastCommand: string
  readonly asreproastCommand: string
  readonly secretsdumpCommand: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly redactionLevel: SecretsRedactionLevel
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-impacket: unsupported config key ${JSON.stringify(key)}`)
  }
  if (config.redactionLevel !== undefined && config.redactionLevel !== 'full' && config.redactionLevel !== 'masked') {
    throw new TypeError('tool-impacket: redactionLevel must be \'full\' or \'masked\'')
  }
  const resolved = {
    kerberoastCommand: config.kerberoastCommand ?? 'impacket-GetUserSPNs',
    asreproastCommand: config.asreproastCommand ?? 'impacket-GetNPUsers',
    secretsdumpCommand: config.secretsdumpCommand ?? 'impacket-secretsdump',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    redactionLevel: config.redactionLevel ?? 'full',
  }
  for (const [key, value] of Object.entries(resolved).filter(([, value]) => typeof value === 'string')) {
    if ((value as string).trim().length === 0) throw new TypeError(`tool-impacket: ${key} must be non-empty`)
  }
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-impacket: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-impacket: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-impacket: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its secret value. */
async function resolvePassword(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-impacket: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-impacket: credential ${ref} is not configured.`)
  }
  return resolved.value
}

interface RunOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | undefined
  readonly signal: string | null | undefined
}

/** Run one impacket command with the standard collection bounds. */
async function runCommand(
  ctx: Context,
  argv: string[],
  command: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<RunOutcome> {
  let commandPath: string
  try {
    commandPath = await ctx.subprocess.resolveExecutable(command, undefined, signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) {
      throw new Error(`tool-impacket: ${command} executable not found. Install impacket or set the matching config command.`)
    }
    throw error
  }
  argv[0] = commandPath
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: tmpdir(),
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 33_554_432 },
      stderr: { maxBytes: 65_536 },
    },
    graceMs: timeoutMs,
    signal,
  })
  const outcome = await handle.done
  const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
  const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0) {
    const detail = stderr.trim().length > 0
      ? stderr.trim().slice(-500)
      : `exit code ${outcome.exitCode ?? 'signal ' + String(outcome.signal)}`
    throw new Error(`tool-impacket: ${command} failed — ${detail}`)
  }
  return { stdout, stderr, exitCode: outcome.exitCode, signal: outcome.signal }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `kerberoast`, `asrep_roast`, and `secrets_dump` tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for commands, timeout, output size, and redaction.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'kerberoast',
    description:
      'Request service tickets for all SPN-bearing accounts in one authorized assessment '
      + 'domain (impacket GetUserSPNs) and return hashcat-format Kerberoasting hash rows '
      + 'with account names for offline cracking. The domain must match a target declared '
      + 'in the active assessment-scope grant and the credential reference must be granted '
      + 'for that target; this is credential use, not exploitation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain to enumerate SPN accounts for, as declared in the assessment scope grant (e.g. lab.example.invalid).',
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
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip when the domain needs explicit routing.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hashes: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const rows = value.hashes as readonly { account?: string }[]
        const lines = rows.slice(0, 50).map(row => `  ${row.account ?? '(unknown account)'} → hash`)
        const suffix = rows.length > 50 ? `\n  … ${rows.length - 50} more` : ''
        return [{
          type: 'text',
          text: `kerberoast: ${value.count} SPN hash row(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const argv = buildKerberoastArgv(resolved.kerberoastCommand, {
        domain: String(args.target_id),
        username: String(args.username),
        password,
        credentialRef: refName,
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
      })
      const outcome = await runCommand(ctx, argv, resolved.kerberoastCommand, resolved.timeoutMs, exec.signal)
      const parsed = parseKerberoastHashes(outcome.stdout)
      const value = {
        hashes: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Request SPN tickets (kerberoast)', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'asrep_roast',
    description:
      'Request pre-authentication data for accounts without Kerberos pre-authentication in '
      + 'one authorized assessment domain (impacket GetNPUsers) and return hashcat-format '
      + 'AS-REP Roasting hash rows with account names for offline cracking. The domain must '
      + 'match a target declared in the active assessment-scope grant and the credential '
      + 'reference must be granted for that target.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain to enumerate no-pre-auth accounts for, as declared in the assessment scope grant.',
      },
      username: {
        type: 'string',
        required: true,
        description: 'Authenticated account name whose granted credential performs the enumeration.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted credential secret. The value never enters the conversation.',
      },
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip when the domain needs explicit routing.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hashes: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const rows = value.hashes as readonly { account?: string }[]
        const lines = rows.slice(0, 50).map(row => `  ${row.account ?? '(unknown account)'} → hash`)
        const suffix = rows.length > 50 ? `\n  … ${rows.length - 50} more` : ''
        return [{
          type: 'text',
          text: `asrep_roast: ${value.count} AS-REP hash row(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const argv = buildAsrepRoastArgv(resolved.asreproastCommand, {
        domain: String(args.target_id),
        username: String(args.username),
        password,
        credentialRef: refName,
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
      })
      const outcome = await runCommand(ctx, argv, resolved.asreproastCommand, resolved.timeoutMs, exec.signal)
      const parsed = parseAsrepRoastHashes(outcome.stdout)
      const value = {
        hashes: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Request AS-REP hashes', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'secrets_dump',
    description:
      'Dump local SAM or directory credentials from one authorized assessment host with '
      + 'an authenticated account (impacket secretsdump) and return structured credential '
      + 'rows (account, rid, LM/NT hash). `-just-dc` switches to the directory DRSUAPI '
      + '(DCSync) dump against a domain controller. The host and domain must match targets '
      + 'declared in the active assessment-scope grant and the credential reference must '
      + 'be granted; hashes are returned for offline analysis under the grant evidence policy.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Host to dump, as declared in the assessment scope grant (hostname or IP).',
      },
      domain: {
        type: 'string',
        required: true,
        description: 'Fully-qualified domain of the authenticated account.',
      },
      username: {
        type: 'string',
        required: true,
        description: 'Authenticated account name whose granted credential performs the dump.',
      },
      credential_ref: {
        type: 'string',
        required: true,
        description: 'Environment-variable-shaped name of the granted credential secret. The value never enters the conversation.',
      },
      dc_ip: {
        type: 'string',
        description: 'Domain controller address for -dc-ip, required for directory (DCSync) dumps.',
      },
      just_dc: {
        type: 'boolean',
        description: 'Dump directory credentials through DRSUAPI (-just-dc) instead of the local registry.',
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
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const rows = value.rows as readonly { account?: string; ntHash?: string }[]
        const lines = rows.slice(0, 50).map(row => `  ${row.account ?? '?'} (NT ${row.ntHash === '[redacted]' ? 'redacted' : 'hash'})`)
        const suffix = rows.length > 50 ? `\n  … ${rows.length - 50} more` : ''
        return [{
          type: 'text',
          text: `secrets_dump: ${value.count} credential row(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const argv = buildSecretsDumpArgv(resolved.secretsdumpCommand, {
        domain: String(args.domain),
        username: String(args.username),
        password,
        target: String(args.target_id),
        credentialRef: refName,
        ...(optionalString(args.dc_ip) !== undefined ? { dcIp: String(args.dc_ip) } : {}),
        ...(args.just_dc !== undefined ? { justDc: args.just_dc === true } : {}),
      })
      const outcome = await runCommand(ctx, argv, resolved.secretsdumpCommand, resolved.timeoutMs, exec.signal)
      const rows = redactSecretsRows(parseSecretsDumpRows(outcome.stdout), resolved.redactionLevel)
      const value = {
        rows: rows as unknown as Record<string, JsonValue>[],
        count: rows.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Dump host credentials', kind: 'other', rawInput: args }),
  }))
}
