/** One MCP transport generation at a time, with bounded reconnection and serialized discovery. @module */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListResourcesResultSchema, ListResourceTemplatesResultSchema, ReadResourceResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { assertNever, type JsonValue } from '@deepseek-ai/dsh-util-values'
import type { Context } from '@deepseek-ai/cordis'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { createTransport } from './transport.ts'
import { syncTools } from './tools.ts'
import type { ToolBridgeOptions, ToolDisposers } from './tools.ts'
import type { Config } from './index.ts'
import { McpConnectionFailure, connectionErrorCode } from './failure.ts'
import { notifyObservers } from './observation.ts'
import type { ConnectionOutcome, McpConnectionState, McpLaunchOptions, McpToolDescriptor } from './types.ts'
import type { ConnectionHandle } from './host-types.ts'
export type { ConnectionOutcome } from './types.ts'
export type { ConnectionHandle } from './host-types.ts'

import type { ReconnectConfig } from './types.ts'
export type { ReconnectConfig } from './types.ts'

/** Defaults applied by the explicit policy resolver. */
export const RECONNECT_DEFAULTS: Required<ReconnectConfig> = Object.freeze({
  enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10,
})
/** Default UTF-8 byte limit for attributed server instructions. */
export const DEFAULT_MAX_INSTRUCTION_BYTES = 32_768
// The SDK owns two two-second termination grace periods; the final second
// accommodates the process-close event without allowing overlapping children.
const GENERATION_CLOSE_TIMEOUT_MS = 5_000
/** Validated reconnect policy for a launcher instance. */
export type ResolvedReconnectPolicy = Readonly<Required<ReconnectConfig>>

/**
 * Validate and default every reconnect option before mounting effects.
 * @param config - raw policy, or undefined for defaults.
 * @param path - diagnostic configuration location.
 * @returns immutable resolved policy.
 */
export function resolveReconnectPolicy(config: ReconnectConfig | undefined, path: string): ResolvedReconnectPolicy {
  if (config !== undefined) {
    for (const key of Object.keys(config)) {
      if (!Object.hasOwn(RECONNECT_DEFAULTS, key)) throw new Error(path + '.' + key + ' is not a reconnect option')
    }
  }
  const enabled = config?.enabled ?? RECONNECT_DEFAULTS.enabled
  const initialDelayMs = config?.initialDelayMs ?? RECONNECT_DEFAULTS.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? RECONNECT_DEFAULTS.maxDelayMs
  const maxAttempts = config?.maxAttempts ?? RECONNECT_DEFAULTS.maxAttempts
  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(path + '.initialDelayMs must be a positive finite number no greater than ' + String(MAX_TIMER_DELAY_MS))
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(path + '.maxDelayMs must be a positive finite number no greater than ' + String(MAX_TIMER_DELAY_MS))
  }
  if (initialDelayMs > maxDelayMs) throw new Error(path + '.initialDelayMs must be less than or equal to maxDelayMs')
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error(path + '.maxAttempts must be a positive integer')
  return Object.freeze({ enabled, initialDelayMs, maxDelayMs, maxAttempts })
}

interface Generation {
  client: Client
  controller: AbortController
  closed: PromiseWithResolvers<void>
  initialized: boolean
  settled: boolean
  instructions: string
  closeTask?: Promise<boolean>
}

/** Read live cancellation state across asynchronous suspension points. */
function isAborted(signal: AbortSignal): boolean { return signal.aborted }

/** Consume late settlement even when the caller cancels before a provider responds. */
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => { reject(new McpConnectionFailure('connection-failed')) }
    signal.addEventListener('abort', abort, { once: true })
    void work.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
    if (isAborted(signal)) abort()
  })
}

/**
 * Start one connection; all discoveries share the same serialized commit queue.
 * @param ctx - context owning tool registrations and diagnostics.
 * @param config - validated initial transport and server identity.
 * @param policy - validated reconnect policy.
 * @param options - launch-time authority, credential resolution, and redaction.
 * @returns observable connection handle with quiescent disposal.
 */
