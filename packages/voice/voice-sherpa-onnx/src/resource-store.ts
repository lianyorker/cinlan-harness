/** Immutable voice generations, atomic revision publication, and cross-process reader leases. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { VoiceModelDefinition, VoiceModelResource } from '@deepseek-ai/dsh-voice'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const versionPattern = /^sha256:[0-9a-f]{64}$/
const manifestName = '.dsh-voice-inventory.json'

/** Caller-resolved lock policy; existing locks are never removed by a contender. */
export interface ResourceStoreOptions {
  /** Maximum time a contender waits for a writer or reader mutation. */
  lockTimeoutMs: number
  /** Delay between exclusive-create attempts. */
  lockRetryMs: number
  /** Report deferred collection failures without changing a published outcome. */
  onCleanupError?: (error: unknown) => void
}

/** Durable installation metadata and verification of required model bytes. */
export interface ResourceInspection extends VoiceModelResource {
  cacheDir?: string
}

type InventoryFile = { path: string; bytes: number; sha256: string }
type Manifest = { schemaVersion: 1; version: string; source: string[]; definition: VoiceModelDefinition; files: InventoryFile[] }
type Pointer = { schemaVersion: 1; revision: string; generation: string | null }

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | null)?.code }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function safePath(path: string): string {
  if (!path || path.includes('\\') || path.includes(':') || path.includes('\0')
    || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe voice resource path: ' + path)
  return path
}
function requiredPaths(definition: VoiceModelDefinition): string[] {
  return Object.entries(definition.architecture)
    .filter(([key]) => key !== 'type' && key !== 'language')
    .map(([, path]) => {
      safePath(path)
      return path.includes('/') ? path.split('/').slice(1).join('/') : path
    }).sort()
}
function sources(definition: VoiceModelDefinition): string[] {
  const urls = definition.download.type === 'archive' ? [definition.download.url] : definition.download.entries.map(entry => entry.url)
  return urls.map((value) => {
    const url = new URL(value)
    url.username = ''; url.password = ''; url.search = ''; url.hash = ''
    return url.href
  })
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
function fingerprint(definition: VoiceModelDefinition): string {
  return 'sha256:' + createHash('sha256').update(canonical({ id: definition.id, kind: definition.kind, download: definition.download, architecture: definition.architecture })).digest('hex')
}
async function realDirectory(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Voice resource directory must not be a link: ' + path)
}
async function removeManagedTree(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink()) { await unlink(path); return }
  for (const entry of await readdir(path)) await removeManagedTree(join(path, entry))
  await rmdir(path)
}
async function regularFile(root: string, path: string): Promise<string> {
  safePath(path)
  await realDirectory(root)
  const parts = path.split('/')
  let directory = root
  for (const part of parts.slice(0, -1)) { directory = join(directory, part); await realDirectory(directory) }
  const file = join(root, ...parts)
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Voice resource must be a regular file without hard links: ' + file)
  return file
}
async function hashFile(root: string, path: string, signal: AbortSignal): Promise<InventoryFile> {
  signal.throwIfAborted()
  const file = await regularFile(root, path)
  const hash = createHash('sha256')
  let bytes = 0
  const stream = createReadStream(file, { signal }) as AsyncIterable<Buffer>
  for await (const chunk of stream) { hash.update(chunk); bytes += chunk.length }
  if (bytes === 0) throw new Error('Empty voice resource file: ' + path)
  return { path, bytes, sha256: hash.digest('hex') }
}
function parseDefinition(value: unknown): VoiceModelDefinition {
  if (!record(value) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value.id)
    || typeof value.name !== 'string' || typeof value.description !== 'string' || typeof value.recommended !== 'boolean'
    || typeof value.approximateBytes !== 'number' || !Number.isFinite(value.approximateBytes) || value.approximateBytes < 0
    || (value.kind !== 'streaming' && value.kind !== 'non-streaming') || !record(value.architecture) || !record(value.download)) throw new Error('Invalid stored voice definition')
  const architecture = value.architecture
  const fields = architecture.type === 'transducer' ? ['encoder', 'decoder', 'joiner', 'tokens']
    : architecture.type === 'paraformer' ? ['encoder', 'decoder', 'tokens']
      : architecture.type === 'whisper' ? ['encoder', 'decoder', 'tokens', 'language']
        : architecture.type === 'sense-voice' ? ['model', 'tokens', 'language'] : undefined
  if (!fields || Object.keys(architecture).some(key => key !== 'type' && !fields.includes(key))
    || fields.some(key => typeof architecture[key] !== 'string')) throw new Error('Invalid stored voice architecture')
  const download = value.download
  if (download.type === 'archive') {
    if (typeof download.url !== 'string' || typeof download.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(download.sha256)) throw new Error('Invalid stored voice archive')
  } else if (download.type === 'files') {
    if (!Array.isArray(download.entries) || !download.entries.length) throw new Error('Invalid stored voice files')
    const names = new Set<string>()
    for (const entry of download.entries) {
      if (!record(entry) || typeof entry.name !== 'string' || typeof entry.url !== 'string' || typeof entry.sha256 !== 'string'
        || !/^[0-9a-f]{64}$/.test(entry.sha256) || typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) throw new Error('Invalid stored voice file')
      safePath(entry.name)
      if (names.has(entry.name)) throw new Error('Duplicate stored voice file')
      names.add(entry.name)
    }
  } else throw new Error('Invalid stored voice download')
  const definition = value as unknown as VoiceModelDefinition
  requiredPaths(definition)
  sources(definition)
  return definition
}
function validateInventory(manifest: Manifest): void {
  const definition = manifest.definition
  if (manifest.version !== fingerprint(definition) || canonical(manifest.source) !== canonical(sources(definition))) throw new Error('Voice inventory differs from its definition')
  const paths = new Set(requiredPaths(definition))
  if (definition.download.type === 'files') {
    const entries = definition.download.entries
    for (const entry of entries) {
      paths.add(entry.name)
      const file = manifest.files.find(file => file.path === entry.name)
      if (!file || file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) throw new Error('Voice inventory differs from source pins')
    }
    if (requiredPaths(definition).some(path => !entries.some(entry => entry.name === path))) throw new Error('Required voice file has no source pin')
  }
  if (manifest.files.length !== paths.size || manifest.files.some(file => !paths.has(file.path))) throw new Error('Voice inventory differs from required files')
}
function parseManifest(value: unknown): Manifest {
  if (!record(value) || value.schemaVersion !== 1 || typeof value.version !== 'string' || !versionPattern.test(value.version)
    || !Array.isArray(value.source) || !value.source.every(url => typeof url === 'string') || !Array.isArray(value.files) || !value.files.length) throw new Error('Invalid voice resource inventory')
  const paths = new Set<string>()
  const files = value.files.map((file: unknown): InventoryFile => {
    if (!record(file) || typeof file.path !== 'string' || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes <= 0
      || typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error('Invalid voice inventory file')
    safePath(file.path)
    if (paths.has(file.path)) throw new Error('Duplicate voice inventory file')
    paths.add(file.path)
    return { path: file.path, bytes: file.bytes, sha256: file.sha256 }
  })
  const manifest: Manifest = {
    schemaVersion: 1, version: value.version, source: value.source, definition: parseDefinition(value.definition), files,
  }
  validateInventory(manifest)
  return manifest
}

/** The requested installation cannot supply verified recognizer bytes. */
export class VoiceResourceNotReadyError extends Error {}

/** One explicit cache root; committed paths remain valid until their readers release. */
export class VoiceResourceStore {
  /** Absolute storage root captured for this store lifetime. */
  readonly root: string
  private readonly options: ResourceStoreOptions

  constructor(root: string, options: ResourceStoreOptions) {
    if (![options.lockTimeoutMs, options.lockRetryMs].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Voice lock durations must be positive integer milliseconds')
    this.root = resolve(root)
    this.options = options
  }

  /** Derive a version from source pins and recognizer configuration, excluding display text.
   * @param definition - Model catalog entry.
   * @returns Stable SHA-256 version identifier.
   */
  manifestFingerprint(definition: VoiceModelDefinition): string { return fingerprint(definition) }

  /** Verify committed bytes; pinned legacy file models are copied into managed storage.
   * @param definition - Current model catalog entry.
   * @param signal - Cancellation before publication or while hashing.
   * @returns Revision, provenance, versions, and integrity; archive legacy directories stay unverified.
   */
  async inspect(definition: VoiceModelDefinition, signal: AbortSignal): Promise<ResourceInspection> {
    return this.lock(definition, signal, async directory => this.inspectLocked(definition, directory, signal))
  }

  /** Hash required extracted bytes after the downloader verifies the pinned transport.
   * Archive callers must supply fresh, privately owned extraction, never a legacy cache.
   * @param definition - Model whose file pins and architecture must match.
   * @param stagingDir - Private staging directory, consumed only by a successful commit.
   * @param signal - Cancels hashing and preparation.
   */
  async prepare(definition: VoiceModelDefinition, stagingDir: string, signal: AbortSignal): Promise<void> {
    this.assertStaging(definition, stagingDir)
    const paths = new Set(requiredPaths(definition))
    if (definition.download.type === 'files') for (const entry of definition.download.entries) paths.add(safePath(entry.name))
    const files: InventoryFile[] = []
    for (const path of [...paths].sort()) files.push(await hashFile(stagingDir, path, signal))
    const manifest: Manifest = { schemaVersion: 1, version: fingerprint(definition), source: sources(definition), definition, files }
    validateInventory(manifest)
    signal.throwIfAborted()
    await writeFileAtomic(join(stagingDir, manifestName), JSON.stringify(manifest), { mode: 0o600 })
  }

  /** Publish a prepared generation only if the observed revision still matches.
   * Rename occurs under the commit lock. Once pointer replacement starts, commit wins cancellation.
   * @param definition - Model catalog entry used to prepare staging.
   * @param stagingDir - Privately owned prepared directory; preserved on revision conflict.
   * @param expectedRevision - Inspection revision, including removal tombstones.
   * @param signal - Cancels validation or waiting before pointer replacement.
   * @returns False for a revision conflict, true after atomic publication.
   */
  async commit(definition: VoiceModelDefinition, stagingDir: string, expectedRevision: string, signal: AbortSignal): Promise<boolean> {
    this.assertStaging(definition, stagingDir)
    const manifest = await this.manifest(stagingDir)
    if (manifest.version !== fingerprint(definition)) throw new Error('Prepared voice manifest differs from the model definition')
    return this.lock(definition, signal, async (directory) => {
      const current = await this.pointer(directory)
      if (current.revision !== expectedRevision) return false
      if (canonical(await this.verify(stagingDir, signal)) !== canonical(manifest)) throw new Error('Prepared voice manifest changed before commit')
      signal.throwIfAborted()
      const generation = randomUUID()
      await rename(stagingDir, join(directory, 'generations', generation))
      signal.throwIfAborted()
      await this.publish(directory, generation)
      await this.collect(directory, generation)
      return true
    })
  }

  /** Persist a fresh removal revision and collect only managed, unleased generations.
   * @param definition - Model to remove; its legacy directory is never deleted.
   * @param expectedRevision - Revision observed at admission.
   * @param signal - Cancellation before atomic pointer replacement.
   * @returns False if a competing operation changed the revision; true after removal publication.
   */
  async remove(definition: VoiceModelDefinition, expectedRevision: string, signal: AbortSignal): Promise<boolean> {
    return this.lock(definition, signal, async (directory) => {
      if ((await this.pointer(directory)).revision !== expectedRevision) return false
      signal.throwIfAborted()
      await this.publish(directory, null)
      await this.collect(directory, null)
      return true
    })
  }

  /** Pin verified bytes until recognizer disposal; unverified or corrupt resources reject.
   * @param definition - Current catalog entry identifying the model to load.
   * @param signal - Cancellation during verification and lease acquisition.
   * @returns Immutable directory, installed definition, and idempotent release independent of cancellation.
   */
  async acquire(definition: VoiceModelDefinition, signal: AbortSignal): Promise<{
    cacheDir: string
    definition: VoiceModelDefinition
    release(): Promise<void>
  }> {
    return this.lock(definition, signal, async (directory) => {
      const inspection = await this.inspectLocked(definition, directory, signal)
      if (inspection.integrity !== 'verified' || !inspection.cacheDir) throw new VoiceResourceNotReadyError('Voice resource is not verified: ' + inspection.integrity)
      const current = await this.pointer(directory)
      if (!current.generation) throw new Error('Voice resource has no managed generation')
      const installed = await this.manifest(inspection.cacheDir)
      signal.throwIfAborted()
      const leaseDir = join(directory, 'leases', current.generation)
      await mkdir(leaseDir, { recursive: true })
      await realDirectory(leaseDir)
      const lease = join(leaseDir, randomUUID() + '.json')
      await writeFile(lease, JSON.stringify({ pid: process.pid, hostname: hostname() }), { flag: 'wx', mode: 0o600 })
      let released: Promise<void> | undefined
      let unlinked = false
      return { cacheDir: inspection.cacheDir, definition: installed.definition, release: () => {
        released ??= this.lock(definition, new AbortController().signal, async (root) => {
          if (!unlinked) { await unlink(lease); unlinked = true }
          await this.collect(root, (await this.pointer(root)).generation)
        }).catch((error: unknown) => { released = undefined; throw error })
        return released
      } }
    })
  }

  private directory(definition: VoiceModelDefinition): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(definition.id)) throw new Error('Unsafe voice model identifier')
    return join(this.root, '.resources', definition.id)
  }

  private assertStaging(definition: VoiceModelDefinition, stagingDir: string): void {
    const stage = resolve(stagingDir)
    const managed = this.directory(definition)
    for (const protectedDir of [this.root, join(this.root, definition.id), managed, join(managed, 'generations'), join(managed, 'leases')]) {
      const path = relative(stage, protectedDir)
      if (!path || (!path.startsWith('..') && !isAbsolute(path))) throw new Error('Voice staging overlaps protected storage')
    }
    for (const protectedDir of [join(this.root, definition.id), join(managed, 'generations'), join(managed, 'leases')]) {
      const path = relative(protectedDir, stage)
      if (!path.startsWith('..') && !isAbsolute(path)) throw new Error('Voice staging is inside protected storage')
    }
  }

  private async lock<T>(definition: VoiceModelDefinition, signal: AbortSignal, operation: (directory: string) => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const directory = this.directory(definition)
    await mkdir(this.root, { recursive: true })
    await realDirectory(this.root)
    for (const path of [join(this.root, '.resources'), directory, join(directory, 'generations'), join(directory, 'leases')]) {
      await mkdir(path, { recursive: true })
      await realDirectory(path)
    }
    const lock = join(directory, 'pointer.json.lock')
    const deadline = Date.now() + this.options.lockTimeoutMs
    for (;;) {
      signal.throwIfAborted()
      try { await writeFile(lock, JSON.stringify({ pid: process.pid, hostname: hostname() }), { flag: 'wx', mode: 0o600 }); break } catch (error) {
        if (code(error) !== 'EEXIST') {
          if (code(error) !== 'EPERM') throw error
          try { await lstat(lock) } catch { throw error /* Only an existing Windows lock counts as contention. */ }
        }
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for voice resource lock: ' + lock)
      await delay(Math.min(this.options.lockRetryMs, Math.max(1, deadline - Date.now())), undefined, { signal })
    }
    try { signal.throwIfAborted(); return await operation(directory) } finally { await unlink(lock) }
  }

  private async pointer(directory: string): Promise<Pointer> {
    let value: unknown
    try { value = JSON.parse(await readFile(await regularFile(directory, 'pointer.json'), 'utf8')) } catch (error) {
      if (code(error) === 'ENOENT') return { schemaVersion: 1, revision: '0', generation: null }
      throw error
    }
    if (!record(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string' || !uuid.test(value.revision)
      || (value.generation !== null && (typeof value.generation !== 'string' || !uuid.test(value.generation)))) throw new Error('Invalid voice resource pointer')
    return { schemaVersion: 1, revision: value.revision, generation: value.generation }
  }

  private async publish(directory: string, generation: string | null): Promise<string> {
    const revision = randomUUID()
    await writeFileAtomic(join(directory, 'pointer.json'), JSON.stringify({ schemaVersion: 1, revision, generation }), { mode: 0o600 })
    return revision
  }

  private async manifest(directory: string): Promise<Manifest> {
    return parseManifest(JSON.parse(await readFile(await regularFile(directory, manifestName), 'utf8')))
  }

  private async verify(directory: string, signal: AbortSignal): Promise<Manifest> {
    const manifest = await this.manifest(directory)
    for (const file of manifest.files) {
      const actual = await hashFile(directory, file.path, signal)
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) throw new Error('Voice resource checksum mismatch: ' + file.path)
    }
    return manifest
  }

  private async inspectLocked(definition: VoiceModelDefinition, directory: string, signal: AbortSignal): Promise<ResourceInspection> {
    const current = await this.pointer(directory)
    const availableVersion = fingerprint(definition)
    let result: ResourceInspection = { revision: current.revision, source: sources(definition), installedVersion: null, availableVersion, updateAvailable: false, integrity: 'missing' }
    if (current.generation) {
      const cacheDir = join(directory, 'generations', current.generation)
      try {
        const manifest = await this.manifest(cacheDir)
        if (manifest.definition.id !== definition.id) throw new Error('Voice generation belongs to another model')
        result = {
          ...result, source: manifest.source, installedVersion: manifest.version, updateAvailable: manifest.version !== availableVersion,
        }
        await this.verify(cacheDir, signal)
        return { ...result, cacheDir, integrity: 'verified' }
      } catch (error) {
        signal.throwIfAborted()
        if (code(error) === 'EACCES' || code(error) === 'EPERM') throw error
        return { ...result, integrity: 'corrupt' }
      }
    }
    if (current.revision !== '0') return result
    const legacy = join(this.root, definition.id)
    try { await realDirectory(legacy) } catch (error) {
      if (code(error) === 'ENOENT') return result
      return { ...result, integrity: 'unverified' }
    }
    if (definition.download.type === 'archive') return { ...result, integrity: 'unverified' }
    const stage = join(directory, 'staging-' + randomUUID())
    await mkdir(stage)
    let prepared = false
    try {
      for (const entry of definition.download.entries) {
        signal.throwIfAborted()
        const source = await regularFile(legacy, entry.name)
        const target = join(stage, ...entry.name.split('/'))
        await mkdir(dirname(target), { recursive: true })
        await copyFile(source, target)
      }
      await this.prepare(definition, stage, signal)
      prepared = true
      signal.throwIfAborted()
      const generation = randomUUID()
      await rename(stage, join(directory, 'generations', generation))
      signal.throwIfAborted()
      const revision = await this.publish(directory, generation)
      return { ...result, revision, cacheDir: join(directory, 'generations', generation), installedVersion: availableVersion, integrity: 'verified' }
    } catch (error) {
      signal.throwIfAborted()
      if (prepared || (code(error) !== undefined && code(error) !== 'ENOENT')) throw error
      return { ...result, integrity: 'corrupt' }
    } finally { await rm(stage, { recursive: true, force: true }) }
  }

  private async collect(directory: string, active: string | null): Promise<void> {
    try {
      for (const generation of await readdir(join(directory, 'generations'))) {
        if (!uuid.test(generation) || generation === active) continue
        const leases = join(directory, 'leases', generation)
        let entries: string[]
        try { await realDirectory(leases); entries = await readdir(leases) } catch (error) {
          if (code(error) !== 'ENOENT') continue
          entries = []
        }
        let retained = false
        for (const entry of entries) {
          let owner: unknown
          try { owner = JSON.parse(await readFile(await regularFile(leases, entry), 'utf8')) } catch { retained = true; break /* Unknown owners retain bytes. */ }
          if (!record(owner) || owner.hostname !== hostname() || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) { retained = true; break }
          let dead = false
          try { process.kill(owner.pid, 0) } catch (error) { dead = code(error) === 'ESRCH' }
          if (!dead) { retained = true; break }
          await unlink(join(leases, entry))
        }
        if (retained) continue
        const target = join(directory, 'generations', generation)
        await removeManagedTree(target)
        try { await rmdir(leases) } catch (error) { if (code(error) !== 'ENOENT') throw error }
      }
    } catch (error) {
      // Publication remains authoritative when deferred collection encounters filesystem contention.
      try { this.options.onCleanupError?.(error) } catch { /* Diagnostic callbacks cannot undo publication. */ }
    }
  }
}
