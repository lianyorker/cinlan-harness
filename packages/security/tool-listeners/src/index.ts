/**
 * Model-facing network listener tools for authorized domain assessments.
 * Registers `responder_capture` and `ntlm_relay` on `ctx.tools` and runs each
 * listener as a generic background job: the call returns a job id at once,
 * captured output streams into the job ring (read with `job_output`), and the
 * listen window, a `job_kill`, or the owner's disposal terminates the session
 * through the job hooks.
 *
 * Authorization is enforced upstream by `assessment-scope-tool-policy`: the
 * tool name must be listed in that policy's `exploitTools`, and `target_id`
 * must match a target declared in the active assessment-scope grant; the
 * mapped `exploit-execution` action requires the grant (and an
 * `approvalRequiredActions` entry turns every call into an approval prompt).
 * Local binds are the listener surface; the relay target is the only
 * outbound destination. This package performs no scope checks of its own.
 *
 * @module @cinlan/tool-listeners
 */

import { tmpdir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { buildNtlmRelayArgv, buildResponderArgv } from './argv.ts'
import { collectedSources, subprocessJob } from './jobs.ts'

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    responder: 'responder'
    ntlmrelayx: 'ntlmrelayx'
  }
}

export const name = 'tool-listeners'
export const inject = ['tools', 'subprocess', 'jobs']

/** Deployment bounds for the listener tools. */
export interface Config {
  /** Responder executable name or absolute path. Default `Responder`. */
  readonly responderCommand?: string
  /** ntlmrelayx executable name or absolute path. Default `ntlmrelayx`. */
  readonly ntlmrelayxCommand?: string
  /** Maximum listen window in milliseconds for one session. Default 600000. */
  readonly maxListenMs?: number
}

const DEFAULT_MAX_LISTEN_MS = 600_000
const MIN_LISTEN_MS = 30_000
const CONFIG_KEYS = new Set(['responderCommand', 'ntlmrelayxCommand', 'maxListenMs'])

interface ResolvedConfig {
  readonly responderCommand: string
  readonly ntlmrelayxCommand: string
  readonly maxListenMs: number
}

