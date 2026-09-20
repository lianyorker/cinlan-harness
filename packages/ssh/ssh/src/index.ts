/** SSH connection owner for one version-matched POSIX helper and its independent authenticated streams. */

import { isAbsolute } from 'node:path'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { OpenSshTransport } from './openssh-transport.ts'
import { Ssh2Transport, type SshEndpoint } from './ssh2-transport.ts'
import type { SshTransport } from './transport.ts'
import { Context, Service } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { SshRpcPeer, SSH_PROTOCOL_VERSION } from './protocol.ts'
import { helloSchema, type SshStreamEndpoint } from './schemas.ts'
import { authenticateStream } from './stream-security.ts'

type Hello = z.infer<typeof helloSchema>

/** Deployment-owned SSH identity and installed helper; no model argument selects these values. */
export interface Config {
  /** OpenSSH host alias, including its existing user, key and known-host configuration. */
  host?: string
  /** Explicit endpoint for Windows or deployments without OpenSSH alias resolution; excludes host. */
  endpoint?: SshEndpoint
  /** Absolute remote Node executable. */
  node: string
  /** Absolute path to the installed, bundled helper entry. */
  helper: string
  /** SHA-256 of that bundled helper; mismatches refuse the connection. */
  helperHash: string
  /** Absolute remote default workspace. */
  workspace: string
  /** Optional preinstalled built PTC entry, paired with its expected digest. */
  bootstrapPath?: string
  /** SHA-256 of bootstrapPath; both fields must be supplied together. */
  bootstrapHash?: string
  /** Connection and administrative-request deadline, at most 2,147,483,647 milliseconds. */
  requestTimeoutMs?: number
  /** Maximum JSON payload bytes per helper request or response. */
  maxFrameBytes?: number
  /** Maximum ordinary requests; heartbeat and bounded resource cleanup have reserved capacity. */
  maxPending?: number
  /** Remote helper lease; loss of heartbeats starts remote managed cleanup. */
  leaseMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { ssh: SshConnection }
}

/** One non-reconnecting SSH session; loss invalidates all active operations. */
export class SshConnection extends Service {
  static Config: schema<Config> = schema.object({
    host: schema.string(),
    endpoint: schema.object({
      host: schema.string().required(), port: schema.number().required(), username: schema.string().required(),
      privateKeyFile: schema.string().required(), hostKeySHA256: schema.string().required(),
    }),
    node: schema.string().required(), helper: schema.string().required(),
    helperHash: schema.string().required(), workspace: schema.string().required(),
    bootstrapPath: schema.string(), bootstrapHash: schema.string(),
    requestTimeoutMs: schema.number().default(30_000), maxFrameBytes: schema.number().default(64 * 1024 * 1024),
    maxPending: schema.number().default(128), leaseMs: schema.number().default(30_000),
  })

