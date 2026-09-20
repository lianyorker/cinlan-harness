/** Bounded ZIP extraction into caller-owned private staging; yauzl owns ZIP decoding. */
import { createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough, Transform, type Readable } from 'node:stream'
import { createInflateRaw } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { open, type Entry, type ZipFile } from 'yauzl'

function invalid(): Error { return new Error('The mobile runtime archive is invalid or exceeds extraction limits') }
function portable(segment: string): boolean {
  return segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\')
    && !/[<>:"\|?*\u0000-\u001f\u007f]/.test(segment) && !/[. ]$/.test(segment)
    && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(segment)
}
function parts(name: string, root: string): { parts: string[]; directory: boolean } {
  const directory = name.endsWith('/')
  const segments = (directory ? name.slice(0, -1) : name).split('/')
  if (segments.some(segment => !portable(segment)) || segments[0] !== root) throw invalid()
  segments.shift()
  if (segments.length === 0 && !directory) throw invalid()
  return { parts: segments, directory }
}
function validateEntry(entry: Entry, directory: boolean): void {
  const mode = entry.externalFileAttributes >>> 16
  const type = mode & 0xf000
  if ((entry.generalPurposeBitFlag & 0x41) !== 0 || (entry.externalFileAttributes & 0x408) !== 0
    || (type !== 0 && type !== (directory ? 0x4000 : 0x8000))
    || (directory && entry.uncompressedSize !== 0)
    || (!directory && (entry.externalFileAttributes & 0x10) !== 0)
    || entry.extraFields.some(field => field.id === 0x000d || field.id === 0x756e)
    || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) throw invalid()
}
async function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) reject(error)
      else resolve(zip)
    })
  })
}
async function nextEntry(zip: ZipFile, signal: AbortSignal): Promise<Entry | undefined> {
  return new Promise((resolve, reject) => {
    const clean = (): void => {
      zip.off('entry', onEntry); zip.off('end', onEnd)
      signal.removeEventListener('abort', onAbort)
    }
    const onEntry = (entry: Entry): void => { clean(); resolve(entry) }
    const onEnd = (): void => { clean(); resolve(undefined) }
    const onAbort = (): void => { clean(); reject(invalid()) }
    zip.once('entry', onEntry); zip.once('end', onEnd)
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    else zip.readEntry()
  })
}
async function readEntry(zip: ZipFile, entry: Entry, signal: AbortSignal): Promise<Readable> {
  return new Promise((resolve, reject) => {
    const options = { decompress: entry.isCompressed() ? false : null, decrypt: null, start: null, end: null }
    zip.openReadStream(entry, options, (error, stream) => {
      if (error) { reject(error); return }
      if (signal.aborted) { stream.destroy(); reject(invalid()); return }
      resolve(stream)
    })
  })
}

/** Extract only the fixed archive root into fresh private staging without overwriting files.
 * @param zipPath - Caller-verified local ZIP file; the caller owns download size and digest validation.
 * @param destination - Absent or empty private directory under caller-owned parents, never a symlink.
 * @param rootPrefix - One exact portable top-level directory name, without a slash.
 * @param limits - Positive safe entry-count and complete expanded-byte caps; directories count as entries.
 * @param signal - Cancellation closes the active streams and archive before rejection settles.
 * @returns Settlement after every exclusive file write and ZIP handle closes; caller removes staging on failure.
 * @throws A fixed archive error for invalid entries or extraction failures; cancellation preserves its reason.
 */
export async function extractArchive(
  zipPath: string,
  destination: string,
  rootPrefix: string,
  limits: { maxFiles: number; maxExpandedBytes: number },
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  if (!portable(rootPrefix) || rootPrefix.includes('/') || !Number.isSafeInteger(limits.maxFiles) || limits.maxFiles < 1
    || !Number.isSafeInteger(limits.maxExpandedBytes) || limits.maxExpandedBytes < 1) throw invalid()
  let zip: ZipFile | undefined
  let closing: Promise<void> | undefined
  const lifetime = new AbortController()
  const combined = AbortSignal.any([signal, lifetime.signal])
  const close = (): void => { zip?.close() }
  combined.addEventListener('abort', close, { once: true })
  try {
    try { await mkdir(destination, { mode: 0o700 }) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const stat = await lstat(destination)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await readdir(destination)).length !== 0) throw invalid()
    combined.throwIfAborted()
    zip = await openZip(zipPath)
    const opened = zip
    closing = new Promise((resolve) => { opened.once('close', resolve) })
    zip.on('error', () => { lifetime.abort(invalid()) })
    combined.throwIfAborted()
    if (zip.entryCount > limits.maxFiles) throw invalid()
    const names = new Map<string, { original: string; directory: boolean; explicit: boolean }>()
    let count = 0
    let expanded = 0
    for (;;) {
      const entry = await nextEntry(zip, combined)
      if (entry === undefined) break
      if (++count > limits.maxFiles) throw invalid()
      const parsed = parts(entry.fileName, rootPrefix)
      validateEntry(entry, parsed.directory)
      if (entry.uncompressedSize > limits.maxExpandedBytes - expanded) throw invalid()
      if (parsed.parts.length === 0) {
        if (names.has('')) throw invalid()
        names.set('', { original: '', directory: true, explicit: true })
        continue
      }
      for (let index = 0; index < parsed.parts.length; index += 1) {
        const relative = parsed.parts.slice(0, index + 1).join('/')
        const key = relative.normalize('NFC').toLowerCase()
        const directory = index < parsed.parts.length - 1 || parsed.directory
        const explicit = index === parsed.parts.length - 1
        const existing = names.get(key)
        if (existing) {
          if (existing.original !== relative || existing.directory !== directory || (explicit && existing.explicit)) throw invalid()
          if (explicit) existing.explicit = true
        } else {
          names.set(key, { original: relative, directory, explicit })
          if (directory) await mkdir(join(destination, ...parsed.parts.slice(0, index + 1)), { mode: 0o700 })
        }
      }
      combined.throwIfAborted()
      if (parsed.directory) continue
      const input = await readEntry(zip, entry, combined)
      let entryBytes = 0
      const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        entryBytes += chunk.length
        expanded += chunk.length
        if (entryBytes > entry.uncompressedSize || expanded > limits.maxExpandedBytes) callback(invalid())
        else callback(null, chunk)
      } })
      // yauzl 2 streams lack native destroy settlement; Node owns inflation, bounds, and write completion.
      const bridge = new PassThrough()
      input.on('error', (error: Error) => { bridge.destroy(error) })
      bridge.once('close', () => { input.destroy() })
      const decode = entry.isCompressed() ? createInflateRaw() : new PassThrough()
      const output = createWriteStream(join(destination, ...parsed.parts), { flags: 'wx', mode: 0o600 })
      const writing = pipeline(bridge, decode, bound, output, { signal: combined })
      input.pipe(bridge)
      try { await writing } finally { input.unpipe(bridge); input.destroy() }
      if (entryBytes !== entry.uncompressedSize) throw invalid()
    }
    combined.throwIfAborted()
  } catch (_archiveFailure) {
    signal.throwIfAborted()
    throw invalid()
  } finally {
    combined.removeEventListener('abort', close)
    zip?.close()
    await closing
  }
}
