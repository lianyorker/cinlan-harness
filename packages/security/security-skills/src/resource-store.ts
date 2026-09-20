/** Cross-process generation publication and leases under one short writer lock. */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { SecuritySkillGenerationId, SecuritySkillResourceInstallation } from './types.ts'

const generationPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Reports only definite process death; reuse or permission failures retain bytes. */
function dead(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return false } catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

/** A persistent root shared by Hosts; no in-memory state grants deletion authority. */
export class ResourceStore {
  constructor(readonly root: string, private readonly onCleanupError: (error: unknown) => void) {}

  /** Read the atomic pointer, validating identifiers before resolving any path.
   * @returns The committed installation or undefined when explicitly absent.
   */
  async read(): Promise<SecuritySkillResourceInstallation | undefined> {
    return (await this.readState()).installed
  }

  /** Read the installation and monotonic publication revision from the same atomic record.
   * @returns Revision zero for a missing pointer; persisted pointers require a positive safe integer revision.
   */
  async readState(): Promise<{ revision: number; installed: SecuritySkillResourceInstallation | undefined }> {
    let raw: string
    try { raw = await readFile(join(this.root, 'active.json'), 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { revision: 0, installed: undefined }
      throw error
    }
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || !('schemaVersion' in value) || value.schemaVersion !== 1 || !('installed' in value)) throw new Error('Invalid security resource active state')
    if (!('revision' in value) || typeof value.revision !== 'number'
      || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('Invalid security resource revision')
    const revision = value.revision
    if (value.installed === null) return { revision, installed: undefined }
    if (!value.installed || typeof value.installed !== 'object') throw new Error('Invalid security resource installation record')
    const active = value.installed as Record<string, unknown>
    if (typeof active.generation !== 'string' || !generationPattern.test(active.generation)
      || typeof active.version !== 'string' || !active.version || typeof active.installedAt !== 'number'
      || !Number.isFinite(active.installedAt) || typeof active.skillCount !== 'number'
      || !Number.isSafeInteger(active.skillCount) || active.skillCount < 1 || !active.source
      || typeof active.source !== 'object') throw new Error('Invalid security resource installation record')
    const source = active.source as Record<string, unknown>
    if (source.kind !== 'bundled' && source.kind !== 'download') throw new Error('Invalid security resource provenance')
    if (source.url !== undefined && typeof source.url !== 'string') throw new Error('Invalid security resource source URL')
    const metadata = await lstat(join(this.root, 'generations', active.generation))
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Active security generation is not a real directory')
    return {
      revision,
      installed: {
        generation: active.generation as SecuritySkillGenerationId, version: active.version,
        installedAt: active.installedAt, skillCount: active.skillCount,
        source: { kind: source.kind, ...(typeof source.url === 'string' ? { url: source.url } : {}) },
      },
    }
  }

  /** Recover dead staging and inactive generations with no live or unknown lease owners.
   * @returns Completion after root initialization and safe orphan cleanup.
   */
  async initialize(): Promise<void> {
    await mkdir(join(this.root, 'generations'), { recursive: true })
    await mkdir(join(this.root, 'leases'), { recursive: true })
    for (const directory of [this.root, join(this.root, 'generations'), join(this.root, 'leases')]) {
      const metadata = await lstat(directory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Security resource storage must use real directories')
    }
    await this.lock(async () => {
      for (const entry of await readdir(this.root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !entry.name.startsWith('staging-') || !generationPattern.test(entry.name.slice(8))) continue
        const directory = join(this.root, entry.name)
        let owner: unknown
        try { owner = JSON.parse(await readFile(join(directory, 'owner.json'), 'utf8')) } catch { continue /* Unknown owners are retained. */ }
        if (owner && typeof owner === 'object' && 'pid' in owner && dead(owner.pid)) await rm(directory, { recursive: true, force: true })
      }
      for (const entry of await readdir(join(this.root, 'generations'))) {
        if (generationPattern.test(entry)) await this.collectLocked(entry as SecuritySkillGenerationId).catch(this.onCleanupError)
      }
    })
  }

  /** Serialize a pointer or lease mutation across Hosts.
   * @param operation - Filesystem-only critical section; network work stays outside.
   * @returns The critical section result.
   */
  lock<T>(operation: () => Promise<T>): Promise<T> { return withFileLock(join(this.root, 'active.json'), operation) }

  /** Compare the publication revision before atomically publishing a replacement or removal.
   * @param next - Complete next installation, or explicit removal.
   * @param expectedRevision - Revision observed when the Host operation began; empty tombstones retain their revision.
   * @param signal - Host transaction cancellation checked before publication.
   * @param prepare - Optional filesystem preparation performed under the writer lock after comparison; must not acquire this lock.
   * @returns Whether the pointer was replaced, false if another Host changed it.
   */
  async commit(next: SecuritySkillResourceInstallation | undefined,
    expectedRevision: number, signal: AbortSignal, prepare?: () => Promise<void>): Promise<boolean> {
    return this.lock(async () => {
      const current = await this.readState()
      if (current.revision !== expectedRevision) return false
      if (current.revision === Number.MAX_SAFE_INTEGER) throw new Error('Security resource revision exhausted')
      signal.throwIfAborted()
      await prepare?.()
      signal.throwIfAborted()
      await writeFileAtomic(join(this.root, 'active.json'),
        JSON.stringify({ schemaVersion: 1, revision: current.revision + 1, installed: next ?? null }) + '\n', { mode: 0o600 })
      if (current.installed !== undefined) await this.collectLocked(current.installed.generation).catch(this.onCleanupError)
      return true
    })
  }

  /** Pin the current generation under the same lock used by publication and collection.
   * @returns Installation and an idempotent asynchronous release, or undefined when uninstalled.
   */
  async acquire(): Promise<{ installation: SecuritySkillResourceInstallation; release(): Promise<void> } | undefined> {
    return (await this.acquireState()).lease
  }

  /** Observe a revision and pin its installation in one writer-lock critical section.
   * @returns The observed revision and optional lease; an empty state still includes its durable revision.
   */
  async acquireState(): Promise<{
    revision: number
    lease?: { installation: SecuritySkillResourceInstallation; release(): Promise<void> }
  }> {
    return this.lock(async () => {
      const { revision, installed: installation } = await this.readState()
      if (installation === undefined) return { revision }
      const directory = join(this.root, 'leases', installation.generation)
      await mkdir(directory, { recursive: true })
      const metadata = await lstat(directory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Security generation lease storage must be a real directory')
      const file = join(directory, randomUUID() + '.json')
      await writeFile(file, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 })
      let released: Promise<void> | undefined
      return { revision, lease: { installation, release: () => (released ??= this.lock(async () => {
        await unlink(file)
        await this.collectLocked(installation.generation).catch(this.onCleanupError)
      })) } }
    })
  }

  private async collectLocked(id: SecuritySkillGenerationId): Promise<void> {
    if ((await this.read())?.generation === id) return
    const directory = join(this.root, 'leases', id)
    let entries: string[]
    try {
      const metadata = await lstat(directory)
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) return
      entries = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      entries = []
    }
    for (const entry of entries) {
      const file = join(directory, entry)
      let owner: unknown
      try { owner = JSON.parse(await readFile(file, 'utf8')) } catch { return /* Unknown lease owners prevent deletion. */ }
      if (!owner || typeof owner !== 'object' || !('pid' in owner) || !dead(owner.pid)) return
      await unlink(file)
    }
    const generation = join(this.root, 'generations', id)
    let metadata
    try { metadata = await lstat(generation) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (metadata.isSymbolicLink()) await unlink(generation)
    else if (metadata.isDirectory()) await rm(generation, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}