export function startConnection(
  ctx: Context, config: Config, policy: ResolvedReconnectPolicy, options: McpLaunchOptions = {},
): ConnectionHandle {
  const label = 'mcp-client(' + config.serverName + ')'
  const safeDiagnostics = options.owner?.kind === 'managed' || options.resolveConfig !== undefined
  const maxInstructionBytes = config.maxInstructionBytes ?? DEFAULT_MAX_INSTRUCTION_BYTES
  const lifecycle = new AbortController()
  const listeners = new Set<() => void>()
  let state: McpConnectionState = Object.freeze({ phase: 'connecting', attempt: 0, tools: Object.freeze([]) })
  let current: Generation | undefined
  let disposers: ToolDisposers = new Map()
  let reconnectTimer: NodeJS.Timeout | undefined
  let failedAttempts = 0
  let connectedAt: number | undefined
  let firstAttemptError: unknown
  let stopTask: Promise<void> | undefined
  let syncChain: Promise<void> = Promise.resolve()
  const isCurrent = (generation: Generation): boolean => !isAborted(lifecycle.signal) && current === generation
  const publish = (next: McpConnectionState): void => {
    state = Object.freeze(next)
    notifyObservers(ctx, listeners)
  }
  const fail = (error: unknown, fallback: 'connection-failed' | 'tool-sync-failed'): void => {
    publish({ phase: 'error', attempt: failedAttempts, tools: state.tools, errorCode: connectionErrorCode(error, fallback) })
  }

  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.section({
      name: 'mcp:' + config.serverName,
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      text: () => current !== undefined && isCurrent(current) && !isAborted(current.controller.signal)
        ? current.instructions : '',
    })
  })

  function enqueueSync(generation: Generation, startup = false, probeSignal?: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([lifecycle.signal, generation.controller.signal, ...probeSignal === undefined ? [] : [probeSignal]])
    const run = syncChain.then(async () => {
      if (!isCurrent(generation) || isAborted(signal)) return
      let registrationFailed = false
      const hasRegistrationFailed = (): boolean => registrationFailed
      const opts: ToolBridgeOptions = {
        serverName: config.serverName, toolCallTimeoutMs: config.toolCallTimeoutMs,
        registrationFailure: startup && config.failOnStartupError ? 'throw' : 'contain',
        signal, canCommit: () => isCurrent(generation) && !isAborted(signal), safeDiagnostics,
        ...options.redact === undefined ? {} : { redact: options.redact },
        onCommit(tools, error) {
          registrationFailed = error !== undefined
          publish(error === undefined
            ? { phase: 'ready', attempt: failedAttempts, tools }
            : { phase: 'error', attempt: failedAttempts, tools, errorCode: 'namespace-conflict' })
        },
      }
      try {
        disposers = await syncTools(generation.client, ctx, opts, disposers)
      } catch (error) {
        if (isCurrent(generation) && !isAborted(signal) && !hasRegistrationFailed()) fail(error, 'tool-sync-failed')
        throw error
      }
    })
    // The enqueuing operation reports its failure; subsequent discoveries still run.
    syncChain = run.catch(() => {})
    return probeSignal === undefined ? run : cancellable(run, probeSignal)
  }

  function closeGeneration(generation: Generation): Promise<boolean> {
    if (generation.closeTask !== undefined) return generation.closeTask
    generation.closeTask = new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => { resolve(false) }, GENERATION_CLOSE_TIMEOUT_MS)
      timeout.unref()
      const close = Promise.resolve().then(() => generation.client.close()).catch(() => {
        // A transport can reject close after termination; onclose owns completion.
      })
      void Promise.all([close, generation.closed.promise]).then(() => {
        clearTimeout(timeout)
        resolve(true)
      })
    })
    return generation.closeTask
  }

  function generationDown(generation: Generation): void {
    if (!isCurrent(generation)) return
    generation.controller.abort()
    current = undefined
    scheduleReconnect()
  }

  function scheduleReconnect(): void {
    if (isAborted(lifecycle.signal)) return
    const lostEstablishedConnection = connectedAt !== undefined
    const errorCode = state.errorCode ?? 'connection-failed'
    if (!policy.enabled) {
      const message = lostEstablishedConnection
        ? 'connection lost and reconnect is disabled — registered tools will fail until an HMR reload or Host restart'
        : 'connection failed and reconnect is disabled — no tools were registered; reload the plugin or restart the Host to connect'
      ctx.logger.error(label + ': ' + message)
      publish({ phase: 'error', attempt: failedAttempts, tools: state.tools, errorCode })
      return
    }
    if (connectedAt !== undefined && Date.now() - connectedAt >= policy.maxDelayMs) failedAttempts = 0
    connectedAt = undefined
    failedAttempts += 1
    if (failedAttempts > policy.maxAttempts) {
      syncChain = syncChain.then(() => {
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
        if (!isAborted(lifecycle.signal)) publish({ phase: 'error', attempt: policy.maxAttempts, tools: Object.freeze([]), errorCode })
      })
      ctx.logger.error(label + ': giving up after ' + String(policy.maxAttempts) + ' consecutive failed reconnect attempts — tools unregistered; reload the plugin or restart the Host to reconnect')
      return
    }
    const delayMs = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (failedAttempts - 1))
    const action = lostEstablishedConnection ? 'connection lost; reconnecting' : 'connection failed; retrying'
    ctx.logger.warn(label + ': ' + action + ' in ' + String(delayMs) + 'ms (attempt ' + String(failedAttempts) + '/' + String(policy.maxAttempts) + ')')
    publish({ phase: 'backoff', attempt: failedAttempts, retryAt: Date.now() + delayMs, errorCode, tools: state.tools })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      settling = connectGeneration(false)
    }, delayMs)
    reconnectTimer.unref()
  }

  async function connectGeneration(startup: boolean): Promise<void> {
    if (isAborted(lifecycle.signal)) return
    publish({ phase: 'connecting', attempt: failedAttempts, tools: state.tools })
    let generation: Generation | undefined
    try {
      const resolved = options.resolveConfig === undefined ? config
        : await cancellable(options.resolveConfig(lifecycle.signal), lifecycle.signal)
      if (isAborted(lifecycle.signal)) return
      if (resolved.serverName !== config.serverName || resolved.transport !== config.transport) throw new McpConnectionFailure('connection-failed')
      const transport = createTransport(resolved, safeDiagnostics)
      generation = {
        client: new Client({ name: 'dsh-mcp-client', version: '0.0.1' }, { capabilities: {} }),
        controller: new AbortController(), closed: Promise.withResolvers<void>(), initialized: false, settled: false, instructions: '',
      }
      const active = generation
      current = active
      active.client.onclose = () => {
        active.closed.resolve()
        active.controller.abort()
        if (active.settled) generationDown(active)
      }
      active.client.onerror = (error) => { if (isCurrent(active)) fail(error, 'connection-failed') }
      active.client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        if (!isCurrent(active)) return
        ctx.logger.info(label + ': tool list changed, re-syncing')
        try { await enqueueSync(active) } catch (error) {
          if (isCurrent(active)) ctx.logger.warn(label + ': tool synchronization failed: ' + (safeDiagnostics ? connectionErrorCode(error, 'tool-sync-failed') : String(error)))
        }
      })
      const signal = AbortSignal.any([lifecycle.signal, active.controller.signal])
      const connecting = active.client.connect(transport, { signal })
      // A transport start may settle after cancellation and still need closing.
      void connecting.then(() => {
        if (isAborted(signal)) void active.client.close().catch(() => { /* late transport already closed */ })
      }, () => {})
      await cancellable(connecting, signal)
      if (!isCurrent(active) || isAborted(active.controller.signal)) throw new McpConnectionFailure('connection-failed')
      active.initialized = true
      const serverText = active.client.getInstructions()?.trimEnd() ?? ''
      const attributed = serverText ? '### MCP server: ' + config.serverName + '\n\n' + serverText : ''
      const instructions = options.redact?.(attributed) ?? attributed
      if (Buffer.byteLength(instructions) > maxInstructionBytes) {
        throw new Error(label + ': server instructions exceed maxInstructionBytes (' + String(maxInstructionBytes) + ')')
      }
      await enqueueSync(active, startup)
      active.settled = true
      if (isAborted(active.controller.signal)) { generationDown(active); return }
      if (!isCurrent(active)) return
      active.instructions = instructions
      connectedAt = Date.now()
      if (startup && state.phase === 'error') firstAttemptError = new McpConnectionFailure(state.errorCode ?? 'tool-sync-failed')
      if (failedAttempts > 0) ctx.logger.info(label + ': reconnected and re-synced tools (attempt ' + String(failedAttempts) + '/' + String(policy.maxAttempts) + ')')
    } catch (error) {
      if (startup) firstAttemptError = safeDiagnostics ? new McpConnectionFailure(connectionErrorCode(error, 'connection-failed')) : error
      if (isAborted(lifecycle.signal)) return
      if (generation === undefined || isCurrent(generation)) {
        if (state.phase !== 'error') fail(error, 'connection-failed')
        ctx.logger.warn(label + ': connection attempt failed: ' + (safeDiagnostics ? connectionErrorCode(error, 'connection-failed') : String(error)))
      }
      if (generation === undefined) { scheduleReconnect(); return }
      const quiesced = await closeGeneration(generation)
      generation.settled = true
      if (!isCurrent(generation)) return
      if (!quiesced) {
        current = undefined
        generation.controller.abort()
        publish({ phase: 'error', attempt: failedAttempts, tools: state.tools, errorCode: 'close-timeout' })
        ctx.logger.error(label + ': failed generation did not close within ' + String(GENERATION_CLOSE_TIMEOUT_MS) + 'ms — reconnect stopped to avoid overlapping server processes; reload the plugin or restart the Host to retry')
        return
      }
      generationDown(generation)
    }
  }

  let settling = connectGeneration(true)
  const ready: Promise<ConnectionOutcome> = settling.then(() => {
    if (firstAttemptError !== undefined) return { error: firstAttemptError }
    if (current?.initialized && !isAborted(lifecycle.signal)) return {}
    return { error: new McpConnectionFailure(state.errorCode ?? 'connection-failed') }
  })
  return {
    ready,
    resources: {
      async request(request, exec): Promise<JsonValue> {
        const generation = current
        if (generation === undefined || !generation.initialized || !isCurrent(generation)
          || isAborted(generation.controller.signal)) throw new McpConnectionFailure('connection-failed')
        const signal = AbortSignal.any([exec.signal, lifecycle.signal, generation.controller.signal])
        const requestOptions = { signal, timeout: config.toolCallTimeoutMs }
        try {
          signal.throwIfAborted()
          switch (request.method) {
            case 'resources/list':
              if (generation.client.getServerCapabilities()?.resources === undefined) return { resources: [] }
              return await generation.client.request({
                method: request.method, ...request.cursor === undefined ? {} : { params: { cursor: request.cursor } },
              }, ListResourcesResultSchema, requestOptions) as JsonValue
            case 'resources/templates/list':
              if (generation.client.getServerCapabilities()?.resources === undefined) return { resourceTemplates: [] }
              return await generation.client.request({
                method: request.method, ...request.cursor === undefined ? {} : { params: { cursor: request.cursor } },
              }, ListResourceTemplatesResultSchema, requestOptions) as JsonValue
            case 'resources/read':
              if (generation.client.getServerCapabilities()?.resources === undefined) throw new Error(label + ': server does not support resources')
              return await generation.client.request({
                method: request.method, params: { uri: request.uri },
              }, ReadResourceResultSchema, requestOptions) as JsonValue
            /* v8 ignore next 2 -- resource operations are a closed same-process union */
            default:
              return assertNever(request)
          }
        } catch (error) {
          if (safeDiagnostics) throw new McpConnectionFailure(connectionErrorCode(error, 'connection-failed'))
          throw error
        }
      },
    },
    getSnapshot: () => state,
    subscribe(listener) {
      if (state.phase === 'stopped') return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async probe(signal): Promise<readonly McpToolDescriptor[]> {
      const generation = current
      if (isAborted(signal) || generation === undefined || !generation.initialized || !isCurrent(generation)) throw new McpConnectionFailure('connection-failed')
      try { await enqueueSync(generation, false, signal) } catch (error) {
        throw new McpConnectionFailure(connectionErrorCode(error, 'tool-sync-failed'))
      }
      if (isAborted(signal) || !isCurrent(generation) || state.phase !== 'ready') throw new McpConnectionFailure(state.errorCode ?? 'connection-failed')
      return state.tools
    },
    dispose(): Promise<void> {
      if (stopTask !== undefined) return stopTask
      lifecycle.abort()
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
      const generation = current
      current = undefined
      generation?.controller.abort()
      stopTask = (async () => {
        const closed = (generation === undefined || await closeGeneration(generation)) && state.errorCode !== 'close-timeout'
        if (!closed) ctx.logger.error(label + ': generation did not close within ' + String(GENERATION_CLOSE_TIMEOUT_MS) + 'ms during disposal — server shutdown may be incomplete')
        await settling
        await syncChain
        for (const dispose of disposers.values()) dispose()
        disposers = new Map()
        publish({ phase: 'stopped', attempt: failedAttempts, tools: Object.freeze([]), ...closed ? {} : { errorCode: 'close-timeout' as const } })
        listeners.clear()
      })()
      return stopTask
    },
  }
}
