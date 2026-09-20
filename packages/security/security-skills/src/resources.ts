/** Installed security resource generations and Host-owned installation transactions. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { ResourceStore } from './resource-store.ts'
import { dirname, isAbsolute, join } from 'node:path'
import { collectResourceInventory, resourceContentSha256 } from './resource-inventory.ts'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { extractResourceArchive, parseReleaseManifest, validateResourceDirectory, verifyResourceFiles } from './resource-files.ts'
import type { SecuritySkillGenerationId, SecuritySkillGenerationLease, SecuritySkillOperationId, SecuritySkillRelease, SecuritySkillResourceErrorCode, SecuritySkillResourceInstallation, SecuritySkillResourceOperation, SecuritySkillResourceStatus } from './types.ts'
export type * from './types.ts'

/** Limits and the deployment-owned release endpoint. No endpoint is inferred. */
export interface Config {
  root?: string
  releaseManifestUrl?: string
  maxArchiveBytes: number
  maxExpandedBytes: number
  maxFiles: number
  downloadTimeoutMs: number
}

declare module '@deepseek-ai/cordis' {
  interface Context { securitySkillResources: SecuritySkillResources }
  interface Events {
    /**
     * Detached resource state after an operation transition or installation commit.
     * @mode parallel
     * @param snapshot - Complete published resource and Host operation state, detached from manager storage.
       */
    'security-skill-resources/changed'(snapshot: SecuritySkillResourceStatus): void | Promise<void>
  }
}

interface Pending {
  controller: AbortController
  operation: SecuritySkillResourceOperation
  done: Promise<void>
  expectedRevision: number
}
const bundledDirectory = fileURLToPath(new URL('../assets/skills/', import.meta.url))

/** Check an endpoint before any network request, including each redirect.
 * @param value - Absolute configured or manifest-provided endpoint.
 * @returns Validated HTTP(S) URL.
 */
function endpoint(value: string): URL {
  if (!value.toLowerCase().startsWith('https://') && !value.toLowerCase().startsWith('http://')) {
    throw new Error('Security resource URLs must be absolute HTTP(S) URLs')
  }
  const url = new URL(value)
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Security resource URLs require HTTPS, or loopback HTTP, without credentials or fragments')
  }
  return url
}

/** A stable admission failure mapped by the controller to localized client copy. */
export class SecuritySkillResourceError extends Error {
  constructor(readonly code: SecuritySkillResourceErrorCode, message: string) { super(message); this.name = 'SecuritySkillResourceError' }
}

