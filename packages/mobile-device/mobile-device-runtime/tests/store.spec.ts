/** Real filesystem resource generations with independent stores sharing one Host root. */
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileResourceStore } from '../src/store.ts'
import { catalog } from '../src/catalog.ts'
import type { MobileResourceDefinition } from '../src/types.ts'

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) }
})
const roots: string[] = []
afterEach(async () => {
  vi.mocked(rename).mockClear(); vi.mocked(unlink).mockClear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const signal = () => new AbortController().signal
const def = catalog['platform-tools']
async function bench() {
  const parent = await mkdtemp(join(tmpdir(), 'dsh-mobile-store-'))
  roots.push(parent)
  const root = join(parent, 'managed')
  return { parent, root, store: new MobileResourceStore(root, 100) }
}
async function stage(store: MobileResourceStore, resource = def, contents = 'executable') {
  const staging = await store.stage(resource, signal())
  await writeFile(join(staging, resource.executable), contents)
  await mkdir(join(staging, 'lib'))
  await writeFile(join(staging, 'lib', 'support.dll'), 'library')
  return staging
}
async function install(store: MobileResourceStore, resource = def) {
  const before = await store.inspect(resource, signal())
  const staging = await stage(store, resource)
  await store.commit(resource, staging, before.revision, signal())
  return store.inspect(resource, signal())
}

describe('Managed mobile resource store', () => {
  it('publishes full SHA256 inventory and verifies every file before returning an executable lease', async () => {
    const b = await bench()
    const initial = await b.store.inspect(def, signal())
    expect(initial).toMatchObject({ integrity: 'missing', leased: false, installedPath: null, installedVersion: null })
    const committed = await install(b.store)
    expect(committed).toMatchObject({ integrity: 'verified', installedVersion: def.version, updateAvailable: false })
    expect(committed.revision).not.toBe(initial.revision)
    const raw = JSON.parse(await readFile(join(b.root, def.id, 'active.json'), 'utf8')) as {
      installed: { files: Record<string, string> }
    }
    expect(raw.installed.files).toEqual({
      'adb.exe': createHash('sha256').update('executable').digest('hex'),
      'lib/support.dll': createHash('sha256').update('library').digest('hex'),
    })
    const lease = await b.store.acquire(def, signal())
    expect(lease.executable).toBe(committed.installedPath)
    expect((await b.store.inspect(def, signal())).leased).toBe(true)
    await Promise.all([lease.release(), lease.release()])
    expect((await b.store.inspect(def, signal())).leased).toBe(false)
  })

  it('makes cross-Host lease files block replacement and removal until all holders release', async () => {
    const b = await bench()
    const current = await install(b.store)
    const other = new MobileResourceStore(b.root, 100)
    const one = await b.store.acquire(def, signal())
    const two = await other.acquire(def, signal())
    const staging = await stage(other)
    await expect(other.commit(def, staging, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_LEASED' })
    await expect(other.remove(def, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_LEASED' })
    await one.release()
    expect((await other.inspect(def, signal())).leased).toBe(true)
    await two.release()
    await other.commit(def, staging, current.revision, signal())
    expect((await other.inspect(def, signal())).revision).not.toBe(current.revision)
  })

  it('permits one concurrent compare-and-swap publisher and retains immutable old generations', async () => {
    const b = await bench()
    const current = await install(b.store)
    const other = new MobileResourceStore(b.root, 1000)
    const first = await stage(b.store, def, 'first')
    const second = await stage(other, def, 'second')
    const results = await Promise.allSettled([
      b.store.commit(def, first, current.revision, signal()), other.commit(def, second, current.revision, signal()),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await readFile(current.installedPath!, 'utf8')).toBe('executable')
    expect((await b.store.inspect(def, signal())).integrity).toBe('verified')
    await b.store.cleanup(first); await other.cleanup(second)
  })

  it.each(['modified', 'missing', 'extra', 'linked'] as const)('reports %s generation contents invalid and refuses acquire', async (kind) => {
    const b = await bench()
    const current = await install(b.store)
    const directory = dirname(current.installedPath!)
    if (kind === 'modified') await writeFile(join(directory, 'lib', 'support.dll'), 'tampered')
    if (kind === 'missing') await unlink(join(directory, 'lib', 'support.dll'))
    if (kind === 'extra') await writeFile(join(directory, 'unexpected.dll'), 'extra')
    if (kind === 'linked') {
      await unlink(join(directory, 'lib', 'support.dll'))
      const outside = join(b.parent, 'outside')
      await mkdir(outside)
      await symlink(outside, join(directory, 'lib', 'support.dll'), process.platform === 'win32' ? 'junction' : 'dir')
    }
    expect(await b.store.inspect(def, signal())).toMatchObject({ integrity: 'invalid', installedPath: null, revision: current.revision })
    await expect(b.store.acquire(def, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
  })

  it('rejects missing executables and hardlinked extracted files before commit', async () => {
    const b = await bench()
    const current = await b.store.inspect(def, signal())
    const empty = await b.store.stage(def, signal())
    await expect(b.store.commit(def, empty, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    const linked = await stage(b.store)
    const outside = join(b.parent, 'outside-executable')
    await writeFile(outside, 'external')
    await unlink(join(linked, def.executable))
    await link(outside, join(linked, def.executable))
    await expect(b.store.commit(def, linked, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    expect(await readFile(outside, 'utf8')).toBe('external')
    await b.store.cleanup(linked); await b.store.cleanup(empty)
  })

  it('retains tombstone revisions and removes all generations without touching profiles or other resources', async () => {
    const b = await bench()
    const initial = await b.store.inspect(def, signal())
    const first = await install(b.store)
    const next: MobileResourceDefinition = { ...def, version: 'next-reviewed-version' }
    expect((await b.store.inspect(next, signal())).updateAvailable).toBe(true)
    await b.store.commit(next, await stage(b.store, next), first.revision, signal())
    const current = await b.store.inspect(next, signal())
    await mkdir(join(b.root, def.id, 'profiles'))
    await writeFile(join(b.root, def.id, 'profiles', 'user-data'), 'preserve')
    await install(b.store, catalog.scrcpy)
    await b.store.remove(next, current.revision, signal())
    const missing = await b.store.inspect(next, signal())
    expect(missing).toMatchObject({ integrity: 'missing', installedPath: null, installedVersion: null })
    expect(missing.revision).not.toBe(current.revision)
    expect(missing.revision).not.toBe(initial.revision)
    expect(await readFile(join(b.root, def.id, 'profiles', 'user-data'), 'utf8')).toBe('preserve')
    expect((await b.store.inspect(catalog.scrcpy, signal())).integrity).toBe('verified')
    expect((await readdir(join(b.root, def.id))).filter(name => /^(generation|trash)-/.test(name))).toEqual([])
    await expect(b.store.commit(def, await stage(b.store), initial.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_CONFLICT' })
  })

  it('rolls back generation retirement when Windows loaded-file rename fails', async () => {
    const b = await bench()
    const current = await install(b.store)
    const staging = await stage(b.store, def, 'replacement')
    await b.store.commit(def, staging, current.revision, signal())
    const active = await b.store.inspect(def, signal())
    const original = vi.mocked(rename).getMockImplementation()!
    vi.mocked(rename).mockImplementationOnce(original)
    vi.mocked(rename).mockImplementationOnce(async () => { throw Object.assign(new Error('loaded executable'), { code: 'EPERM' }) })
    await expect(b.store.remove(def, active.revision, signal())).rejects.toMatchObject({ code: 'EPERM' })
    expect(await b.store.inspect(def, signal())).toMatchObject({ integrity: 'verified', revision: active.revision })
    expect(await readFile(active.installedPath!, 'utf8')).toBe('replacement')
    expect(await readFile(current.installedPath!, 'utf8')).toBe('executable')
  })

  it('reports trash deletion failures truthfully and retries cleanup using the tombstone revision', async () => {
    const b = await bench()
    const current = await install(b.store)
    const original = vi.mocked(unlink).getMockImplementation()!
    vi.mocked(unlink).mockImplementationOnce(async () => { throw Object.assign(new Error('loaded DLL'), { code: 'EPERM' }) })
    await expect(b.store.remove(def, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_CLEANUP_FAILED' })
    vi.mocked(unlink).mockImplementation(original)
    const missing = await b.store.inspect(def, signal())
    expect(missing.integrity).toBe('missing')
    expect((await readdir(join(b.root, def.id))).some(name => name.startsWith('trash-'))).toBe(true)
    await b.store.remove(def, missing.revision, signal())
    expect((await readdir(join(b.root, def.id))).some(name => name.startsWith('trash-'))).toBe(false)
  })

  it('refuses symlinked root and pointer components and never follows nested links during staging cleanup', async () => {
    const b = await bench()
    const outside = join(b.parent, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'preserve'), 'user data')
    await symlink(outside, b.root, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(b.store.inspect(def, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    await unlink(b.root)
    await b.store.inspect(def, signal())
    await symlink(outside, join(b.root, def.id, 'active.json'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(b.store.inspect(def, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    await unlink(join(b.root, def.id, 'active.json'))
    const staging = await b.store.stage(def, signal())
    await symlink(outside, join(staging, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await b.store.cleanup(staging); await b.store.cleanup(staging)
    expect(await readFile(join(outside, 'preserve'), 'utf8')).toBe('user data')
    await expect(b.store.cleanup(outside)).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
  })

  it('does not steal existing writer locks or persisted executable leases', async () => {
    const b = await bench()
    const current = await install(b.store)
    const base = join(b.root, def.id)
    await writeFile(join(base, 'active.json.lock'), 'unknown owner')
    await expect(b.store.inspect(def, signal())).rejects.toThrow('timed out')
    expect(await readFile(join(base, 'active.json.lock'), 'utf8')).toBe('unknown owner')
    await unlink(join(base, 'active.json.lock'))
    await writeFile(join(base, 'leases', 'unknown-owner.json'), '{}')
    expect((await b.store.inspect(def, signal())).leased).toBe(true)
    await expect(b.store.remove(def, current.revision, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_LEASED' })
  })

  it('refuses a replaced lease directory during release without unlinking external files', async () => {
    const b = await bench()
    await install(b.store)
    const lease = await b.store.acquire(def, signal())
    const leases = join(b.root, def.id, 'leases')
    const leaseName = (await readdir(leases))[0]!
    await rename(leases, join(b.root, def.id, 'retained-leases'))
    const outside = join(b.parent, 'outside-leases')
    await mkdir(outside)
    await writeFile(join(outside, leaseName), 'preserve external lease')
    await symlink(outside, leases, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(lease.release()).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    expect(await readFile(join(outside, leaseName), 'utf8')).toBe('preserve external lease')
  })

  it('rejects malformed pointer records and aborts before mutation', async () => {
    const b = await bench()
    const current = await b.store.inspect(def, signal())
    const staging = await stage(b.store)
    const reason = new Error('cancel before commit')
    await expect(b.store.commit(def, staging, current.revision, AbortSignal.abort(reason))).rejects.toBe(reason)
    expect((await b.store.inspect(def, signal())).revision).toBe(current.revision)
    await writeFile(join(b.root, def.id, 'active.json'), '{malformed')
    await expect(b.store.inspect(def, signal())).rejects.toMatchObject({ code: 'MOBILE_RESOURCE_INVALID' })
    expect(basename(staging)).toMatch(/^stage-/)
  })
})
