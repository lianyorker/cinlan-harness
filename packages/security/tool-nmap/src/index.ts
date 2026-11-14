/**
 * Model-facing nmap port-scan tool. Registers `nmap_scan` on `ctx.tools` and
 * shells out through `ctx.subprocess`. The tool emits no `--script` arguments
 * and parses `-oX -` XML into bounded structured output.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` argument is matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-nmap
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildNmapArgv, parseNmapXml } from './nmap.ts'
import type { NmapScanRequest } from './nmap.ts'

export const name = 'tool-nmap'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the nmap tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `nmap`. */
  readonly command?: string
  /** Whole-scan timeout in milliseconds; also the subprocess grace period. Default 120000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-nmap: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'nmap',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-nmap: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-nmap: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-nmap: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-nmap: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `nmap_scan` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'nmap_scan',
    description:
      'Run an nmap port scan against one authorized assessment target and return '
      + 'structured host/port/service results parsed from XML output. The target '
      + 'must match a target declared in the active assessment-scope grant; '
      + 'out-of-scope targets are denied before execution. No vulnerability '
      + 'scripts are run — this is reconnaissance only.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Scan target as declared in the assessment scope grant: hostname, IPv4/IPv6 '
          + 'address, or CIDR range (e.g. 192.0.2.10, scanme.nmap.org, 10.0.0.0/24).',
      },
      ports: {
        type: 'string',
        description: 'Port specification for -p: digits, commas, hyphens (e.g. 22,80,443 or 1-1024). Mutually exclusive with topPorts.',
      },
      topPorts: {
        type: 'integer',
        description: 'Scan the N most common ports (--top-ports). Mutually exclusive with ports.',
      },
      serviceDetection: {
        type: 'boolean',
        description: 'Enable -sV service/version detection (slower, more accurate service names).',
      },
      osDetection: {
        type: 'boolean',
        description: 'Enable -O OS fingerprinting. Requires elevated privileges on most platforms.',
      },
      openOnly: {
        type: 'boolean',
        description: 'Report only open ports (--open). Defaults to true.',
      },
      timing: {
        type: 'integer',
        description: 'nmap timing template -T0 (paranoid) through -T5 (insane). Defaults to nmap\'s -T3.',
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
          upCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const hosts = value.hosts as readonly { address?: string; status?: string; ports?: readonly unknown[] }[]
        const lines = hosts.map((host) => {
          const portCount = Array.isArray(host.ports) ? host.ports.length : 0
          return `  ${host.address ?? '?'} [${host.status ?? 'unknown'}] ${portCount} port(s)`
        })
        return [{
          type: 'text',
          text: `nmap: ${value.upCount}/${value.hostCount} host(s) up\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args, exec) {
      const request: NmapScanRequest = {
        target: String(args.target_id),
        ...(optionalString(args.ports) !== undefined ? { ports: String(args.ports) } : {}),
        ...(args.topPorts !== undefined ? { topPorts: Number(args.topPorts) } : {}),
        ...(args.serviceDetection !== undefined ? { serviceDetection: args.serviceDetection === true } : {}),
        ...(args.osDetection !== undefined ? { osDetection: args.osDetection === true } : {}),
        ...(args.openOnly !== undefined ? { openOnly: args.openOnly !== false } : {}),
        ...(args.timing !== undefined ? { timing: Number(args.timing) as 0 | 1 | 2 | 3 | 4 | 5 } : {}),
      }
      const argv = buildNmapArgv(resolved.command, request)
      let nmapPath: string
      try {
        nmapPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-nmap: nmap executable not found (${resolved.command}). Install nmap or set config.command.`)
        }
        throw error
      }
      argv[0] = nmapPath
      const handle = ctx.subprocess.spawn({
        argv,
        cwd: tmpdir(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: resolved.maxOutputBytes },
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
        throw new Error(`tool-nmap: nmap failed — ${detail}`)
      }
      const parsed = parseNmapXml(stdout)
      const value = {
        hosts: parsed.hosts as unknown as Record<string, JsonValue>[],
        hostCount: parsed.hostCount,
        upCount: parsed.upCount,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Run nmap scan', kind: 'other', rawInput: args }),
  }))
}
