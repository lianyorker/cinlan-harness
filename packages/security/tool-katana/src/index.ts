/**
 * Model-facing katana URL-crawl tool. Registers `katana_crawl` on `ctx.tools`
 * and shells out through `ctx.subprocess`. The tool parses `-json` output into
 * bounded structured discovery rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` URL host is matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-katana
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildKatanaArgv, parseKatanaJsonLines } from './katana.ts'
import type { KatanaCrawlRequest } from './katana.ts'

export const name = 'tool-katana'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the katana tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `katana`. */
  readonly command?: string
  /** Whole-run timeout in milliseconds; also the subprocess grace period. Default 180000. */
  readonly timeoutMs?: number
  /** Maximum UTF-8 bytes in the serialized tool result. Default 262144. */
  readonly maxOutputBytes?: number
  /** Deployment cap for the model-selected `-c` worker count. Default 10. */
  readonly maxConcurrency?: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_MAX_OUTPUT_BYTES = 262_144
const DEFAULT_MAX_CONCURRENCY = 10
const CONFIG_KEYS = new Set(['command', 'timeoutMs', 'maxOutputBytes', 'maxConcurrency'])

interface ResolvedConfig {
  readonly command: string
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly maxConcurrency: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-katana: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'katana',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxConcurrency: config.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-katana: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-katana: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-katana: maxOutputBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(resolved.maxConcurrency) || resolved.maxConcurrency < 1) {
    throw new TypeError('tool-katana: maxConcurrency must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-katana: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Register the `katana_crawl` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, output size, and concurrency cap.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'katana_crawl',
    description:
      'Crawl one authorized assessment target URL with katana and return structured '
      + 'discovery rows (url, method, status, source, tag). The URL host must match a '
      + 'target declared in the active assessment-scope grant; out-of-scope URLs are '
      + 'denied before execution. Crawling follows links and forms on the granted host '
      + 'only — no exploitation payloads are delivered.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Absolute http(s) crawl start URL whose host is declared in the assessment scope '
          + 'grant (e.g. https://example.invalid/).',
      },
      depth: {
        type: 'integer',
        description: 'Maximum crawl depth (-d), 1 through 5. Defaults to 3.',
      },
      concurrency: {
        type: 'integer',
        description:
          'Concurrent workers (-c). The deployment-configured cap (maxConcurrency) limits '
          + 'the accepted value.',
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
            items: {
              type: 'object',
              additionalProperties: true,
            },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const rows = value.rows as readonly { url?: string; status?: number; source?: string }[]
        const lines = rows.slice(0, 50).map((row) => {
          const status = typeof row.status === 'number' ? ` [${row.status}]` : ''
          const source = row.source !== undefined ? ` (${row.source})` : ''
          return `  ${row.url ?? '?'}${status}${source}`
        })
        const suffix = rows.length > 50 ? `\n  … ${rows.length - 50} more` : ''
        return [{
          type: 'text',
          text: `katana: ${value.count} discovery row(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const request: KatanaCrawlRequest = {
        url: String(args.target_id),
        ...(args.depth !== undefined ? { depth: optionalNumber(args.depth) ?? 3 } : {}),
        ...(args.concurrency !== undefined ? { concurrency: optionalNumber(args.concurrency) ?? 1 } : {}),
      }
      const argv = buildKatanaArgv(resolved.command, request, resolved.maxConcurrency)
      let katanaPath: string
      try {
        katanaPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-katana: katana executable not found (${resolved.command}). Install katana or set config.command.`)
        }
        throw error
      }
      argv[0] = katanaPath
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
        throw new Error(`tool-katana: katana failed — ${detail}`)
      }
      const parsed = parseKatanaJsonLines(stdout)
      const value = {
        rows: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Crawl target URL (katana)', kind: 'other', rawInput: args }),
  }))
}
