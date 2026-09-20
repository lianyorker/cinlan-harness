/** POSIX OpenSSH alias transport with private multiplexing and forwarding sockets. */
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import type { SshControl, SshTransport } from './transport.ts'

/** Deployment-owned alias transport; authentication stays with OpenSSH. */
export class OpenSshTransport implements SshTransport {
  private child: ChildProcessWithoutNullStreams | undefined
  private childClosed: Promise<void> | undefined
  private directory: string | undefined
  private nextSocket = 0
  private readonly pending = new Set<Promise<unknown>>()
  constructor(private readonly host: string, private readonly timeoutMs: number,
    private readonly lifetime: AbortSignal, private readonly fail: (error: Error) => void) {}

  async openControl(command: string, signal: AbortSignal): Promise<SshControl> {
    this.directory = await mkdtemp('/tmp/dsh-ssh-')
    signal.throwIfAborted()
    const child = spawn('ssh', [
      '-T', '-M', '-S', this.controlPath(), '-o', 'ControlPersist=no', '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ClearAllForwardings=yes',
      '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=3', this.host, command,
    ], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child = child
    this.childClosed = new Promise((resolve) => { child.once('close', () => { resolve() }) })
    child.stderr.resume() // SSH diagnostics can contain configured paths; operation errors remain structured.
    child.once('error', this.fail)
    child.once('close', () => { this.fail(new Error('SSH helper disconnected; remote outcomes and cleanup are unknown')) })
    return { input: child.stdout, output: child.stdin }
  }

  openStream(path: string, signal: AbortSignal): Promise<Socket> {
    const operation = this.establishStream(path, signal)
    this.pending.add(operation)
    void operation.finally(() => { this.pending.delete(operation) }).catch(() => {})
    return operation
  }

  private async establishStream(path: string, signal: AbortSignal): Promise<Socket> {
    const localPath = join(this.directory as string, 's' + String(this.nextSocket++))
    const forwarding = localPath + ':' + path
    const cancelForward = async (): Promise<void> => {
      // An unavailable master already removed its forwarding listeners.
      if (!this.lifetime.aborted) await this.controlCommand(['-O', 'cancel', '-L', forwarding]).catch(() => {})
      await rm(localPath, { force: true })
    }
    try {
      await this.controlCommand(['-O', 'forward', '-o', 'ExitOnForwardFailure=yes', '-L', forwarding], signal)
      signal.throwIfAborted()
    } catch (error) { await cancelForward(); throw error }
    const socket = createConnection({ path: localPath, allowHalfOpen: true })
    socket.on('error', () => { socket.destroy() })
    const socketClosed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
    const abort = (): void => { socket.destroy(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))) }
    signal.addEventListener('abort', abort, { once: true })
    socket.once('close', () => {
      signal.removeEventListener('abort', abort)
      const cleanup = cancelForward().catch(() => {})
      this.pending.add(cleanup)
      void cleanup.finally(() => { this.pending.delete(cleanup) })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          signal.removeEventListener('abort', abort)
          socket.off('connect', connected); socket.off('error', failed); socket.off('close', closed)
        }
        const connected = (): void => { cleanup(); resolve() }
        const failed = (error: Error): void => { cleanup(); reject(error) }
        const closed = (): void => { failed(new Error('SSH stream closed before connecting')) }
        socket.once('connect', connected); socket.once('error', failed); socket.once('close', closed)
      })
      signal.throwIfAborted()
      return socket
    } catch (error) { socket.destroy(); await socketClosed; throw error }
  }

  stop(): void { this.child?.kill('SIGTERM') }

  async close(): Promise<void> {
    this.stop()
    const force = setTimeout(() => { this.child?.kill('SIGKILL') }, this.timeoutMs)
    try { await this.childClosed } finally { clearTimeout(force) }
    while (this.pending.size > 0) await Promise.allSettled([...this.pending])
    if (this.directory !== undefined) await rm(this.directory, { recursive: true, force: true })
  }

  private controlPath(): string { return join(this.directory as string, 'master') }

  private async controlCommand(args: string[], signal?: AbortSignal): Promise<void> {
    const signals = [this.lifetime, AbortSignal.timeout(this.timeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const combined = AbortSignal.any(signals)
    combined.throwIfAborted()
    const result = Promise.withResolvers<undefined>()
    const command = execFile('ssh', ['-S', this.controlPath(), ...args, this.host], {
      signal: combined, maxBuffer: 64 * 1024,
    }, (error) => { if (error === null) result.resolve(undefined); else result.reject(error) })
    const closed = new Promise<void>((resolve) => { command.once('close', () => { resolve() }) })
    let force: NodeJS.Timeout | undefined
    const escalate = (): void => {
      force = setTimeout(() => { command.kill('SIGKILL') }, this.timeoutMs)
      force.unref()
    }
    combined.addEventListener('abort', escalate, { once: true })
    try { await result.promise }
    finally {
      await closed
      combined.removeEventListener('abort', escalate)
      if (force !== undefined) clearTimeout(force)
    }
  }
}
