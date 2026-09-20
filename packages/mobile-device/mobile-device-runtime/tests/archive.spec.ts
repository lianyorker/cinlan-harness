/** ZIP extraction uses real private files and maintained fixture encoding. */
import JSZip from 'jszip'
import { ZipFile, type Entry, type ZipFileOptions } from 'yauzl'
import type { Readable } from 'node:stream'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractArchive } from '../src/archive.ts'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const limits = { maxFiles: 20, maxExpandedBytes: 1024 * 1024 }
const signal = () => new AbortController().signal
const archiveError = 'The mobile runtime archive is invalid or exceeds extraction limits'
async function fixture(entries: { name: string; contents?: string | Buffer; mode?: number; directory?: boolean }[]) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mobile-zip-'))
  roots.push(root)
  const archive = new JSZip()
  for (const entry of entries) archive.file(entry.name, entry.contents ?? '', {
    createFolders: false, unixPermissions: entry.mode ?? (entry.directory ? 0o40700 : 0o100600), dir: entry.directory ?? false,
  })
  const bytes = await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE' })
  const zip = join(root, 'runtime.zip')
  await writeFile(zip, bytes)
  return { root, zip, bytes, destination: join(root, 'staging') }
}
function centralDirectory(bytes: Buffer): number {
  const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  if (offset < 0) throw new Error('Fixture has no central-directory entry')
  return offset
}

