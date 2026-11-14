/**
 * Model-facing passive subdomain enumeration tool. Registers `subfinder_enum`
 * on `ctx.tools` and shells out through `ctx.subprocess`. The tool parses
 * `-json` output into bounded structured rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` domain is matched against the session grant's declared targets,
 * and the tool name must appear in that policy's `networkTools` list. This
 * package performs no scope checks of its own. The enumeration itself is
 * passive: subfinder queries third-party data sources and DNS, not the
 * target's own services.
 *
 * @module @cinlan/tool-subfinder
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildSubfinderArgv, parseSubfinderJsonLines } from './subfinder.ts'
import type { SubfinderEnumRequest } from './subfinder.ts'

export const name = 'tool-subfinder'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the subfinder tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `subfinder`. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-subfinder: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'subfinder',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-subfinder: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-subfinder: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-subfinder: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-subfinder: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/**
 * Register the `subfinder_enum` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'subfinder_enum',
    description:
      'Passively enumerate subdomains of one authorized assessment target domain '
      + 'and return structured rows: hostname, data source, and resolved addresses. '
      + 'Queries third-party passive data sources and DNS; never sends requests to '
      + 'the target itself. The domain must match a target declared in the active '
      + 'assessment-scope grant; out-of-scope domains are denied before execution.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Root domain to enumerate as declared in the assessment scope grant '
          + '(e.g. example.com). Do not include a scheme, path, or port.',
      },
      resolve: {
        type: 'boolean',
        description: 'Resolve each discovered subdomain to IP addresses (-resolve). Defaults to false.',
      },
      active: {
        type: 'boolean',
        description: 'Report only resolved and active hosts (-active). Defaults to false.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const results = value.results as readonly { host?: string; source?: string }[]
        const lines = results.slice(0, 50).map(r => `  ${r.host ?? '?'}${r.source !== undefined ? ` (${r.source})` : ''}`)
        const suffix = results.length > 50 ? `\n  … ${results.length - 50} more` : ''
        return [{
          type: 'text',
          text: `subfinder: ${value.count} subdomain(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const request: SubfinderEnumRequest = {
        domain: String(args.target_id),
        ...(args.resolve !== undefined ? { resolve: args.resolve === true } : {}),
        ...(args.active !== undefined ? { active: args.active === true } : {}),
      }
      const argv = buildSubfinderArgv(resolved.command, request)
      let subfinderPath: string
      try {
        subfinderPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-subfinder: subfinder executable not found (${resolved.command}). Install subfinder or set config.command.`)
        }
        throw error
      }
      argv[0] = subfinderPath
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
        throw new Error(`tool-subfinder: subfinder failed — ${detail}`)
      }
      const parsed = parseSubfinderJsonLines(stdout)
      const value = {
        results: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Enumerate subdomains (subfinder)', kind: 'other', rawInput: args }),
  }))
}
