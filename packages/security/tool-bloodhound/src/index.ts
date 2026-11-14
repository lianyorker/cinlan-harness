/**
 * Model-facing BloodHound collection tool. Registers `bloodhound_enum` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The run collects into
 * a private temporary directory, aggregates the collector JSON into a triage
 * summary, and removes the directory afterwards; the account secret is
 * resolved from `credential_ref` at execution time and never appears in
 * model-visible arguments or the Session log.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * call must carry a well-formed `credential_ref`, the `target_id` domain must
 * match a target declared in the active assessment-scope grant, the tool
 * name must appear in that policy's `credentialTools` list, and the mapped
 * `credential-use` action must be granted with the presented credential
 * reference. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-bloodhound
 */

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { aggregateBloodhoundFiles, buildBloodhoundArgv } from './bloodhound.ts'

export const name = 'tool-bloodhound'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the bloodhound tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `bloodhound-python`. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-bloodhound: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'bloodhound-python',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-bloodhound: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-bloodhound: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-bloodhound: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-bloodhound: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/** Resolve the presented credential reference into its secret value. */
async function resolvePassword(ctx: Context, ref: string): Promise<string> {
  const provider: CredentialProvider | undefined = ctx.get('credentials')
  if (provider === undefined) {
    throw new Error('tool-bloodhound: no credential provider is mounted; mount one (e.g. @deepseek-ai/dsh-credentials-local).')
  }
  const resolved = await provider.resolve(credentialRef(ref))
  if (resolved === undefined) {
    throw new Error(`tool-bloodhound: credential ${ref} is not configured.`)
  }
  return resolved.value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `bloodhound_enum` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'bloodhound_enum',
    description:
      'Collect directory data from one authorized assessment domain with an authenticated '
      + 'account (bloodhound-python -c All) and return a triage summary: per-collector row '
      + 'counts plus the Kerberoastable and AS-REP Roastable account lists extracted from '
      + 'users.json. The domain must match a target declared in the active assessment-scope '
      + 'grant and the credential reference must be granted for that target; collection is '
      + 'read-only directory enumeration, not exploitation. Raw collector JSON stays in a '
      + 'temporary directory that is removed after aggregation.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Domain to collect from, as declared in the assessment scope grant (e.g. lab.example.invalid).',
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
      nameserver: {
        type: 'string',
        description: 'Domain controller address used as the -ns nameserver to resolve the domain.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          collectors: {
            type: 'array',
            required: true,
            items: { type: 'object', additionalProperties: true },
          },
          kerberoastable: { type: 'array', required: true, items: { type: 'string' } },
          asrepRoastable: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const collectors = value.collectors as readonly { file?: string; count?: number }[]
        const counts = collectors.map(entry => `  ${entry.file ?? '?'}: ${entry.count ?? 0}`)
        const kerb = (value.kerberoastable as readonly string[]).slice(0, 50)
        const asrep = (value.asrepRoastable as readonly string[]).slice(0, 50)
        return [{
          type: 'text',
          text: `bloodhound: ${collectors.length} collector file(s)\n${counts.join('\n')}\n`
            + `kerberoastable (${kerb.length}): ${kerb.join(', ')}\n`
            + `asrep-roastable (${asrep.length}): ${asrep.join(', ')}`,
        }]
      },
    },
    async execute(args, exec) {
      const refName = String(args.credential_ref)
      const password = await resolvePassword(ctx, refName)
      const argv = buildBloodhoundArgv(resolved.command, {
        domain: String(args.target_id),
        username: String(args.username),
        password,
        credentialRef: refName,
        ...(optionalString(args.nameserver) !== undefined ? { nameserver: String(args.nameserver) } : {}),
      })
      let bloodhoundPath: string
      try {
        bloodhoundPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-bloodhound: bloodhound-python executable not found (${resolved.command}). Install it or set config.command.`)
        }
        throw error
      }
      argv[0] = bloodhoundPath
      const workdir = await mkdtemp(join(tmpdir(), 'cinlan-bloodhound-'))
      try {
        const handle = ctx.subprocess.spawn({
          argv,
          cwd: workdir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: 1_048_576 },
            stderr: { maxBytes: 65_536 },
          },
          graceMs: resolved.timeoutMs,
          signal: exec.signal,
        })
        const outcome = await handle.done
        const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
        if (outcome.exitCode !== 0) {
          const detail = stderr.trim().length > 0
            ? stderr.trim().slice(-500)
            : `exit code ${outcome.exitCode ?? 'signal ' + String(outcome.signal)}`
          throw new Error(`tool-bloodhound: bloodhound-python failed — ${detail}`)
        }
        const names = await readdir(workdir)
        const files: { name: string; text: string }[] = []
        for (const name of names) {
          if (!name.endsWith('.json')) continue
          files.push({ name, text: await readFile(join(workdir, name), 'utf8') })
        }
        const summary = aggregateBloodhoundFiles(files)
        const value = {
          collectors: summary.collectors as unknown as Record<string, JsonValue>[],
          kerberoastable: [...summary.kerberoastable],
          asrepRoastable: [...summary.asrepRoastable],
        }
        enforceResultBytes(value, resolved.maxOutputBytes)
        return value
      } finally {
        await rm(workdir, { recursive: true, force: true })
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Collect directory data (bloodhound)', kind: 'other', rawInput: args }),
  }))
}
