/** Adapt a captured subprocess terminal into the sidebar's existing retained PTY registry. */
import { StringDecoder } from 'node:string_decoder'
import { finished } from 'node:stream/promises'
import type { ExecutionLease } from '@deepseek-ai/dsh-execution-binding/types'
import type { SubprocessTerminalHandle } from '@deepseek-ai/dsh-subprocess'
import type { SidebarTerminalProcess } from './pty-manager.ts'

/** Remote I/O and cleanup remain owned by the captured subprocess handle and its execution lease. */
export class LeasedTerminal implements SidebarTerminalProcess {
  private readonly data = new Set<(data: string) => void>()
  private readonly exits = new Set<(event: { exitCode: number; signal?: number }) => void>()
  private readonly decoder = new StringDecoder('utf8')
  private stopping = false
  private closing: Promise<void> | undefined
  private terminationRequests = 0
  readonly retainUntilExit = true
  /** Settles after native exit, output drain, termination confirmation, and lease release. */
  readonly settled: Promise<void>
  readonly process: string
  get pid(): number { return this.native.pid }

  constructor(private readonly native: SubprocessTerminalHandle, private readonly lease: ExecutionLease,
    shell: string, private readonly failed: (error: unknown) => void) {
    this.process = shell
    native.output.pause()
    native.output.on('data', (chunk: Buffer | string) => {
      const value = typeof chunk === 'string' ? chunk : this.decoder.write(chunk)
      for (const listener of this.data) listener(value)
    })
    const drained = finished(native.output, { cleanup: true })
    void drained.catch((error: unknown) => {
      if (!this.stopping) { this.failed(error); this.kill() }
    })
    const lost = (): void => { this.failed(lease.signal.reason); this.kill() }
    lease.signal.addEventListener('abort', lost, { once: true })
    this.settled = (async () => {
      let exitCode = 1
      try {
        const outcome = await native.done
        exitCode = outcome.exitCode ?? 1
        await drained
        const tail = this.decoder.end()
        if (tail !== '') for (const listener of this.data) listener(tail)
      } catch (error) {
        if (!this.stopping) this.failed(error)
      }
      finally {
        try { await this.terminate() }
        catch (error: unknown) { this.failed(error) }
        // Releasing a real execution lease aborts its signal synchronously. Detach
        // the loss observer first so normal process completion stays successful.
        lease.signal.removeEventListener('abort', lost)
        try { await lease.release() }
        finally {
          for (const listener of this.exits) listener({ exitCode })
        }
      }
    })()
    if (lease.signal.aborted) queueMicrotask(lost)
  }

  private terminate(): Promise<void> {
    return this.closing ??= Promise.resolve().then(() => this.native.terminate()).then(undefined, (error: unknown) => {
      this.closing = undefined
      throw error
    })
  }
  write(data: string): Promise<void> { this.lease.assertCurrent(); return this.native.write(data) }
  resize(cols: number, rows: number): Promise<void> { this.lease.assertCurrent(); return this.native.resize(cols, rows) }
  kill(): void {
    this.stopping = true
    this.native.output.resume()
    const request = ++this.terminationRequests
    void this.terminate().catch((error: unknown) => {
      this.failed(error)
      // A later explicit close that joined this failed attempt owns one retry.
      if (this.terminationRequests > request) {
        void this.terminate().catch((retryError: unknown) => { this.failed(retryError) })
      }
    })
  }
  pause(): void { this.native.output.pause() }
  resume(): void { this.native.output.resume() }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.data.add(listener)
    return { dispose: () => { this.data.delete(listener) } }
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exits.add(listener)
    return { dispose: () => { this.exits.delete(listener) } }
  }
}
