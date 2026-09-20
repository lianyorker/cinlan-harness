/** Controlled external SSH peer; official filesystem, process and sandbox providers remain mounted. */
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Config } from '@deepseek-ai/dsh-ssh'
import type { ZodType } from 'zod'
import { z } from 'zod'
import { spawnSchema } from '@deepseek-ai/dsh-ssh/schemas'

/** Remote observations owned by one isolated test endpoint. */
export interface RemoteFixture {
  readonly host: string
  readonly files: Map<string, string>
  readonly directories: ReadonlySet<string>
  readonly requests: { method: string; params: unknown }[]
  readonly connections: FixtureSsh[]
  readonly commands: string[][]
  disposed: number
}

const endpoints = new Map<string, RemoteFixture>()

/**
 * Register a unique external endpoint without opening any network sockets.
 * @param label - distinctive remote file contents.
 * @returns the endpoint state and its registry cleanup.
 */
export function remoteFixture(label: string): { world: RemoteFixture; unregister(): void } {
  const world: RemoteFixture = {
    host: randomUUID() + '.example', files: new Map([['/project/shared.txt', label]]),
    directories: new Set(['/project', '/project/nested']),
    requests: [], connections: [], commands: [], disposed: 0,
  }
  endpoints.set(world.host, world)
  return { world, unregister: () => { endpoints.delete(world.host) } }
}

/** Only the authenticated remote peer is substituted by the binding tests. */
export class FixtureSsh extends Service {
  readonly ready: Promise<{ platform: 'linux'; workspace: string }>
  private readonly lifetime = new AbortController()
  protected readonly processes = new Map<string, z.infer<typeof spawnSchema>>()
  private disposed = false
  protected readonly world: RemoteFixture

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'ssh')
    const world = config.endpoint === undefined ? undefined : endpoints.get(config.endpoint.host)
    if (world === undefined) throw new Error('Unknown test SSH endpoint')
    this.world = world
    world.connections.push(this)
    this.ready = Promise.resolve({ platform: 'linux', workspace: config.workspace })
    ctx.effect(() => () => this.dispose())
  }

  /** Transport loss invalidates existing leases without provisioning a replacement. */
  drop(): void { this.lifetime.abort(new Error('Fixture SSH connection lost')) }

  /** The official providers observe one connection lifetime. */
  get signal(): AbortSignal { return this.lifetime.signal }
  /** The remote handshake confirms the deployment Node executable. */
  get nodeExecutable(): string { return this.config.node }
  /** Full execution requires a deployed bootstrap. */
  get bootstrapPath(): string {
    if (this.config.bootstrapPath === undefined) throw new Error('Fixture bootstrap missing')
    return this.config.bootstrapPath
  }

  /**
   * Answer the helper protocol through each official provider's result validator.
   * @param method - helper operation selected by the provider.
   * @param params - serialized request values.
   * @param result - production response schema.
   * @param signal - operation admission cancellation.
   * @returns the validated external observation.
   */
  request<T>(method: string, params: unknown, result: ZodType<T>, signal?: AbortSignal): Promise<T> {
    return Promise.resolve().then(() => {
      this.signal.throwIfAborted()
      signal?.throwIfAborted()
      const wire: unknown = JSON.parse(JSON.stringify(params))
      this.world.requests.push({ method, params: wire })
      return result.parse(this.respond(method, wire))
    })
  }

  protected respond(method: string, params: unknown): unknown {
    switch (method) {
      case 'fs.resolve': {
        const value = z.object({ path: z.string(), cwd: z.string().optional() }).parse(params)
        const path = posix.resolve(value.cwd ?? this.config.workspace, value.path)
        return { targetKey: path, displayPath: path }
      }
      case 'fs.stat': {
        const { target } = z.object({ target: z.object({ targetKey: z.string() }) }).parse(params)
        if (this.world.directories.has(target.targetKey)) return { version: 'directory', type: 'directory' }
        const value = this.world.files.get(target.targetKey)
        return value === undefined ? null : { version: value, type: 'file', size: Buffer.byteLength(value) }
      }
      case 'fs.readText': {
        const { target } = z.object({ target: z.object({ targetKey: z.string() }) }).parse(params)
        const value = this.world.files.get(target.targetKey)
        if (value === undefined) throw new Error('Remote fixture file absent')
        return value
      }
      case 'fs.write': {
        const { target, content } = z.object({ target: z.object({ targetKey: z.string() }), content: z.string() }).parse(params)
        const before = this.world.files.get(target.targetKey) ?? null
        this.world.files.set(target.targetKey, content)
        return { operation: before === null ? 'create' : 'update', before, after: content, version: content }
      }
      case 'executable': {
        const { command } = z.object({ command: z.string() }).parse(params)
        return command.startsWith('/') ? command : '/usr/bin/' + command
      }
      case 'sandbox': {
        const { argv } = z.object({ argv: z.array(z.string()) }).parse(params)
        return { argv, enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
      }
      case 'process.prepare': {
        const spec = spawnSchema.parse(params)
        const id = randomUUID()
        this.processes.set(id, spec)
        return { id, streams: {} }
      }
      case 'process.start': {
        const spec = this.process(params)
        this.world.commands.push(spec.argv)
        if (spec.argv[0] !== '/usr/bin/touch' || spec.argv[1] === undefined) throw new Error('Unsupported fixture command')
        this.world.files.set(posix.resolve(spec.cwd, spec.argv[1]), '')
        return {}
      }
      case 'process.done': {
        this.process(params)
        return { outcome: { exitCode: 0, signal: null }, spills: {},
          collected: { stdout: { tail: '', totalBytes: 0 }, stderr: { tail: '', totalBytes: 0 } } }
      }
      case 'process.wait': return true
      case 'process.terminate': return null
      default: throw new Error('Unexpected external SSH request: ' + method)
    }
  }

  protected process(params: unknown): z.infer<typeof spawnSchema> {
    const { id } = z.object({ id: z.string() }).parse(params)
    const spec = this.processes.get(id)
    if (spec === undefined) throw new Error('Unknown fixture process')
    return spec
  }

  /** Awaitable, idempotent external connection teardown. */
  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.world.disposed++
      this.lifetime.abort(new Error('Fixture SSH disposed'))
    }
    return Promise.resolve()
  }
}
