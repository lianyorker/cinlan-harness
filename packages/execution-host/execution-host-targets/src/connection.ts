/** One authenticated SSH worker incarnation and its acknowledged inspections. */
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  PROTOCOL_VERSION, cancelResultSchema, createWorkerTransport, directoryInspectionSchema,
  workerInfoSchema, workerResultSchema,
} from '@deepseek-ai/dsh-execution-host-worker/protocol'
import type { DirectoryInspection, WorkerInfo, WorkerTransport } from '@deepseek-ai/dsh-execution-host-worker/protocol'
import { ExecutionTargetError } from './errors.ts'
import type { Config } from './config.ts'

function cancelled(signal: AbortSignal): ExecutionTargetError {
  return signal.reason instanceof ExecutionTargetError
    ? signal.reason
    : new ExecutionTargetError('cancelled', 'Execution host operation cancelled')
}

function workerFailure(code: string): ExecutionTargetError {
  switch (code) {
    case 'UNSUPPORTED_VERSION': return new ExecutionTargetError('incompatible', 'Target worker protocol is incompatible')
    case 'STALE_HOST': return new ExecutionTargetError('connection-lost', 'Target worker changed; reconnect before inspecting')
    case 'CANCELLED': return new ExecutionTargetError('cancelled', 'Target inspection was cancelled')
    case 'OPERATION_TIMEOUT': return new ExecutionTargetError('timeout', 'Target inspection exceeded its time limit')
    default: return new ExecutionTargetError('inspection-failed', 'Target directory could not be inspected within its exported root')
  }
}

/**
 * Build the fixed worker command with host-owned OpenSSH settings.
 * @param executable Resolved OpenSSH executable.
 * @param alias Validated saved configuration alias.
 * @param connectTimeoutMs Connection deadline in milliseconds.
 * @param configFile Optional host-owned OpenSSH configuration file.
 * @returns argv without caller-supplied commands, flags or patches.
 */
export function sshArguments(executable: string, alias: string, connectTimeoutMs: number, configFile?: string): readonly string[] {
  return [
    executable, ...(configFile === undefined ? [] : ['-F', configFile]), '-T', '-S', 'none',
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no',
    '-o', 'ClearAllForwardings=yes', '-o', 'RequestTTY=no',
    '-o', 'ConnectTimeout=' + String(Math.ceil(connectTimeoutMs / 1000)),
    '--', alias, 'dsh --profile execution-host',
  ]
}

