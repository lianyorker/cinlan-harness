/**
 * Model-facing passive known-URL fetch tool. Registers `gau_urls` on
 * `ctx.tools` and shells out through `ctx.subprocess`. The tool parses mixed
 * plain/JSON line output into bounded deduplicated URL rows.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` domain is matched against the session grant's declared targets,
 * and the tool name must appear in that policy's `networkTools` list. This
 * package performs no scope checks of its own.
 *
 * @module @cinlan/tool-gau
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildGauArgv, parseGauLines } from './gau.ts'
import type { GauUrlsRequest } from './gau.ts'

export const name = 'tool-gau'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the gau tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `gau`. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-gau: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'gau',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-gau: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-gau: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-gau: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-gau: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Register the `gau_urls` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'gau_urls',
    description:
      'Fetch known URLs for one authorized assessment target domain from passive '
      + 'historical data sources (wayback, commoncrawl, otx, urlscan) and return '
      + 'deduplicated URL rows. This tool never contacts the target domain itself — all '
      + 'queries go to third-party archives. The domain must match a target declared in '
      + 'the active assessment-scope grant; out-of-scope domains are denied before execution.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Root domain as declared in the assessment scope grant (e.g. example.invalid).',
      },
      providers: {
        type: 'array',
        description:
          'Restrict the passive sources (--providers) to a subset of wayback, commoncrawl, '
          + 'otx, urlscan. Omit to use the tool default of all sources.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          urls: {
            type: 'array',
            required: true,
            items: { type: 'string' },
          },
          count: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => {
        const urls = value.urls as readonly string[]
        const lines = urls.slice(0, 50).map(url => `  ${url}`)
        const suffix = urls.length > 50 ? `\n  … ${urls.length - 50} more` : ''
        return [{
          type: 'text',
          text: `gau: ${value.count} known URL(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const rawProviders = Array.isArray(args.providers)
        ? args.providers.map(provider => optionalString(provider)).filter((provider): provider is string => provider !== undefined)
        : undefined
      const request: GauUrlsRequest = {
        domain: String(args.target_id),
        ...(rawProviders !== undefined && rawProviders.length > 0 ? { providers: rawProviders } : {}),
      }
      const argv = buildGauArgv(resolved.command, request)
      let gauPath: string
      try {
        gauPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-gau: gau executable not found (${resolved.command}). Install gau or set config.command.`)
        }
        throw error
      }
      argv[0] = gauPath
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
        throw new Error(`tool-gau: gau failed — ${detail}`)
      }
      const parsed = parseGauLines(stdout)
      const value = {
        urls: parsed,
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Fetch known URLs (gau)', kind: 'other', rawInput: args }),
  }))
}
