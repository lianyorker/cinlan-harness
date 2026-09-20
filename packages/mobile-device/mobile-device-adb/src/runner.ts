/** Bounded native ADB subprocess ownership, including raw PNG output and cleanup. */
import type { Context } from '@deepseek-ai/cordis'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { MobileDeviceError } from '@deepseek-ai/dsh-mobile-device'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { adbCommand } from './config.ts'
import type { ResolvedConfig } from './config.ts'

/** Own every command until its process range has exited. */
export class AdbRunner {
  private readonly lifetime = new AbortController()
  private readonly commandScope = new AsyncLocalStorage<string>()
  private readonly pending = new Set<Promise<Buffer>>()
  private disposed = false
  /** @param ctx - Harness subprocess owner.
   * @param config - Validated command bounds.
   * @param sdkPath - Current saved native SDK location.
   */
  constructor(private readonly ctx: Context, private readonly config: ResolvedConfig, private readonly sdkPath: () => string) {}
  /** Resolve the configured selector without running ADB.
   * @returns Current executable choice for generation checks.
   */
  selection(): string { return adbCommand(this.config.command, this.sdkPath()) }
  /** Pin executable selection for one operation and its asynchronous device-file cleanup.
   * @param operation - Complete provider operation.
   * @returns Its result using one captured SDK selection.
   */
  scoped<T>(operation: () => Promise<T>): Promise<T> {
    return this.commandScope.run(this.selection(), operation)
  }
  /** Execute fixed ADB arguments without a local shell and with bounded binary output.
   * @param args - Complete ADB argv after the executable.
   * @param caller - Caller cancellation; cleanup omits it intentionally.
   * @param maxBytes - Complete stdout byte cap.
   * @param cleanup - Permit an owned device-file cleanup after provider disposal starts.
   * @returns Complete stdout bytes after process quiescence.
   */
  run(args: readonly string[], caller: AbortSignal | undefined, maxBytes: number, cleanup = false): Promise<Buffer> {
    if (this.disposed && !cleanup) return Promise.reject(new MobileDeviceError('Native Android provider is disposed', 'MOBILE_PROVIDER_DISPOSED'))
    const task = this.execute(args, caller, maxBytes, cleanup)
    this.pending.add(task)
    void task.then(() => { this.pending.delete(task) }, () => { this.pending.delete(task) })
    return task
  }
  private async execute(args: readonly string[], caller: AbortSignal | undefined, maxBytes: number, cleanup: boolean): Promise<Buffer> {
    const upstream = cleanup ? new AbortController().signal : AbortSignal.any([this.lifetime.signal, ...(caller ? [caller] : [])])
    const bound = deadline(upstream, cleanup ? this.config.cleanupTimeoutMs : this.config.commandTimeoutMs, 'MOBILE_ADB_TIMEOUT')
    const overflow = new AbortController()
    const signal = AbortSignal.any([bound.signal, overflow.signal])
    let handle: SubprocessHandle | undefined
    let reading: Promise<Buffer> | undefined
    try {
      signal.throwIfAborted()
      let executable: string
      try {
        executable = await this.ctx.subprocess.resolveExecutable(this.commandScope.getStore() ?? this.selection(), {}, signal)
      } catch (error) {
        if (signal.aborted) throw error
        throw new MobileDeviceError('Android ADB executable is unavailable; configure an existing platform-tools installation', 'MOBILE_ADB_UNAVAILABLE')
      }
      signal.throwIfAborted()
      handle = this.ctx.subprocess.spawn({
        argv: [executable, ...args], cwd: this.config.cwd,
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: { maxBytes: this.config.maxStderrBytes } },
        signal, graceMs: this.config.graceMs,
      })
      const stream = handle.stdout
      if (!stream) throw new Error('ADB subprocess did not expose stdout')
      reading = (async () => {
        const chunks: Buffer[] = []
        let count = 0
        for await (const chunk of stream as AsyncIterable<unknown>) {
          if (!(chunk instanceof Uint8Array)) throw new MobileDeviceError('Invalid binary ADB output', 'MOBILE_ADB_PROTOCOL')
          count += chunk.byteLength
          if (count > maxBytes) {
            const error = new MobileDeviceError('ADB output exceeds the configured byte limit', 'MOBILE_ADB_OUTPUT_TOO_LARGE')
            overflow.abort(error)
            throw error
          }
          chunks.push(Buffer.from(chunk))
        }
        return Buffer.concat(chunks, count)
      })()
      const [outcome, bytes] = await Promise.all([handle.done, reading])
      signal.throwIfAborted()
      if (handle.collected.stderr?.readFrom(0).lossy) throw new MobileDeviceError('ADB diagnostics exceeded the configured byte limit', 'MOBILE_ADB_OUTPUT_TOO_LARGE')
      if (outcome.exitCode !== 0 || outcome.signal !== null) throw new MobileDeviceError('Android ADB command failed; inspect device connection and authorization', 'MOBILE_ADB_COMMAND_FAILED')
      return bytes
    } catch (error) {
      if (overflow.signal.aborted) throw overflow.signal.reason
      if (timeoutOf(bound.signal, 'MOBILE_ADB_TIMEOUT')) throw new MobileDeviceError('Android ADB command timed out', 'MOBILE_ADB_TIMEOUT')
      if (caller?.aborted && !cleanup) caller.throwIfAborted()
      if (this.lifetime.signal.aborted && !cleanup) throw new MobileDeviceError('Native Android provider is disposed', 'MOBILE_PROVIDER_DISPOSED')
      if (error instanceof MobileDeviceError) throw error
      throw new MobileDeviceError('Android ADB command could not complete', 'MOBILE_ADB_COMMAND_FAILED')
    } finally {
      try {
        handle?.terminate()
        await handle?.done.catch(() => undefined)
        await handle?.waitForExit()
      } catch {
        throw new MobileDeviceError('Android process-range cleanup could not complete', 'MOBILE_ADB_CLEANUP_FAILED')
      } finally {
        // The original command failure has already been classified; join its output reader after termination.
        await reading?.catch(() => undefined)
        bound[Symbol.dispose]()
      }
    }
  }
  /** Abort commands and wait for every owned process range.
   * @returns Settlement after command quiescence.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    this.lifetime.abort()
    await Promise.allSettled([...this.pending])
  }
}