/** Connection-local worker transport; no Session or Agent authority is delegated. */
export class SshTargetConnection {
  private handle: SubprocessHandle | undefined
  private transport: WorkerTransport | undefined
  private readonly lifetime = new AbortController()
  private readonly inspections = new Set<Promise<DirectoryInspection>>()
  private closing: Promise<boolean> | undefined
  private info: WorkerInfo | undefined
  private lost = false

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly config: Config,
    private readonly alias: string,
    private readonly onLost: (cleanup: Promise<boolean>) => void,
  ) {}

  /**
   * Authenticate and negotiate an explicit worker version.
   * @param signal Caller cancellation before connection publication.
   * @returns the remote process identity and exported roots.
   */
  async open(signal?: AbortSignal): Promise<WorkerInfo> {
    const timeout = AbortSignal.timeout(this.config.connectTimeoutMs)
    const timedOut = (): boolean => timeout.aborted
    const admission = AbortSignal.any([this.lifetime.signal, timeout, ...(signal === undefined ? [] : [signal])])
    let executable: string
    try { executable = await this.subprocess.resolveExecutable(this.config.sshExecutable, undefined, admission) }
    catch (cause) {
      if (timedOut()) throw new ExecutionTargetError('timeout', 'SSH worker connection timed out')
      if (admission.aborted) throw cancelled(admission)
      throw new ExecutionTargetError('ssh-unavailable', 'OpenSSH is not available on this Host', { cause })
    }
    if (timedOut()) throw new ExecutionTargetError('timeout', 'SSH worker connection timed out')
    if (admission.aborted) throw cancelled(admission)
    this.handle = this.subprocess.spawn({
      argv: sshArguments(executable, this.alias, this.config.connectTimeoutMs, this.config.sshConfigFile), cwd: process.cwd(),
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: this.config.maxDiagnosticBytes } },
      graceMs: this.config.shutdownTimeoutMs,
    })
    const handle = this.handle
    if (handle.stdin === undefined || handle.stdout === undefined) throw new Error('SSH subprocess must expose protocol pipes')
    const transport = this.transport = createWorkerTransport(handle.stdout, handle.stdin, this.config.maxFrameBytes)
    transport.start()
    void handle.done.then(() => { this.markLost() }, () => { this.markLost() })
    void transport.closed.then(() => { this.markLost() })
    try {
      const raw = await transport.request('initialize', { protocolVersion: PROTOCOL_VERSION }, admission)
      const response = workerResultSchema(workerInfoSchema).parse(raw)
      if (!response.ok) throw workerFailure(response.error.code)
      this.info = response.value
      return response.value
    } catch (cause) {
      await this.close()
      if (signal?.aborted === true) throw cancelled(signal)
      if (timedOut()) throw new ExecutionTargetError('timeout', 'SSH worker connection timed out')
      if (cause instanceof ExecutionTargetError) throw cause
      if (cause instanceof ZodError) throw new ExecutionTargetError('incompatible', 'Target worker returned an incompatible protocol response')
      const diagnostic = handle.collected.stderr?.readFrom(0).text ?? ''
      if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(diagnostic)) {
        throw new ExecutionTargetError('host-key-mismatch', 'OpenSSH could not verify the target host key')
      }
      if (/Permission denied|Authentication failed|sign_and_send_pubkey|no supported authentication/i.test(diagnostic)) {
        throw new ExecutionTargetError('authentication-required', 'OpenSSH authentication failed; configure a key or agent for this alias')
      }
      if (/dsh.*(not found|not recognized)|unknown profile|profile.*not found/i.test(diagnostic)) {
        throw new ExecutionTargetError('incompatible', 'Install dsh and configure its execution-host profile on the target')
      }
      throw new ExecutionTargetError('unreachable', 'The target SSH worker could not be reached or negotiated', { cause })
    }
  }

  /**
   * Inspect a root-relative remote directory and await acknowledged cancellation.
   * @param rootId Worker-advertised exported root.
   * @param path Path relative to that remote root.
   * @param signal Caller cancellation; never interpreted as remote settlement alone.
   * @returns bounded remote entries carrying the exact worker process identity.
   */
  inspect(rootId: string, path: string, signal?: AbortSignal): Promise<DirectoryInspection> {
    if (this.inspections.size >= this.config.maxConcurrentInspections) {
      return Promise.reject(new ExecutionTargetError('limit-reached', 'Too many target inspections are already running'))
    }
    const operation = this.inspectOperation(rootId, path, signal)
    this.inspections.add(operation)
    void operation.then(() => { this.inspections.delete(operation) }, () => { this.inspections.delete(operation) })
    return operation
  }

  private async inspectOperation(rootId: string, path: string, signal?: AbortSignal): Promise<DirectoryInspection> {
    const transport = this.transport
    const info = this.info
    if (transport === undefined || info === undefined || this.isClosingOrLost()) {
      throw new ExecutionTargetError('connection-lost', 'Reconnect the target before inspecting a directory')
    }
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(new ExecutionTargetError('timeout', 'Target inspection timed out')) }, this.config.operationTimeoutMs)
    const effective = AbortSignal.any([this.lifetime.signal, deadline.signal, ...(signal === undefined ? [] : [signal])])
    const hasAborted = (): boolean => effective.aborted
    if (hasAborted()) { clearTimeout(timer); throw cancelled(effective) }
    const operationId = randomUUID()
    let wakeAbort!: () => void
    const aborted = new Promise<void>((resolve) => { wakeAbort = resolve })
    effective.addEventListener('abort', wakeAbort, { once: true })
    const response = transport.request('inspectDirectory', { operationId, expectedHostId: info.executionHost.hostId, rootId, path },
      AbortSignal.timeout(this.config.operationTimeoutMs + 2 * this.config.shutdownTimeoutMs))
    const observed = response.then(value => ({ kind: 'result' as const, value }))
    try {
      const outcome = await Promise.race([observed, aborted.then(() => ({ kind: 'aborted' as const }))])
      if (outcome.kind === 'aborted' || hasAborted()) {
        try {
          const ack = cancelResultSchema.parse(await transport.request(
            'cancel', { operationId }, AbortSignal.timeout(this.config.shutdownTimeoutMs),
          ))
          if (!ack.ok) throw new Error('worker did not acknowledge settled cancellation')
          await response
        } catch (cause) {
          this.markLost()
          throw new ExecutionTargetError('outcome-unconfirmed', 'Connection ended before the target confirmed inspection settlement', { cause })
        }
        throw cancelled(effective)
      }
      const result = workerResultSchema(directoryInspectionSchema).parse(outcome.value)
      if (!result.ok) {
        if (result.error.code === 'STALE_HOST') this.markLost()
        throw workerFailure(result.error.code)
      }
      if (result.value.executionHostId !== info.executionHost.hostId || this.lost) {
        this.markLost()
        throw new ExecutionTargetError('connection-lost', 'Target worker changed before inspection completed')
      }
      return result.value
    } catch (cause) {
      if (cause instanceof ExecutionTargetError) throw cause
      this.markLost()
      throw new ExecutionTargetError('outcome-unconfirmed', 'Target inspection outcome is unconfirmed after connection loss', { cause })
    } finally {
      clearTimeout(timer)
      effective.removeEventListener('abort', wakeAbort)
    }
  }

  private isClosingOrLost(): boolean {
    return this.lost || this.closing !== undefined
  }

  /**
   * Check current connection admission and publication eligibility.
   * @returns whether the negotiated incarnation is still usable.
   */
  isUsable(): boolean {
    return this.info !== undefined && !this.isClosingOrLost()
  }

  private markLost(): void {
    if (this.lost || this.closing !== undefined) return
    this.lost = true
    this.transport?.close()
    this.onLost(this.close())
  }

  /**
   * Cancel inspections, wait for acknowledgement, and release the local SSH process range.
   * @returns whether every admitted remote inspection settled with confirmation.
   */
  close(): Promise<boolean> {
    return this.closing ??= this.closeOperation()
  }

  private async closeOperation(): Promise<boolean> {
    const handle = this.handle
    const transport = this.transport
    const pending = [...this.inspections]
    this.lifetime.abort(new ExecutionTargetError('cancelled', 'Target connection was closed'))
    const results = await Promise.allSettled(pending)
    const confirmed = results.every(result => result.status === 'fulfilled'
      || (result.reason instanceof ExecutionTargetError && result.reason.code !== 'outcome-unconfirmed'))
    if (transport !== undefined && !this.lost) {
      try { await transport.request('shutdown', {}, AbortSignal.timeout(this.config.shutdownTimeoutMs)) }
      catch (_shutdownNotAcknowledged) { /* Local process cleanup still owns the closed transport. */ }
    }
    transport?.close()
    if (handle !== undefined) {
      handle.terminate()
      await handle.waitForExit()
      await handle.done.catch(() => undefined)
    }
    return confirmed
  }
}
