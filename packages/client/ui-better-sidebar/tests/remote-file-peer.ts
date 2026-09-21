/** Controlled external SSH peer for Sidebar execution-world integration tests. */
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Config } from '@deepseek-ai/dsh-ssh'
import { spawnSchema } from '@deepseek-ai/dsh-ssh/schemas'
import type { ZodType } from 'zod'
import { z } from 'zod'

/** Remote observations owned by one isolated test endpoint. */
export interface RemoteFileWorld {
  readonly host: string
  readonly files: Map<string, string>
  readonly directories: ReadonlySet<string>
  readonly requests: { method: string; params: unknown }[]
  readonly connections: FilePeer[]
  readonly commands: string[][]
  disposed: number
}

const endpoints = new Map<string, RemoteFileWorld>()

/**
 * Register one independently addressable peer without opening a network socket.
 * @param label - distinctive remote file contents.
 * @returns endpoint state and cleanup.
 */
export function remoteFileWorld(label: string): { world: RemoteFileWorld; unregister: () => void } {
  const world: RemoteFileWorld = {
    host: randomUUID() + '.example',
    files: new Map([['/project/shared.txt', label]]),
    directories: new Set(['/project', '/project/nested']),
    requests: [],
    connections: [],
    commands: [],
    disposed: 0,
  }
  endpoints.set(world.host, world)
  return { world, unregister: () => { endpoints.delete(world.host) } }
}

/** Only the authenticated external peer is substituted; execution providers remain production implementations. */
export class FilePeer extends Service {
  readonly ready: Promise<{ platform: 'linux'; workspace: string }>
  private readonly lifetime = new AbortController()
  private readonly processes = new Map<string, z.infer<typeof spawnSchema>>()
  private readonly texts = new Map<string, string>()
  private disposed = false
  protected readonly world: RemoteFileWorld

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
   * Answer the helper protocol through each production provider's result validator.
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

  private target(params: unknown): string {
    return z.object({ target: z.object({ targetKey: z.string() }) }).parse(params).target.targetKey
  }

  private process(params: unknown): z.infer<typeof spawnSchema> {
    const { id } = z.object({ id: z.string() }).parse(params)
    const spec = this.processes.get(id)
    if (spec === undefined) throw new Error('Unknown fixture process')
    return spec
  }

  private gitResult(argv: readonly string[]): string {
    const nul = String.fromCharCode(0)
    if (argv.includes('--show-toplevel')) return '/project\ntrue\n'
    if (argv.includes('--absolute-git-dir')) return '/project/.git\n'
    if (argv.includes('--is-inside-work-tree')) return 'true\n'
    if (argv.includes('symbolic-ref')) return 'main\n'
    if (argv.includes('rev-parse')) return 'a'.repeat(40) + '\n'
    if (argv.includes('status')) {
      const label = this.world.files.values().next().value
      return label === undefined ? '' : '?? ' + label + '.txt' + nul
    }
    if (argv.includes('diff')) return 'diff --git a/shared.txt b/shared.txt\n+remote difference\n'
    return ''
  }

  private respond(method: string, params: unknown): unknown {
    switch (method) {
      case 'fs.resolve': {
        const value = z.object({ path: z.string(), cwd: z.string().optional() }).parse(params)
        const path = posix.resolve(value.cwd ?? this.config.workspace, value.path)
        return { targetKey: path, displayPath: path }
      }
      case 'fs.stat': {
        const path = this.target(params)
        if (this.world.directories.has(path)) return { version: 'directory', type: 'directory' }
        const value = this.world.files.get(path)
        return value === undefined ? null : { version: value, type: 'file', size: Buffer.byteLength(value) }
      }
      case 'fs.lstat': {
        const value = z.object({ path: z.string(), cwd: z.string().optional() }).parse(params)
        const path = posix.resolve(value.cwd ?? '/project', value.path)
        if (this.world.directories.has(path)) return { type: 'directory', version: 'dir' }
        const text = this.world.files.get(path)
        return text === undefined ? null : { type: 'file', version: text }
      }
      case 'fs.list': {
        const path = this.target(params)
        return [...this.world.files]
          .filter(([name]) => posix.dirname(name) === path)
          .map(([name, value]) => ({
            name: posix.basename(name),
            type: 'file',
            size: Buffer.byteLength(value),
            target: { targetKey: name, displayPath: name },
          }))
      }
      case 'fs.readText': {
        const value = this.world.files.get(this.target(params))
        if (value === undefined) throw new Error('Remote fixture file absent')
        return value
      }
      case 'fs.readRange': {
        const { offset, length } = z.object({ offset: z.number(), length: z.number() }).parse(params)
        return Buffer.from(this.world.files.get(this.target(params)) ?? '')
          .subarray(offset, offset + length).toString('base64')
      }
      case 'fs.readBytes':
        return Buffer.from(this.world.files.get(this.target(params)) ?? '').toString('base64')
      case 'fs.stream': {
        const id = randomUUID()
        this.texts.set(id, this.world.files.get(this.target(params)) ?? '')
        return id
      }
      case 'fs.next': {
        const { id } = z.object({ id: z.string() }).parse(params)
        const value = this.texts.get(id) ?? ''
        this.texts.delete(id)
        return { done: true, value }
      }
      case 'fs.streamClose': return null
      case 'fs.write': {
        const value = z.object({
          target: z.object({ targetKey: z.string() }), content: z.string(),
        }).parse(params)
        const before = this.world.files.get(value.target.targetKey) ?? null
        this.world.files.set(value.target.targetKey, value.content)
        return {
          operation: before === null ? 'create' : 'update',
          before, after: value.content, version: value.content,
        }
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
        if (spec.argv[0]?.endsWith('git')) return {}
        if (spec.argv[0] !== '/usr/bin/touch' || spec.argv[1] === undefined) {
          throw new Error('Unsupported fixture command')
        }
        this.world.files.set(posix.resolve(spec.cwd, spec.argv[1]), '')
        return {}
      }
      case 'process.done': {
        const spec = this.process(params)
        const output = spec.argv[0]?.endsWith('git') ? this.gitResult(spec.argv) : ''
        return { outcome: { exitCode: 0, signal: null }, spills: {}, collected: {
          stdout: { tail: Buffer.from(output).toString('base64'), totalBytes: Buffer.byteLength(output) },
          stderr: { tail: '', totalBytes: 0 },
        } }
      }
      case 'process.wait': return true
      case 'process.terminate': return null
      default: throw new Error('Unexpected external SSH request: ' + method)
    }
  }

  /** Awaitable idempotent external connection teardown. */
  dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.world.disposed++
      this.lifetime.abort(new Error('Fixture SSH disposed'))
    }
    return Promise.resolve()
  }
}
