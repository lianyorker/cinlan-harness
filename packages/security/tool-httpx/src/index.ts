/**
 * Model-facing httpx web-service probe tool. Registers `httpx_probe` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The tool parses `-json`
 * output into bounded structured rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` arguments are matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-httpx
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildHttpxArgv, parseHttpxJsonLines } from './httpx.ts'
import type { HttpxProbeRequest } from './httpx.ts'

export const name = 'tool-httpx'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the httpx tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `httpx`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds; also the subprocess grace period. Default 180000. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-httpx: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'httpx',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-httpx: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-httpx: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-httpx: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-httpx: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

/**
 * Register the `httpx_probe` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'httpx_probe',
    description:
      'Probe authorized assessment targets for live HTTP/HTTPS services and return '
      + 'structured rows: URL, status code, title, technologies, web server, and CDN. '
      + 'Each target must match a target declared in the active assessment-scope '
      + 'grant; out-of-scope targets are denied before execution. This is '
      + 'reconnaissance only — no injection, fuzzing, or exploitation payloads are sent.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Whitespace/comma-separated probe targets as declared in the assessment scope '
          + 'grant: hostnames, IPv4/IPv6 addresses, URLs, or CIDR ranges (at most 1000).',
      },
      statusCode: {
        type: 'boolean',
        description: 'Include the HTTP status code (-status-code). Defaults to false.',
      },
      title: {
        type: 'boolean',
        description: 'Extract the page title (-title). Defaults to false.',
      },
      techDetect: {
        type: 'boolean',
        description: 'Report detected technologies (-tech-detect). Defaults to false.',
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow 3xx responses (-follow-redirects). Defaults to false.',
      },
      https: {
        type: 'boolean',
        description: 'Probe https:// scheme (-no-https when false). Defaults to true.',
      },
      http: {
        type: 'boolean',
        description: 'Probe http:// scheme (-no-http when false). Defaults to true.',
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
        const results = value.results as readonly { url?: string; statusCode?: number; title?: string }[]
        const lines = results.slice(0, 50).map((r) => {
          const status = typeof r.statusCode === 'number' ? ` [${r.statusCode}]` : ''
          const title = r.title !== undefined ? ` — ${r.title}` : ''
          return `  ${r.url ?? '?'}${status}${title}`
        })
        const suffix = results.length > 50 ? `\n  … ${results.length - 50} more` : ''
        return [{
          type: 'text',
          text: `httpx: ${value.count} live service(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const targets = String(args.target_id)
        .split(/[\s,]+/)
        .filter(t => t.length > 0)
      const request: HttpxProbeRequest = {
        targets,
        ...(args.statusCode !== undefined ? { statusCode: args.statusCode === true } : {}),
        ...(args.title !== undefined ? { title: args.title === true } : {}),
        ...(args.techDetect !== undefined ? { techDetect: args.techDetect === true } : {}),
        ...(args.followRedirects !== undefined ? { followRedirects: args.followRedirects === true } : {}),
        ...(args.https !== undefined ? { https: args.https === true } : {}),
        ...(args.http !== undefined ? { http: args.http === true } : {}),
      }
      const argv = buildHttpxArgv(resolved.command, request)
      let httpxPath: string
      try {
        httpxPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-httpx: httpx executable not found (${resolved.command}). Install httpx or set config.command.`)
        }
        throw error
      }
      argv[0] = httpxPath
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
        throw new Error(`tool-httpx: httpx failed — ${detail}`)
      }
      const parsed = parseHttpxJsonLines(stdout)
      const value = {
        results: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Probe web services (httpx)', kind: 'other', rawInput: args }),
  }))
}
