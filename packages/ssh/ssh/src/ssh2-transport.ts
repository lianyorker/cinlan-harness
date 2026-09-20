/** Explicit SSH identity and streamlocal channels for clients without OpenSSH multiplexing. */
import { readFile } from 'node:fs/promises'
import { Client, utils, type ClientChannel, type ClientCallback } from 'ssh2'
import type { SshControl, SshTransport } from './transport.ts'

/** Deployment-selected endpoint; credentials and host trust are never discovered implicitly. */
export interface SshEndpoint {
  /** SSH server hostname or address. */
  host: string
  /** SSH server TCP port. */
  port: number
  /** Remote account name. */
  username: string
  /** Absolute local path to the unencrypted private key to use. */
  privateKeyFile: string
  /** Lowercase hexadecimal SHA-256 of the server's SSH public-key blob. */
  hostKeySHA256: string
}

/** SSH2 carries the same helper protocol and TLS-PSK streams as the alias transport. */
export class Ssh2Transport implements SshTransport {
  private readonly client = new Client()
  private closed: Promise<void> | undefined
  private stopped = false
  constructor(private readonly endpoint: SshEndpoint, private readonly timeoutMs: number,
    private readonly fail: (error: Error) => void) {
    this.client.on('error', (error) => { this.fail(error) })
  }

  async openControl(command: string, signal: AbortSignal): Promise<SshControl> {
    const privateKey = await readFile(this.endpoint.privateKeyFile)
    try {
      signal.throwIfAborted()
      if (this.stopped) throw new Error('SSH connection closed before startup')
      const parsed = utils.parseKey(privateKey)
      if (parsed instanceof Error) throw new Error('Cannot parse configured SSH private key', { cause: parsed })
    } catch (error) { privateKey.fill(0); throw error }
    this.closed = new Promise((resolve) => { this.client.once('close', () => { resolve() }) })
    this.client.once('close', () => { this.fail(new Error('SSH helper disconnected; remote outcomes and cleanup are unknown')) })
    const abort = (): void => { this.stop() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
          this.client.off('ready', ready); this.client.off('error', failed); this.client.off('close', closed)
        }
        const ready = (): void => { cleanup(); resolve() }
        const failed = (error: Error): void => { cleanup(); reject(error) }
        const closed = (): void => { failed(new Error('SSH connection closed before authentication')) }
        this.client.once('ready', ready); this.client.once('error', failed); this.client.once('close', closed)
        try {
          this.client.connect({
            host: this.endpoint.host, port: this.endpoint.port, username: this.endpoint.username, privateKey,
            hostHash: 'sha256', hostVerifier: (hash: string) => hash === this.endpoint.hostKeySHA256,
            readyTimeout: this.timeoutMs, keepaliveInterval: 10_000, keepaliveCountMax: 3,
            agentForward: false, authHandler: ['publickey'],
          })
        } catch (error) {
          cleanup()
          this.closed = undefined // SSH2 validates configuration before creating its socket.
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      signal.throwIfAborted()
      const channel = await this.openChannel((callback) => { this.client.exec(command, callback) }, signal)
      channel.stderr.resume()
      channel.once('close', () => { this.fail(new Error('SSH helper disconnected; remote outcomes and cleanup are unknown')) })
      return { input: channel, output: channel }
    } finally {
      signal.removeEventListener('abort', abort)
      privateKey.fill(0)
    }
  }

  openStream(path: string, signal: AbortSignal): Promise<ClientChannel> {
    return this.openChannel((callback) => { this.client.openssh_forwardOutStreamLocal(path, callback) }, signal)
  }

  stop(): void {
    this.stopped = true
    this.client.destroy()
  }

  async close(): Promise<void> { this.stop(); await this.closed }

  private openChannel(open: (callback: ClientCallback) => void, signal: AbortSignal): Promise<ClientChannel> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      let settled = false
      const cleanup = (): void => { clearTimeout(timer); this.client.off('close', closed) }
      const failed = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const closed = (): void => { failed(new Error('SSH connection closed while opening a channel')) }
      const timer = setTimeout(() => {
        const error = new Error('SSH channel open timed out')
        this.fail(error)
        this.stop()
        failed(error)
      }, this.timeoutMs)
      this.client.once('close', closed)
      try {
        open((error, channel) => {
          if (error !== undefined) { failed(error); return }
          channel.on('error', () => { channel.destroy() })
          if (settled || signal.aborted) {
            channel.once('close', () => {
              failed(signal.reason instanceof Error ? signal.reason : new Error('SSH channel open cancelled'))
            })
            channel.destroy()
            // SSH2 emits close after readable EOF; a cancelled unpublished channel has no consumer.
            channel.resume()
            channel.stderr.resume()
            return
          }
          settled = true
          cleanup()
          resolve(channel)
        })
      } catch (error) { failed(error instanceof Error ? error : new Error(String(error))) }
    })
  }
}