/** Shared Host service; Agent providers only borrow committed generations. */
export default class SecuritySkillResources extends Service {
  static Config: Schema<Config> = Schema.object({
    root: Schema.string(),
    releaseManifestUrl: Schema.string(),
    maxArchiveBytes: Schema.number().min(1).default(64 * 1024 * 1024),
    maxExpandedBytes: Schema.number().min(1).default(256 * 1024 * 1024),
    maxFiles: Schema.number().min(1).default(10000),
    downloadTimeoutMs: Schema.number().min(1).default(120000),
  })
  private readonly root: string
  private readonly ready: Promise<void>
  private installation: SecuritySkillResourceInstallation | undefined
  private stateRevision = 0
  private available: SecuritySkillRelease | undefined
  private lastError: string | undefined
  private pending: Pending | undefined
  private stopped = false
  private readonly store: ResourceStore
  private readonly host: Context
  private refreshing: Promise<void> = Promise.resolve()
  private readonly notifications = new Set<Promise<void>>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'securitySkillResources')
    if (config.root !== undefined && !isAbsolute(config.root)) throw new Error('Security resource root must be absolute')
    this.root = config.root ?? join(resolveDshHome(), 'resources', 'security-skills')
    if (config.releaseManifestUrl !== undefined) endpoint(config.releaseManifestUrl)
    this.host = ctx
    this.store = new ResourceStore(this.root, (error) => { ctx.logger.warn('Security resource generation cleanup failed', error) })
    this.ready = this.initialize()
    ctx.effect(() => async () => {
      this.stopped = true
      this.pending?.controller.abort()
      await this.ready.catch(() => { /* Startup failure is reported by Service.init; disposal still drains owned work. */ })
      await this.pending?.done
      await this.refreshing.catch(() => { /* Refresh failures have already been published and logged. */ })
      await Promise.all(this.notifications)
    })
  }

  protected async [Service.init](): Promise<void> {
    await this.ready
    this.host.effect(() => {
      const watcher = watch(this.root, (_event, filename) => {
        if (filename !== 'active.json' || this.stopped) return
        void this.refresh().catch((error: unknown) => {
          this.host.logger.warn('Security resource refresh failed', error)
          this.lastError = 'Installed security resources could not be read. Repair or reinstall the resource package.'
          this.publish()
        })
      })
      return () => { watcher.close() }
    })
    await this.refresh()
  }

  /** Inspect committed state and current Host operation.
   * @returns A detached snapshot, including an explicit unavailable download reason.
   */
  async status(): Promise<SecuritySkillResourceStatus> {
    await this.ready
    await this.refresh()
    return this.snapshot()
  }

  /** Check only the configured release manifest.
   * @returns Snapshot of the newly started Host operation.
   */
  async checkUpdate(): Promise<SecuritySkillResourceStatus> { return this.start('check-update') }
  /** Download and install into an empty resource state.
   * @returns Snapshot of the newly started Host operation.
   */
  async install(): Promise<SecuritySkillResourceStatus> { return this.start('install') }
  /** Fetch and validate the release again while preserving the active generation.
   * @returns Snapshot of the newly started Host operation.
   */
  async reinstall(): Promise<SecuritySkillResourceStatus> { return this.start('reinstall') }
  /** Install a different published version after validating its entire inventory.
   * @returns Snapshot of the newly started Host operation.
   */
  async update(): Promise<SecuritySkillResourceStatus> { return this.start('update') }
  /** Copy the audited package seed; this operation performs no download.
   * @returns Snapshot of the newly started Host operation, marked bundled.
   */
  async installBundled(): Promise<SecuritySkillResourceStatus> { return this.start('install-bundled') }
  /** Atomically unpublish resources; leased generations remain readable.
   * @returns Snapshot of the newly started Host operation.
   */
  async remove(): Promise<SecuritySkillResourceStatus> { return this.start('remove') }

  /** Cancel only the specified Host operation and await its cleanup.
   * @param expectedOperationId - Optional identity protecting against a stale cancel action.
   * @returns State after settlement. Cancellation before publication preserves the prior generation;
   * an atomic replacement already in progress may commit and is never rolled back.
   */
  async cancel(expectedOperationId?: SecuritySkillOperationId): Promise<SecuritySkillResourceStatus> {
    await this.ready
    const pending = this.pending
    if (expectedOperationId !== undefined && pending?.operation.id !== expectedOperationId) throw new SecuritySkillResourceError('stale-operation', 'The security resource operation has already settled')
    if (pending !== undefined && (expectedOperationId === undefined || pending.operation.id === expectedOperationId)) {
      pending.operation.phase = 'cancelling'
      pending.controller.abort()
      this.publish()
      await pending.done
    }
    return this.snapshot()
  }

  /** Borrow the current generation until the owning realm releases it.
   * @returns A lease or undefined when no generation is installed.
   */
  async acquire(): Promise<SecuritySkillGenerationLease | undefined> {
    await this.ready
    if (this.stopped) return undefined
    const lease = await this.store.acquire()
    if (lease === undefined) return undefined
    return {
      directory: join(this.root, 'generations', lease.installation.generation, 'skills'),
      installation: lease.installation,
      release: () => lease.release(),
    }
  }

  private snapshot(): SecuritySkillResourceStatus {
    return structuredClone({
      resourceId: 'security-skills',
      state: this.installation !== undefined ? 'installed' : this.lastError !== undefined ? 'error' : 'not-installed',
      ...(this.installation === undefined ? {} : { installed: this.installation }),
      ...(this.available === undefined ? {} : {
        available: { version: this.available.version, bytes: this.available.bytes, sha256: this.available.sha256 },
      }),
      download: this.config.releaseManifestUrl === undefined
        ? { available: false, reason: 'No security skill release manifest URL is configured.' }
        : { available: true },
      ...(this.pending === undefined ? {} : { operation: this.pending.operation }),
      ...(this.lastError === undefined ? {} : { lastError: this.lastError }),
    })
  }

  private publish(): void {
    if (this.stopped) return
    const task = this.host.parallel('security-skill-resources/changed', this.snapshot()).catch((error: unknown) => {
      this.host.logger.warn('Security resource observer failed', error)
    }).finally(() => { this.notifications.delete(task) })
    this.notifications.add(task)
  }

  private async initialize(): Promise<void> {
    await this.store.initialize()
    await this.refresh()
  }

  private refresh(): Promise<void> {
    this.refreshing = this.refreshing.catch(() => {
      /* Callers report the previous failed read; later reads can recover. */
    }).then(async () => {
      if (!this.stopped) await this.refreshNow()
    })
    return this.refreshing
  }

  private async refreshNow(): Promise<void> {
    const state = await this.store.acquireState()
    try {
      this.stateRevision = state.revision
      const active = state.lease?.installation
      if (active?.generation === this.installation?.generation) return
      if (active !== undefined) {
        const { skillCount } = await validateResourceDirectory(join(this.root, 'generations', active.generation), new AbortController().signal)
        if (skillCount !== active.skillCount) throw new Error('Installed security skill inventory changed')
      }
      this.installation = active
      this.publish()
    } finally { await state.lease?.release() }
  }

  private async start(kind: SecuritySkillResourceOperation['kind']): Promise<SecuritySkillResourceStatus> {
    await this.ready
    await this.refresh()
    if (this.stopped) throw new SecuritySkillResourceError('disposed', 'Security resource manager is disposed')
    if (this.pending !== undefined) throw new SecuritySkillResourceError('busy', 'A security resource operation is already running')
    if (kind === 'install' && this.installation !== undefined) throw new SecuritySkillResourceError('already-installed', 'Security resources are already installed; use reinstall or update')
    if ((kind === 'reinstall' || kind === 'update') && this.installation === undefined) throw new SecuritySkillResourceError('not-installed', 'Security resources are not installed')
    if (!['install-bundled', 'remove'].includes(kind) && this.config.releaseManifestUrl === undefined) throw new SecuritySkillResourceError('not-configured', 'No security skill release manifest URL is configured.')
    this.lastError = undefined
    const pending: Pending = {
      controller: new AbortController(),
      operation: { id: randomUUID() as SecuritySkillOperationId, kind, phase: kind === 'remove' ? 'committing' : kind === 'install-bundled' ? 'validating' : 'fetching-manifest', bytesReceived: 0 },
      done: Promise.resolve(),
      expectedRevision: this.stateRevision,
    }
    this.pending = pending
    pending.done = this.execute(pending).catch((error: unknown) => {
      if (!pending.controller.signal.aborted) {
        this.host.logger.warn('Security resource operation failed', error)
        this.lastError = 'The security resource operation failed. The previous installation has been preserved.'
      }
    }).finally(() => {
      this.pending = undefined
      this.publish()
    })
    this.publish()
    return this.snapshot()
  }

  private async execute(pending: Pending): Promise<void> {
    const { signal } = pending.controller
    const kind = pending.operation.kind
    if (kind === 'remove') {
      await this.commit(undefined, pending)
      return
    }
    let release: SecuritySkillRelease | undefined
    let version: string
    if (kind !== 'install-bundled') {
      const bytes = await this.fetchBytes(this.config.releaseManifestUrl as string, 1024 * 1024, signal)
      release = parseReleaseManifest(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), this.config.releaseManifestUrl as string)
      if (release.bytes > this.config.maxArchiveBytes) throw new Error('Security resource archive exceeds the configured byte limit')
      this.available = release
      if (kind === 'check-update' || (kind === 'update' && release.version === this.installation?.version)) return
    }
    const generation = randomUUID() as SecuritySkillGenerationId
    const staging = join(this.root, 'staging-' + generation)
    const content = join(staging, 'content')
    const prepared = { moved: false }
    let committed = false
    try {
      await mkdir(staging, { mode: 0o700 })
      await writeFile(join(staging, 'owner.json'), JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
      await mkdir(content)
      signal.throwIfAborted()
      if (release === undefined) {
        const inventory = await collectResourceInventory(bundledDirectory, {
          licensePath: join(bundledDirectory, '..', 'LICENSE'),
          noticePath: join(bundledDirectory, '..', 'NOTICE'),
        })
        if (inventory.files.length > this.config.maxFiles || inventory.files.reduce((bytes, file) => bytes + file.bytes, 0) > this.config.maxExpandedBytes) throw new Error('Bundled resources exceed configured limits')
        for (const [path, bytes] of inventory.data) {
          signal.throwIfAborted()
          const destination = join(content, path)
          await mkdir(dirname(destination), { recursive: true })
          await writeFile(destination, bytes, { flag: 'wx', signal })
        }
        version = '1-' + resourceContentSha256(inventory.files).slice(0, 16)
      } else {
        version = release.version
        pending.operation.phase = 'downloading'
        pending.operation.totalBytes = release.bytes
        const archive = await this.fetchBytes(release.archiveUrl, release.bytes, signal, pending)
        if (archive.byteLength !== release.bytes || createHash('sha256').update(archive).digest('hex') !== release.sha256) throw new Error('Security resource archive byte count or SHA-256 mismatch')
        pending.operation.phase = 'extracting'
        this.publish()
        await extractResourceArchive(archive, content, this.config, signal)
        await verifyResourceFiles(content, release, signal)
      }
      pending.operation.phase = 'validating'
      this.publish()
      const { skillCount } = await validateResourceDirectory(content, signal)
      const installation: SecuritySkillResourceInstallation = {
        version, generation, installedAt: Date.now(), skillCount,
        source: release === undefined ? { kind: 'bundled' } : { kind: 'download', url: endpoint(release.archiveUrl).origin + endpoint(release.archiveUrl).pathname },
      }
      signal.throwIfAborted()
      pending.operation.phase = 'committing'
      this.publish()
      await this.commit(installation, pending, async () => {
        await rename(content, join(this.root, 'generations', generation))
        prepared.moved = true
      })
      committed = true
    } finally {
      await rm(staging, { recursive: true, force: true })
      if (prepared.moved && !committed) await rm(join(this.root, 'generations', generation), { recursive: true, force: true })
    }
  }

  private async fetchBytes(value: string, limit: number, signal: AbortSignal, pending?: Pending): Promise<Uint8Array> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.config.downloadTimeoutMs)])
    let url = endpoint(value)
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await fetch(url, { signal: combined, redirect: 'manual' })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const location = response.headers.get('location')
        if (location === null) throw new Error('Security resource redirect has no location')
        url = endpoint(new URL(location, url).href)
        continue
      }
      if (!response.ok || response.body === null) { await response.body?.cancel(); throw new Error('Security resource HTTP request failed: ' + String(response.status)) }
      const declared = response.headers.get('content-length')
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body.cancel(); throw new Error('Security resource response exceeds its byte limit') }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let count = 0
      try {
        while (true) {
          combined.throwIfAborted()
          const item = await reader.read()
          if (item.done) break
          count += item.value.byteLength
          if (count > limit) throw new Error('Security resource response exceeds its byte limit')
          chunks.push(item.value)
          if (pending !== undefined) { pending.operation.bytesReceived = count; this.publish() }
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      return Buffer.concat(chunks, count)
    }
    throw new Error('Too many security resource redirects')
  }

  private async commit(installation: SecuritySkillResourceInstallation | undefined,
    pending: Pending, prepare?: () => Promise<void>): Promise<void> {
    if (!await this.store.commit(installation, pending.expectedRevision, pending.controller.signal, prepare)) {
      await this.refresh()
      throw new Error('Security resources changed in another Host; retry with the current state')
    }
    this.stateRevision = pending.expectedRevision + 1
    this.installation = installation
    this.publish()
  }


}
