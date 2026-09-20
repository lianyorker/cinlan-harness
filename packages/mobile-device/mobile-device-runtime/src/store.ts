/** Immutable mobile resource generations, verified inventories, and cross-Host executable leases. */
import { createReadStream } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, parse, relative, resolve, sep } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { MobileDeviceError } from '@deepseek-ai/dsh-mobile-device'
import type { MobileExecutableLease, MobileResourceDefinition, MobileResourceRevision, MobileResourceStatus } from './types.ts'

interface Installed { generation: string; version: string; executable: string; files: Record<string, string> }
interface State { schemaVersion: 1; revision: MobileResourceRevision; installed: Installed | null }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const owned = /^(?:generation|trash)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const initialRevision = 'missing' as MobileResourceRevision
function failure(code = 'MOBILE_RESOURCE_INVALID'): MobileDeviceError {
  return new MobileDeviceError('Managed mobile resource storage is invalid or unavailable.', code)
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function safeRelative(path: string): boolean {
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..'
    && !/[<>:"\|?*\u0000-\u001f\u007f]/.test(part) && !part.includes('\\') && !/[. ]$/.test(part)
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part))
}
async function directory(path: string, create: boolean): Promise<void> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component)
    if (create) {
      try { await mkdir(current, { mode: 0o700 }) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    const stat = await lstat(current)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure()
  }
}
async function inventory(root: string, signal: AbortSignal): Promise<Record<string, string>> {
  await directory(root, false)
  const files: Record<string, string> = Object.create(null) as Record<string, string>
  const seen = new Set<string>()
  const visit = async (parent: string, prefix: string): Promise<void> => {
    for (const name of (await readdir(parent)).sort()) {
      signal.throwIfAborted()
      const path = prefix ? prefix + '/' + name : name
      if (!safeRelative(path)) throw failure()
      const folded = path.normalize('NFC').toLowerCase()
      if (seen.has(folded)) throw failure()
      seen.add(folded)
      const full = join(parent, name)
      const stat = await lstat(full)
      if (stat.isSymbolicLink()) throw failure()
      if (stat.isDirectory()) await visit(full, path)
      else {
        if (!stat.isFile() || stat.nlink !== 1) throw failure()
        const hash = createHash('sha256')
        for await (const chunk of createReadStream(full, { signal })) hash.update(chunk as Buffer)
        files[path] = hash.digest('hex')
      }
    }
  }
  await visit(root, '')
  return files
}
async function erase(path: string): Promise<void> {
  let stat
  try { stat = await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) { await unlink(path); return }
  for (const name of await readdir(path)) await erase(join(path, name))
  await rmdir(path)
}

