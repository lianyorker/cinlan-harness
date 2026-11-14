/**
 * Model-facing naabu fast port-scan tool. Registers `naabu_scan` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The tool parses
 * `-json` output into bounded structured rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` arguments are matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-naabu
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildNaabuArgv, parseNaabuJsonLines } from './naabu.ts'
import type { NaabuScanRequest } from './naabu.ts'

export const name = 'tool-naabu'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the naabu tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `naabu`. */
  readonly command?: string
  /** Whole-scan timeout in milliseconds; also the subprocess grace period. Default 180000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-naabu: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'naabu',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-naabu: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-naabu: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-naabu: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-naabu: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `naabu_scan` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'naabu_scan',
    description:
      'Run a naabu fast TCP port scan against authorized assessment targets and '
      + 'return structured open-port rows (host, IP, port). Discovers open ports '
      + 'only — no service fingerprinting, vulnerability probing, or payload '
      + 'delivery. Each target must match a target declared in the active '
      + 'assessment-scope grant; out-of-scope targets are denied before execution. '
      + 'SYN scanning requires elevated privileges on most platforms.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Whitespace/comma-separated scan targets as declared in the assessment scope '
          + 'grant: hostnames, IPv4/IPv6 addresses, or CIDR ranges (at most 1000).',
      },
      ports: {
        type: 'string',
        description: 'Port specification for -p: digits, commas, hyphens (e.g. 22,80,443 or 1-1000). Required unless topPorts is given.',
      },
      topPorts: {
        type: 'integer',
        description: 'Scan the N most common ports (-top-ports). Mutually exclusive with ports.',
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
        const results = value.results as readonly { host?: string; port?: number }[]
        const lines = results.slice(0, 50).map(r => `  ${r.host ?? '?'}:${r.port ?? '?'}`)
        const suffix = results.length > 50 ? `\n  … ${results.length - 50} more` : ''
        return [{
          type: 'text',
          text: `naabu: ${value.count} open port(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const targets = String(args.target_id)
        .split(/[\s,]+/)
        .filter(t => t.length > 0)
      const request: NaabuScanRequest = {
        targets,
        ports: optionalString(args.ports) ?? '',
        ...(args.topPorts !== undefined ? { topPorts: Number(args.topPorts) } : {}),
      }
      const argv = buildNaabuArgv(resolved.command, request)
      let naabuPath: string
      try {
        naabuPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-naabu: naabu executable not found (${resolved.command}). Install naabu or set config.command.`)
        }
        throw error
      }
      argv[0] = naabuPath
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
        throw new Error(`tool-naabu: naabu failed — ${detail}`)
      }
      const parsed = parseNaabuJsonLines(stdout)
      const value = {
        results: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Fast port scan (naabu)', kind: 'other', rawInput: args }),
  }))
}
