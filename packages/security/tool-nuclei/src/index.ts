/**
 * Model-facing nuclei template-based vulnerability scan tool. Registers
 * `nuclei_scan` on `ctx.tools` and shells out through `ctx.subprocess`. The
 * tool parses `-json` output into bounded finding rows and never emits
 * exploit-grade flags (`-dast`, payload mutation) or interactsh callbacks by
 * default.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * `target_id` arguments are matched against the session grant's declared
 * targets, and the tool name must appear in that policy's `networkTools`
 * list. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-nuclei
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildNucleiArgv, parseNucleiJsonLines } from './nuclei.ts'
import type { NucleiScanRequest, NucleiSeverity } from './nuclei.ts'

export const name = 'tool-nuclei'
export const inject = ['tools', 'subprocess']

/** Deployment bounds for the nuclei tool. */
export interface Config {
  /** Executable name or absolute path resolved through `ctx.subprocess`. Default `nuclei`. */
  readonly command?: string
  /** Whole-scan timeout in milliseconds; also the subprocess grace period. Default 600000. */
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
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-nuclei: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    command: config.command ?? 'nuclei',
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputBytes: config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  }
  if (resolved.command.trim().length === 0) throw new TypeError('tool-nuclei: command must be non-empty')
  if (!Number.isSafeInteger(resolved.timeoutMs) || resolved.timeoutMs < 1_000 || resolved.timeoutMs > 3_600_000) {
    throw new TypeError('tool-nuclei: timeoutMs must be an integer between 1000 and 3600000')
  }
  if (!Number.isSafeInteger(resolved.maxOutputBytes) || resolved.maxOutputBytes < 1) {
    throw new TypeError('tool-nuclei: maxOutputBytes must be a positive safe integer')
  }
  return resolved
}

function enforceResultBytes(value: unknown, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) {
    throw new Error(`tool-nuclei: complete result is ${bytes} bytes; limit is ${maxBytes}`)
  }
}

function stringList(value: unknown): readonly string[] | undefined {
  if (typeof value !== 'string') return undefined
  const items = value
    .split(/[\s,]+/)
    .filter(item => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Register the `nuclei_scan` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and subprocess runtime.
 * @param config - deployment bounds for command, timeout, and output size.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'nuclei_scan',
    description:
      'Run nuclei template-based vulnerability checks against authorized assessment '
      + 'targets and return structured finding rows (template, severity, matched URL). '
      + 'Template selection and severity filtering are exposed; DAST/exploit-grade '
      + 'flags and out-of-band callbacks are disabled by default. Each target must '
      + 'match a target declared in the active assessment-scope grant; out-of-scope '
      + 'targets are denied before execution.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description:
          'Whitespace/comma-separated scan targets as declared in the assessment scope '
          + 'grant: URLs or bare hosts (at most 100).',
      },
      templates: {
        type: 'string',
        description: 'Whitespace/comma-separated template IDs or local template paths (-t). Omit to run the default template set.',
      },
      severities: {
        type: 'string',
        description: 'Whitespace/comma-separated severity filter (-severity): info, low, medium, high, critical.',
      },
      followRedirects: {
        type: 'boolean',
        description: 'Follow 3xx responses (-follow-redirects). Defaults to false.',
      },
      timeoutSeconds: {
        type: 'integer',
        description: 'Per-request timeout in seconds (-timeout). Defaults to nuclei\'s 10.',
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
        const results = value.results as readonly { templateId?: string; severity?: string; matchedAt?: string }[]
        const lines = results.slice(0, 50).map(r => `  [${r.severity ?? '?'}] ${r.templateId ?? '?'} — ${r.matchedAt ?? r.templateId ?? '?'}`)
        const suffix = results.length > 50 ? `\n  … ${results.length - 50} more` : ''
        return [{
          type: 'text',
          text: `nuclei: ${value.count} finding(s)\n${lines.join('\n')}${suffix}`,
        }]
      },
    },
    async execute(args, exec) {
      const targets = String(args.target_id)
        .split(/[\s,]+/)
        .filter(t => t.length > 0)
      const templates = stringList(args.templates)
      const severities = stringList(args.severities)
      const request: NucleiScanRequest = {
        targets,
        ...(templates !== undefined ? { templates } : {}),
        ...(severities !== undefined ? { severities: severities as readonly NucleiSeverity[] } : {}),
        ...(args.followRedirects !== undefined ? { followRedirects: args.followRedirects === true } : {}),
        ...(args.timeoutSeconds !== undefined ? { timeoutSeconds: Number(args.timeoutSeconds) } : {}),
      }
      const argv = buildNucleiArgv(resolved.command, request)
      let nucleiPath: string
      try {
        nucleiPath = await ctx.subprocess.resolveExecutable(resolved.command, undefined, exec.signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-nuclei: nuclei executable not found (${resolved.command}). Install nuclei or set config.command.`)
        }
        throw error
      }
      argv[0] = nucleiPath
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
        throw new Error(`tool-nuclei: nuclei failed — ${detail}`)
      }
      const parsed = parseNucleiJsonLines(stdout)
      const value = {
        results: parsed as unknown as Record<string, JsonValue>[],
        count: parsed.length,
      }
      enforceResultBytes(value, resolved.maxOutputBytes)
      return value
    },
    presentCall: args => ({ card: 'generic', title: 'Run nuclei template scan', kind: 'other', rawInput: args }),
  }))
}