/** Persist resource revisions and leases under one writer lock per fixed resource id. */
export class MobileResourceStore {
  private readonly root: string
  /** @param root - Private application-owned resource root; every path component must be a real directory.
   * @param lockWaitMs - Positive maximum cross-Host writer lock wait; orphan locks are never stolen.
   */
  constructor(root: string, private readonly lockWaitMs: number) {
    if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 1) throw failure()
    this.root = resolve(root)
  }
  private resource(def: MobileResourceDefinition): string {
    if (!safeRelative(def.executable)) throw failure()
    const directories = { 'platform-tools': 'platform-tools', scrcpy: 'scrcpy' } as const
    return join(this.root, directories[def.id])
  }
  private async locked<T>(def: MobileResourceDefinition, signal: AbortSignal, action: (base: string) => Promise<T>): Promise<T> {
    signal.throwIfAborted()
    const base = this.resource(def)
    await directory(base, true)
    return withFileLock(join(base, 'active.json'), async () => {
      signal.throwIfAborted()
      await directory(base, false)
      return action(base)
    }, { waitMs: this.lockWaitMs })
  }
  private async state(base: string): Promise<State> {
    const file = join(base, 'active.json')
    let text: string
    try {
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw failure()
      text = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, revision: initialRevision, installed: null }
      throw error
    }
    let value: unknown
    try { value = JSON.parse(text) } catch { throw failure() }
    if (!record(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string' || !uuid.test(value.revision)) throw failure()
    const revision = value.revision as MobileResourceRevision
    if (value.installed === null) return { schemaVersion: 1, revision, installed: null }
    const installed = value.installed
    if (!record(installed) || typeof installed.generation !== 'string' || !installed.generation.startsWith('generation-')
      || !uuid.test(installed.generation.slice(11)) || typeof installed.version !== 'string' || installed.version.length === 0
      || typeof installed.executable !== 'string' || !safeRelative(installed.executable) || !record(installed.files)) throw failure()
    const files: Record<string, string> = Object.create(null) as Record<string, string>
    for (const [path, hash] of Object.entries(installed.files)) {
      if (!safeRelative(path) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw failure()
      files[path] = hash
    }
    if (!Object.hasOwn(files, installed.executable)) throw failure()
    return { schemaVersion: 1, revision, installed: { generation: installed.generation, version: installed.version,
      executable: installed.executable, files } }
  }
  private async leased(base: string): Promise<boolean> {
    const leases = join(base, 'leases')
    await directory(leases, true)
    return (await readdir(leases)).length !== 0
  }
  private async verify(base: string, installed: Installed, signal: AbortSignal): Promise<boolean> {
    try {
      const actual = await inventory(join(base, installed.generation), signal)
      return Object.keys(actual).length === Object.keys(installed.files).length
        && Object.entries(actual).every(([path, hash]) => installed.files[path] === hash)
    } catch (_invalidGeneration) { signal.throwIfAborted(); return false }
  }
  /** Inspect the committed revision and rehash every installed file without launching an executable.
   * @param def - Fixed reviewed resource metadata.
   * @param signal - Inspection cancellation, checked while hashing and after lock acquisition.
   * @returns Installation integrity and persisted lease presence from one serialized read.
   */
  async inspect(def: MobileResourceDefinition, signal: AbortSignal): Promise<MobileResourceStatus> {
    return this.locked(def, signal, async (base) => {
      const state = await this.state(base)
      const installed = state.installed
      const valid = installed !== null && await this.verify(base, installed, signal)
      return { definition: def, supported: process.platform === 'win32' && process.arch === 'x64', revision: state.revision,
        installedVersion: installed?.version ?? null,
        installedPath: installed !== null && valid ? join(base, installed.generation, installed.executable) : null,
        integrity: installed === null ? 'missing' : valid ? 'verified' : 'invalid', leased: await this.leased(base),
        updateAvailable: installed !== null && installed.version !== def.version }
    })
  }
  /** Verify and pin one committed executable across Hosts until the native process and cleanup settle.
   * @param def - Fixed resource to lease.
   * @param signal - Cancellation before lease publication.
   * @returns Executable path and idempotent asynchronous release; crashed owners retain a blocking lease.
   */
  async acquire(def: MobileResourceDefinition, signal: AbortSignal): Promise<MobileExecutableLease> {
    return this.locked(def, signal, async (base) => {
      const installed = (await this.state(base)).installed
      if (installed === null || !await this.verify(base, installed, signal)) throw failure()
      await this.leased(base)
      signal.throwIfAborted()
      const file = join(base, 'leases', randomUUID() + '.json')
      await writeFile(file, JSON.stringify({ pid: process.pid, generation: installed.generation }) + '\n', { flag: 'wx', mode: 0o600 })
      let release: Promise<void> | undefined
      return { executable: join(base, installed.generation, installed.executable), release: () => release ??= this.locked(def,
        new AbortController().signal, async () => { await directory(dirname(file), false); await unlink(file) }) }
    })
  }
  /** Allocate a fresh empty directory for caller-verified archive extraction.
   * @param def - Fixed resource whose staging root owns the directory.
   * @param signal - Cancellation checked before allocation.
   * @returns Private staging path accepted by commit and cleanup.
   */
  async stage(def: MobileResourceDefinition, signal: AbortSignal): Promise<string> {
    return this.locked(def, signal, base => mkdtemp(join(base, 'stage-')))
  }
  private staging(path: string, base?: string): string {
    const full = resolve(path)
    const parent = dirname(full)
    if (!/^stage-[a-zA-Z0-9]+$/.test(basename(full)) || dirname(parent) !== this.root
      || !['platform-tools', 'scrcpy'].includes(basename(parent)) || (base !== undefined && parent !== base)) throw failure()
    return full
  }
  /** Publish a hashed immutable generation only if the displayed revision still matches and no lease exists.
   * @param def - Reviewed version and required executable.
   * @param staging - Fresh extracted staging directory returned by stage.
   * @param expectedRevision - Exact revision observed before installation.
   * @param signal - Cancellation before atomic pointer publication.
   * @returns Completion after the pointer commits; prior generations remain immutable until removal.
   */
  async commit(def: MobileResourceDefinition, staging: string, expectedRevision: MobileResourceRevision,
    signal: AbortSignal): Promise<void> {
    await this.locked(def, signal, async (base) => {
      if ((await this.state(base)).revision !== expectedRevision) throw failure('MOBILE_RESOURCE_CONFLICT')
      if (await this.leased(base)) throw failure('MOBILE_RESOURCE_LEASED')
      const stage = this.staging(staging, base)
      const files = await inventory(stage, signal)
      if (!Object.hasOwn(files, def.executable)) throw failure()
      const generation = 'generation-' + randomUUID()
      const target = join(base, generation)
      signal.throwIfAborted()
      await rename(stage, target)
      try {
        signal.throwIfAborted()
        await writeFileAtomic(join(base, 'active.json'), JSON.stringify({ schemaVersion: 1, revision: randomUUID(),
          installed: { generation, version: def.version, executable: def.executable, files } }) + '\n', { mode: 0o600 })
      } catch (error) { await rename(target, stage); throw error }
    })
  }
  /** Retire managed generations and publish a revision-preserving tombstone, refusing active leases.
   * @param def - Fixed resource to remove.
   * @param expectedRevision - Exact revision confirmed by the user.
   * @param signal - Cancellation checked before pointer publication.
   * @returns Completion only after retired bytes are deleted; cleanup failures reject after the tombstone is published.
   */
  async remove(def: MobileResourceDefinition, expectedRevision: MobileResourceRevision, signal: AbortSignal): Promise<void> {
    await this.locked(def, signal, async (base) => {
      if ((await this.state(base)).revision !== expectedRevision) throw failure('MOBILE_RESOURCE_CONFLICT')
      if (await this.leased(base)) throw failure('MOBILE_RESOURCE_LEASED')
      const moved: { from: string; to: string }[] = []
      try {
        for (const name of await readdir(base)) {
          signal.throwIfAborted()
          if (!owned.test(name) || !name.startsWith('generation-')) continue
          const from = join(base, name)
          const stat = await lstat(from)
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure()
          const to = join(base, 'trash-' + randomUUID())
          await rename(from, to)
          moved.push({ from, to })
        }
        signal.throwIfAborted()
        await writeFileAtomic(join(base, 'active.json'), JSON.stringify({ schemaVersion: 1, revision: randomUUID(), installed: null }) + '\n', { mode: 0o600 })
      } catch (error) {
        for (const item of moved.reverse()) await rename(item.to, item.from)
        throw error
      }
      try {
        for (const name of await readdir(base)) if (owned.test(name) && name.startsWith('trash-')) await erase(join(base, name))
      } catch { throw failure('MOBILE_RESOURCE_CLEANUP_FAILED') }
    })
  }
  /** Delete only an owned staging directory without following nested links.
   * @param staging - Exact stage path; generation and arbitrary paths are rejected.
   * @returns Completion after recursive deletion; failures retain their error.
   */
  async cleanup(staging: string): Promise<void> {
    const path = this.staging(staging)
    await directory(dirname(path), false)
    await erase(path)
  }
}