function resolveConfig(config: Config): ResolvedConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tool-listeners: unsupported config key ${JSON.stringify(key)}`)
  }
  const resolved = {
    responderCommand: config.responderCommand ?? 'Responder',
    ntlmrelayxCommand: config.ntlmrelayxCommand ?? 'ntlmrelayx',
    maxListenMs: config.maxListenMs ?? DEFAULT_MAX_LISTEN_MS,
  }
  if (resolved.responderCommand.trim().length === 0) throw new TypeError('tool-listeners: responderCommand must be non-empty')
  if (resolved.ntlmrelayxCommand.trim().length === 0) throw new TypeError('tool-listeners: ntlmrelayxCommand must be non-empty')
  if (!Number.isSafeInteger(resolved.maxListenMs) || resolved.maxListenMs < MIN_LISTEN_MS || resolved.maxListenMs > 3_600_000) {
    throw new TypeError(`tool-listeners: maxListenMs must be an integer between ${MIN_LISTEN_MS} and 3600000`)
  }
  return resolved
}

function listenWindowMs(value: unknown, maxListenMs: number): number {
  const window = typeof value === 'number' && Number.isSafeInteger(value) ? value : DEFAULT_MAX_LISTEN_MS
  if (window < MIN_LISTEN_MS || window > maxListenMs) {
    throw new Error(`tool-listeners: listen window must be between ${MIN_LISTEN_MS} and ${maxListenMs} ms`)
  }
  return window
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Start one listener subprocess as a generic background job and return its id.
 */
function startListenerJob(
  ctx: Context,
  exec: ToolExecution,
  kind: 'responder' | 'ntlmrelayx',
  label: string,
  argv: string[],
  command: string,
  windowMs: number,
): string {
  let handle: SubprocessHandle | undefined
  return ctx.jobs.start({
    kind,
    label,
    toolCall: { callId: exec.callId, rootCallId: exec.rootCallId },
    ...exec.agent !== undefined ? { owner: exec.agent.id } : {},
    output: collectedSources(() => handle),
    run: () => subprocessJob(async (signal) => {
      let commandPath: string
      try {
        commandPath = await ctx.subprocess.resolveExecutable(command, undefined, signal)
      } catch (error) {
        if (error instanceof SubprocessExecutableNotFoundError) {
          throw new Error(`tool-listeners: ${command} executable not found. Install it or set the matching config command.`)
        }
        throw error
      }
      handle = ctx.subprocess.spawn({
        argv: [commandPath, ...argv.slice(1)],
        cwd: tmpdir(),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: 33_554_432 },
          stderr: { maxBytes: 65_536 },
        },
        graceMs: windowMs,
        signal,
      })
      return handle
    }),
  })
}

/**
 * Register the `responder_capture` and `ntlm_relay` tools on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry, the subprocess runtime, and the job registry.
 * @param config - deployment bounds for commands and the listen window cap.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'responder_capture',
    description:
      'Poison LLMNR/NBT-NS/MDNS name resolution on one assessment network interface with '
      + 'Responder and capture authentication hashes as a background job. The call returns a '
      + 'job id at once; read captured hash lines with job_output and stop the session with '
      + 'job_kill. The listen window is capped by deployment config. The network must be '
      + 'declared in the active assessment-scope grant and this is exploit execution — '
      + 'hashes are returned for offline cracking under the grant evidence policy.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Assessment network the poisoning session runs on, as declared in the assessment scope grant (e.g. the domain or segment).',
      },
      interface: {
        type: 'string',
        required: true,
        description: 'Local network interface to poison on (-I), e.g. eth0.',
      },
      listen_window_ms: {
        type: 'integer',
        description: 'Listen window in milliseconds; the deployment maxListenMs caps the accepted value.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
          listenWindowMs: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `responder: poisoning session ${value.jobId} started (${value.listenWindowMs} ms window); read captured hashes with job_output, stop with job_kill.`,
      }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('responder_capture was aborted before the listener started')
      const windowMs = listenWindowMs(args.listen_window_ms, resolved.maxListenMs)
      const argv = buildResponderArgv(resolved.responderCommand, { interface: String(args.interface) })
      const jobId = startListenerJob(
        ctx,
        exec,
        'responder',
        `responder -I ${String(args.interface)}`,
        argv,
        resolved.responderCommand,
        windowMs,
      )
      return { jobId, listenWindowMs: windowMs }
    },
    presentCall: args => ({ card: 'generic', title: 'Poison name resolution (Responder)', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'ntlm_relay',
    description:
      'Bind local SMB/HTTP listeners and relay captured authentication to one authorized '
      + 'assessment target with ntlmrelayx as a background job. The call returns a job id at '
      + 'once; read relayed-authentication events with job_output and stop the session with '
      + 'job_kill. The relay target is the run\'s only outbound destination and must match a '
      + 'target declared in the active assessment-scope grant; this is exploit execution, so '
      + 'each call typically requires approval.',
    parameters: {
      target_id: {
        type: 'string',
        required: true,
        description: 'Relay target host, as declared in the assessment scope grant (the destination for captured authentication).',
      },
      scheme: {
        type: 'string',
        description: 'Relay target scheme (-t): smb (default), http, or ldaps.',
      },
      listen_window_ms: {
        type: 'integer',
        description: 'Listen window in milliseconds; the deployment maxListenMs caps the accepted value.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          jobId: { type: 'string', required: true },
          listenWindowMs: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `ntlmrelayx: relay session ${value.jobId} started (${value.listenWindowMs} ms window); read relay events with job_output, stop with job_kill.`,
      }],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('ntlm_relay was aborted before the listener started')
      const windowMs = listenWindowMs(args.listen_window_ms, resolved.maxListenMs)
      const argv = buildNtlmRelayArgv(resolved.ntlmrelayxCommand, {
        target: String(args.target_id),
        ...(optionalString(args.scheme) !== undefined ? { scheme: String(args.scheme) } : {}),
      })
      const jobId = startListenerJob(
        ctx,
        exec,
        'ntlmrelayx',
        `ntlmrelayx -> ${String(args.scheme ?? 'smb')}://${String(args.target_id)}`,
        argv,
        resolved.ntlmrelayxCommand,
        windowMs,
      )
      return { jobId, listenWindowMs: windowMs }
    },
    presentCall: args => ({ card: 'generic', title: 'Relay authentication (ntlmrelayx)', kind: 'other', rawInput: args }),
  }))
}