  /** Verified remote helper coordinates; callers must await this before launch. */
  readonly ready: Promise<Hello>
  private rpc: SshRpcPeer | undefined
  private readonly transport: SshTransport
  private heartbeat: NodeJS.Timeout | undefined
  private closed = false
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private disposal: Promise<void> | undefined
  private failure: Error | undefined
  private sockets = new Set<Duplex>()
  private readonly config: Required<Omit<Config, 'host' | 'endpoint' | 'bootstrapPath' | 'bootstrapHash'>> & Pick<Config, 'host' | 'endpoint' | 'bootstrapPath' | 'bootstrapHash'>
  private remote: Hello | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'ssh')
    if (config.endpoint === undefined && process.platform !== 'linux' && process.platform !== 'darwin') {
      throw new Error('SSH OpenSSH aliases require a POSIX client; configure an explicit endpoint on Windows')
    }
    this.config = z.object({
      host: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/).optional(),
      endpoint: z.object({
        host: z.string().min(1), port: z.number().int().min(1).max(65535), username: z.string().min(1),
        privateKeyFile: z.string().refine(isAbsolute, 'privateKeyFile must be absolute'),
        hostKeySHA256: z.string().regex(/^[0-9a-f]{64}$/),
      }).optional(),
      node: z.string().startsWith('/'), helper: z.string().startsWith('/'), helperHash: z.string().regex(/^[0-9a-f]{64}$/),
      workspace: z.string().startsWith('/'), requestTimeoutMs: z.number().int().positive().max(2_147_483_647),
      bootstrapPath: z.string().startsWith('/').optional(), bootstrapHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
      maxFrameBytes: z.number().int().positive().max(64 * 1024 * 1024), maxPending: z.number().int().positive().max(128),
      leaseMs: z.number().int().min(3000).max(600_000),
    }).refine(value => (value.bootstrapPath === undefined) === (value.bootstrapHash === undefined), 'bootstrapPath and bootstrapHash must be paired')
      .refine(value => (value.host === undefined) !== (value.endpoint === undefined), 'Supply exactly one of host or endpoint')
      .parse(config) as typeof this.config
    const host = this.config.host
    const endpoint = this.config.endpoint
    if (endpoint !== undefined) {
      this.transport = new Ssh2Transport(endpoint, this.config.requestTimeoutMs, (error) => { this.fail(error) })
    } else {
      if (host === undefined) throw new Error('SSH transport configuration is incomplete')
      this.transport = new OpenSshTransport(host, this.config.requestTimeoutMs, this.lifetime.signal, (error) => { this.fail(error) })
    }
    this.ready = this.start()
    // Startup uses Node I/O, local validation, and Error-valued RPC failures.
    void this.ready.catch((error: unknown) => { this.fail(error as Error) })
    ctx.effect(() => () => this.dispose())
  }

  /** Hold plugin readiness until the remote identity and helper digest are verified. */
  async [Service.init](): Promise<void> { await this.ready }

  /** Verified remote Node executable for the paired PTC runtime. */
  get nodeExecutable(): string {
    if (this.remote === undefined) throw new Error('SSH helper is not ready')
    return this.remote.node
  }

  /** Verified preinstalled PTC entry; unconfigured runtimes fail before program execution. */
  get bootstrapPath(): string {
    if (this.remote === undefined || this.config.bootstrapPath === undefined) throw new Error('SSH PTC requires a verified bootstrapPath and bootstrapHash')
    return this.config.bootstrapPath
  }

  /**
   * Send a helper operation; cancellation never replays an ambiguous mutation.
   * @param method - the private helper operation.
   * @param params - JSON request fields validated by the helper.
   * @param result - response validation before returning provider-visible data.
   * @param signal - cancellation, which does not undo completed remote effects.
   * @param wait - allow a process observation to outlast the administrative deadline.
   * @returns the validated remote result.
   */
  async request<T>(method: string, params: unknown, result: z.ZodType<T>, signal?: AbortSignal, wait: boolean = false): Promise<T> {
    this.assertOpen()
    await this.ready
    this.assertOpen()
    const bounded = wait ? signal : signal === undefined
      ? AbortSignal.timeout(this.config.requestTimeoutMs)
      : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    return (this.rpc as SshRpcPeer).request(method, params, result, bounded)
  }

  /**
   * Forward one authenticated stream through an independent SSH channel.
   * @param endpoint - private coordinates issued by this connection's helper.
   * @param signal - cancellation of allocation and the resulting socket.
   * @returns a paused socket; attach a consumer before resuming it.
   */
  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    return this.track(this.establishStream(endpoint, signal))
  }

  private async establishStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    const hello = await this.ready
    this.assertOpen()
    signal = signal === undefined ? this.lifetime.signal : AbortSignal.any([signal, this.lifetime.signal])
    const remote = endpoint.path
    if (!remote.startsWith(`${hello.root}/`) || /[:\r\n\0]/u.test(remote)) throw new Error('SSH helper returned an invalid stream path')
    signal.throwIfAborted()
    const socket = await this.transport.openStream(remote, signal)
    this.sockets.add(socket)
    socket.once('close', () => { this.sockets.delete(socket) })
    const authenticated = await authenticateStream(socket, endpoint.capability, this.config.requestTimeoutMs, signal)
    this.sockets.add(authenticated)
    authenticated.on('error', () => { authenticated.destroy() })
    authenticated.once('close', () => { this.sockets.delete(authenticated) })
    return authenticated
  }

  /** Tear down the helper's remote managed ranges before releasing the SSH master when reachable. */
  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    this.lifetime.abort(new Error('SSH connection is closing'))
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    try {
      await this.ready.catch(() => {})
      if (this.failure === undefined) await this.rpc?.request('close', {}, z.null(), AbortSignal.timeout(this.config.requestTimeoutMs))
    } finally {
      this.rpc?.close()
      // TLS wrappers release their reads before their underlying sockets close.
      const socketClosures = [...this.sockets].reverse().map(socket => new Promise<void>((resolve) => {
        if (socket.closed) resolve()
        else { socket.once('close', () => { resolve() }); socket.destroy() }
      }))
      this.transport.stop()
      await Promise.all(socketClosures)
      while (this.operations.size > 0) await Promise.allSettled([...this.operations])
      await this.transport.close()
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('SSH connection is closed')
    if (this.failure !== undefined) throw this.failure
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation.finally(() => { this.operations.delete(operation) }).catch(() => {})
    return operation
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    this.lifetime.abort(error)
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.rpc?.close(error)
    for (const socket of [...this.sockets].reverse()) socket.destroy(error)
    this.transport.stop()
  }

  private async start(): Promise<Hello> {
    const quote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
    const command = [this.config.node, '--disable-sigusr1', this.config.helper].map(quote).join(' ')
    const control = await this.transport.openControl(command, this.lifetime.signal)
    this.assertOpen()
    const rpc = new SshRpcPeer(control.input, control.output, this.config.maxFrameBytes, this.config.maxPending)
    this.rpc = rpc
    rpc.once('closed', (error) => { this.fail(error as Error) })
    const hello = await rpc.request('hello', {
      protocol: SSH_PROTOCOL_VERSION, workspace: this.config.workspace, leaseMs: this.config.leaseMs,
      ...(this.config.bootstrapPath === undefined ? {} : { bootstrapPath: this.config.bootstrapPath }),
    }, helloSchema, AbortSignal.timeout(this.config.requestTimeoutMs))
    if (hello.hash !== this.config.helperHash) throw new Error('SSH helper digest differs from the configured artifact')
    if (hello.bootstrapHash !== this.config.bootstrapHash) throw new Error('SSH PTC bootstrap digest differs from the configured artifact')
    this.remote = hello
    let heartbeatPending: Promise<unknown> | undefined
    this.heartbeat = setInterval(() => {
      heartbeatPending ??= rpc.request('heartbeat', {}, z.null(), AbortSignal.timeout(this.config.leaseMs / 2))
        .catch((error: unknown) => { this.fail(error as Error) })
        .finally(() => { heartbeatPending = undefined })
    }, Math.floor(this.config.leaseMs / 3))
    this.heartbeat.unref()
    return hello
  }
}

export default SshConnection
