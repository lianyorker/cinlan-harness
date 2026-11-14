/**
 * Model-facing masscan SYN rate-scan tool. Registers `masscan_scan` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The tool emits `-oJ -`
 * and parses the streamed JSON array into bounded structured open-port rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` argument is matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-masscan
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildMasscanArgv, parseMasscanJson } from './masscan.ts'
import type { MasscanScanRequest } from './masscan.ts'

export const name = 'tool-masscan'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the masscan tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `masscan`. */
  readonly command?: string
  /** Whole-scan timeout in milliseconds; also the subprocess grace period. Default 120000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Deployment cap for the model-selected `--rate`. Default 1000. */
  readonly maxRate?: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const DEFAULT_MAX_RATE = 1_000
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes', 'maxRate'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly maxRate: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-masscan: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'masscan',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxRate: config.maxRate ?? DEFAULT_MAX_RATE,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-masscan: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-masscan: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-masscan: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxRate) || resolved.maxRate < 1 || resolved.maxRate > 1_000_000) {
    throw new TypeError('tool-masscan: maxRate must be an integer between 1 and 1000000')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-masscan: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `masscan_scan` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, output size, and rate cap.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'masscan_scan',
    description:
      'Run a masscan SYN rate-scan against one authorized assessment target and return '
      + 'structured open-port rows (ip, port). The target must match a target declared in '
      + 'the active assessment-scope grant; out-of-scope targets are denied before '
      + 'execution. The scan rate is capped by deployment config and no service probing, '
      + 'vulnerability checking, or payload delivery is performed.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Scan target as declared in the assessment scope grant: IPv4/IPv6 address, CIDR '
          + 'range, or start-end IP range (e.g. 192.0.2.10, 10.0.0.0/24, 10.0.0.1-10.0.0.9).',
      },
      ports: {
        type: 'string',
        description: 'Port specification for -p: digits, commas, hyphens (e.g. 22,80,443 or 1-1024).',
      },
      rate: {
        type: 'integer',
        description:
          'Packets per second (--rate). Defaults to 100; the deployment-configured cap '
          + '(maxRate) limits the accepted value.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hosts: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          hostCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const hosts = value.hosts as readonly { ip?: string; ports?: readonly { port?: number }[] }[]
        const lines = hosts.slice(0, 50).map((host) => {
          const ports = (host.ports ?? []).map(port => port.port).join(',')
          return `  ${host.ip ?? '?'} ${ports.length > 0 ? ports : '(no open ports)'}`
        })
        const suffix = hosts.length > 50 ? `\n  … ${hosts.length - 50} more` : ''
        return [{
          type: 'text',
          text: `masscan: ${value.hostCount} host(s) with reported ports\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const request: MasscanScanRequest = {
        target: String(args.target_id),
        ...(optionalString(args.ports) !== undefined ? { ports: String(args.ports) } : {}),
        ...(args.rate !== undefined ? { rate: Number(args.rate) } : {}),
      }
      const argv = buildMasscanArgv(resolved.command, request, resolved.maxRate)
      let masscanPath: string
      try {
        masscanPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-masscan: masscan executable not found (${resolved.command}). Install masscan or set config.command.`)
        }
        throw error
      }
      argv[0] = masscanPath
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
        throw new Error(`tool-masscan: masscan failed — ${detail}`)
      }
      const parsed = parseMasscanJson(stdout)
      const value = {
        hosts: parsed as unknown as Record<string, JsonValue>[],
        hostCount: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Run masscan rate-scan', kind: 'other', rawInput: args }),
  }))
}
