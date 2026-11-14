/**
 * Model-facing ffuf directory/parameter fuzz tool. Registers `ffuf_fuzz` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The tool parses `-json`
 * stdout into bounded match rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * fuzz URL's host is matched against the session grant's declared targets,
 * and the tool name must appear in that policy's `networkTools` list. This
 * package performs no scope checks of its own.
 *
 * @module @cinlan/tool-ffuf
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildFfufArgv, parseFfufJson } from './ffuf.ts'
import type { FfufFuzzRequest } from './ffuf.ts'

export const name = 'tool-ffuf'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the ffuf tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `ffuf`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds; also the subprocess grace period. Default 600000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-ffuf: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'ffuf',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-ffuf: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-ffuf: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-ffuf: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-ffuf: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function codeList(value: unknown): readonly number[] | undefined {
  if (typeof value !== 'string') return undefined
  const items = value
    .split(/[\s,]+/)
    .filter(item => item.length > 0)
    .map(item => Number.parseInt(item, 10))
    .filter(code => Number.isSafeInteger(code))
  return items.length > 0 ? items : undefined
}

/**
 * Register the `ffuf_fuzz` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'ffuf_fuzz',
    description:
      'Fuzz one authorized assessment target URL with ffuf and a local wordlist: '
      + 'directory/file discovery, parameter names, or header values depending on '
      + 'where the FUZZ keyword sits. Returns structured match rows (keyword, URL, '
      + 'status, length). The URL host must match a target declared in the active '
      + 'assessment-scope grant; out-of-scope URLs are denied before execution. '
      + 'Rate is left at ffuf defaults — no aggressive fuzzing flags are emitted.',
    parameters: {
      url: {
        type: 'string',
        required: true,
        description:
          'Target URL containing the literal FUZZ keyword where wordlist entries are '
          + 'substituted, e.g. https://target.example.com/FUZZ or '
          + 'https://target.example.com/search?q=FUZZ.',
      },
      wordlist: {
        type: 'string',
        required: true,
        description: 'Absolute or relative wordlist file path on the execution host (-w).',
      },
      method: {
        type: 'string',
        description: 'HTTP method (-X), e.g. POST. Defaults to GET.',
      },
      matchCodes: {
        type: 'string',
        description: 'Whitespace/comma-separated status codes to keep (-mc), e.g. 200,301,403.',
      },
      autoCalibrate: {
        type: 'boolean',
        description: 'Auto-filter noise responses (-ac). Defaults to true.',
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow redirects (-r). Defaults to false.',
      },
      timeoutSeconds: {
        type: 'integer',
        description: 'Per-request timeout in seconds (-timeout). Defaults to ffuf\'s 10.',
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
        const results = value.results as readonly { keyword?: string; status?: number; url?: string }[]
        const lines = results.slice(0, 50).map(r => `  [${r.status ?? '?'}] ${r.keyword ?? '?'} → ${r.url ?? '?'}`)
        const suffix = results.length > 50 ? `\n  … ${results.length - 50} more` : ''
        return [{
          type: 'text',
          text: `ffuf: ${value.count} match(es)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const matchCodes = codeList(args.matchCodes)
      const request: FfufFuzzRequest = {
        url: String(args.url),
        wordlist: String(args.wordlist),
        ...(args.method !== undefined ? { method: String(args.method) } : {}),
        ...(matchCodes !== undefined ? { matchCodes } : {}),
        ...(args.autoCalibrate !== undefined ? { autoCalibrate: args.autoCalibrate === true } : {}),
        ...(args.followRedirects !== undefined ? { followRedirects: args.followRedirects === true } : {}),
        ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: Number(args.timeoutSeconds) } : {}),
      }
      const argv = buildFfufArgv(resolved.command, request)
      let ffufPath: string
      try {
        ffufPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-ffuf: ffuf executable not found (${resolved.command}). Install ffuf or set config.command.`)
        }
        throw error
      }
      argv[0] = ffufPath
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
        throw new Error(`tool-ffuf: ffuf failed — ${detail}`)
      }
      const parsed = parseFfufJson(stdout)
      const value = {
        results: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Fuzz target with ffuf', kind: 'other', rawInput: args }),
  }))
}