describe('Managed runtime ZIP extraction', () => {
  it('strips one fixed root and writes private nested files with the exact expanded-byte cap', async () => {
    const f = await fixture([
      { name: 'platform-tools/', directory: true },
      { name: 'platform-tools/adb.exe', contents: 'native' },
      { name: 'platform-tools/lib/support.dll', contents: 'library' },
      { name: 'platform-tools/lib/', directory: true },
    ])
    await extractArchive(f.zip, f.destination, 'platform-tools', { maxFiles: 4, maxExpandedBytes: 13 }, signal())
    expect(await readFile(join(f.destination, 'adb.exe'), 'utf8')).toBe('native')
    expect(await readFile(join(f.destination, 'lib', 'support.dll'), 'utf8')).toBe('library')
    expect(await readdir(f.destination)).toEqual(['adb.exe', 'lib'])
    if (process.platform !== 'win32') {
      expect((await stat(f.destination)).mode & 0o777).toBe(0o700)
      expect((await stat(join(f.destination, 'adb.exe'))).mode & 0o777).toBe(0o600)
    }
    await rm(f.zip)
  })

  it('accepts a caller-created empty staging directory but never overwrites its children', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'replacement' }])
    await mkdir(f.destination, { mode: 0o700 })
    await extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    expect(await readFile(join(f.destination, 'adb.exe'), 'utf8')).toBe('replacement')
  })

  it.each([
    '../escape', '/absolute', '//server/share', 'C:/escape', 'platform-tools/../escape', 'platform-tools/./adb',
    'platform-tools//adb', 'platform-tools/dir//', 'platform-tools/adb:stream', 'platform-tools/dir\\adb.exe',
    'platform-tools/CON', 'platform-tools/con.txt', 'platform-tools/LPT1.log', 'platform-tools/com¹.exe',
    'platform-tools/trailing.', 'platform-tools/trailing ', 'platform-tools/invalid\u0000name', 'platform-tools/wild*card',
    'other-root/adb.exe', 'platform-tools',
  ])('rejects nonportable or escaping entry %j', async (name) => {
    const f = await fixture([{ name, contents: 'private payload' }])
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    expect(await readdir(f.root)).toEqual(['runtime.zip', 'staging'])
  })

  it.each([
    ['platform-tools/adb.exe', 'platform-tools/ADB.EXE'],
    ['platform-tools/Lib/a.dll', 'platform-tools/lib/b.dll'],
    ['platform-tools/lib', 'platform-tools/lib/a.dll'],
    ['platform-tools/caf\u00e9/a', 'platform-tools/cafe\u0301/b'],
  ])('rejects case, normalization, and file-directory collisions %j', async (first, second) => {
    const f = await fixture([{ name: first, contents: 'first' }, { name: second, contents: 'second' }])
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
  })

  it('rejects duplicate exact filenames even when the ZIP encoder would coalesce them', async () => {
    const f = await fixture([{ name: 'platform-tools/one', contents: 'first' }, { name: 'platform-tools/two', contents: 'second' }])
    const bytes = Buffer.from(f.bytes)
    const old = Buffer.from('platform-tools/two')
    const replacement = Buffer.from('platform-tools/one')
    for (let offset = bytes.indexOf(old); offset >= 0; offset = bytes.indexOf(old, offset + old.length)) replacement.copy(bytes, offset)
    await writeFile(f.zip, bytes)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
  })

  it.each([0o120777, 0o010600, 0o020600, 0o060600, 0o140600])('rejects symlink or special UNIX mode %i', async (mode) => {
    const f = await fixture([{ name: 'platform-tools/special', contents: '../outside', mode }])
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    expect(await readdir(f.destination)).toEqual([])
  })

  it.each([1, 64])('rejects encrypted ZIP flag %i before creating files', async (flag) => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'file' }])
    const bytes = Buffer.from(f.bytes)
    const central = centralDirectory(bytes)
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 8) | flag, central + 8)
    await writeFile(f.zip, bytes)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    expect(await readdir(f.destination)).toEqual([])
  })

  it('rejects link metadata carried in an extra field', async () => {
    const f = await fixture([{ name: 'platform-tools/\u00e9.exe', contents: 'file' }])
    const bytes = Buffer.from(f.bytes)
    const central = centralDirectory(bytes)
    const extraLength = bytes.readUInt16LE(central + 30)
    expect(extraLength).toBeGreaterThan(4)
    const extra = central + 46 + bytes.readUInt16LE(central + 28)
    bytes.writeUInt16LE(0x000d, extra)
    await writeFile(f.zip, bytes)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
  })

  it('rejects an existing destination symlink without modifying its target', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'file' }])
    const outside = join(f.root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'preserve'), 'user file')
    await symlink(outside, f.destination, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    expect(await readdir(outside)).toEqual(['preserve'])
  })

  it('enforces archive entry count and combined expanded-byte limits', async () => {
    const f = await fixture([{ name: 'platform-tools/one', contents: '1234' }, { name: 'platform-tools/two', contents: '5678' }])
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', { ...limits, maxFiles: 1 }, signal())).rejects.toThrow(archiveError)
    expect(await readdir(f.destination)).toEqual([])
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', { ...limits, maxExpandedBytes: 7 }, signal())).rejects.toThrow(archiveError)
    expect(await readdir(f.destination)).toEqual(['one'])
  })

  it('rejects decompressed bytes beyond a forged central-directory entry size', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'longer-than-declared' }])
    const bytes = Buffer.from(f.bytes)
    bytes.writeUInt32LE(1, centralDirectory(bytes) + 24)
    await writeFile(f.zip, bytes)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', { ...limits, maxExpandedBytes: 1 }, signal())).rejects.toThrow(archiveError)
    await rm(f.destination, { recursive: true })
    await rm(f.zip)
  })

  it('extracts stored entries and rejects corrupted deflate streams without leaving open writes', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'runtime executable' }])
    const stored = new JSZip()
    stored.file('platform-tools/empty', '', { createFolders: false })
    stored.file('platform-tools/stored.dll', 'stored', { createFolders: false, compression: 'STORE' })
    await writeFile(f.zip, await stored.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
    await extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())
    expect(await readFile(join(f.destination, 'stored.dll'), 'utf8')).toBe('stored')
    expect((await stat(join(f.destination, 'empty'))).size).toBe(0)
    await rm(f.destination, { recursive: true })
    const corrupt = Buffer.from(f.bytes)
    const dataStart = 30 + corrupt.readUInt16LE(26) + corrupt.readUInt16LE(28)
    corrupt[dataStart] = 0xff
    await writeFile(f.zip, corrupt)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    await rm(f.destination, { recursive: true })
    await rm(f.zip)
  })

  it('rejects expanded data shorter than its declared entry size', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'short' }])
    const bytes = Buffer.from(f.bytes)
    bytes.writeUInt32LE(100, centralDirectory(bytes) + 24)
    await writeFile(f.zip, bytes)
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    await rm(f.destination, { recursive: true })
    await rm(f.zip)
  })

  it('rejects malformed ZIP and invalid configured bounds with fixed diagnostics', async () => {
    const f = await fixture([])
    await writeFile(f.zip, 'private invalid archive payload')
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, signal())).rejects.toThrow(archiveError)
    for (const bad of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(extractArchive(f.zip, f.destination, 'platform-tools', { ...limits, maxFiles: bad }, signal())).rejects.toThrow(archiveError)
      await expect(extractArchive(f.zip, f.destination, 'platform-tools', { ...limits, maxExpandedBytes: bad }, signal())).rejects.toThrow(archiveError)
    }
    for (const prefix of ['', '.', '../root', 'root/subtree', 'root\\subtree', 'CON']) {
      await expect(extractArchive(f.zip, f.destination, prefix, limits, signal())).rejects.toThrow(archiveError)
    }
  })

  it('preserves cancellation before opening an archive and creates no destination', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: 'file' }])
    const reason = new Error('cancelled by caller')
    await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, AbortSignal.abort(reason))).rejects.toBe(reason)
    expect(await readdir(f.root)).toEqual(['runtime.zip'])
  })

  it('joins active read and write streams on cancellation before rejecting', async () => {
    const f = await fixture([{ name: 'platform-tools/adb.exe', contents: Buffer.alloc(512 * 1024, 65) }])
    const controller = new AbortController()
    const reason = new Error('cancel during first decoded chunk')
    type ReadCallback = (error: Error | null, stream: Readable) => void
    type OpenStream = (this: ZipFile, entry: Entry, options: ZipFileOptions, callback: ReadCallback) => void
    // oxlint-disable-next-line typescript/unbound-method -- The saved method is invoked with the original ZIP receiver via call.
    const original: OpenStream = ZipFile.prototype.openReadStream
    const hook = vi.spyOn(ZipFile.prototype, 'openReadStream').mockImplementation(function (this: ZipFile, entry: Entry,
      optionsOrCallback: ZipFileOptions | ReadCallback, suppliedCallback?: ReadCallback): void {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : suppliedCallback
      if (callback === undefined) throw new Error('Fixture stream callback is required')
      const options = typeof optionsOrCallback === 'function'
        ? { decompress: null, decrypt: null, start: null, end: null } : optionsOrCallback
      original.call(this, entry, options, (error, stream) => {
        if (!error) stream.once('data', () => { controller.abort(reason) })
        callback(error, stream)
      })
    })
    try {
      await expect(extractArchive(f.zip, f.destination, 'platform-tools', limits, controller.signal)).rejects.toBe(reason)
      await rm(f.destination, { recursive: true })
      await rm(f.zip)
      expect(await readdir(f.root)).toEqual([])
    } finally { hook.mockRestore() }
  })
})
