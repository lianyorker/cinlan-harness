/** Validates release metadata and extracts ZIP resources into private staging directories. */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { crc32, createInflateRaw } from 'node:zlib'
import { isSkillName } from '@deepseek-ai/dsh-skill'
import { parseDocument } from 'yaml'
import type { SecuritySkillRelease } from './types.ts'

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`)
  return value
}

function integer(value: unknown, label: string, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`)
  }
  return value
}

function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('Invalid SHA-256 digest')
  return value.toLowerCase()
}

function releaseUrl(value: unknown): string {
  const raw = text(value, 'Release URL')
  if (!/^https?:\/\//i.test(raw) || /[\s\\]/.test(raw)) throw new Error('Release URL must be absolute HTTP(S)')
  const url = new URL(raw)
  if (url.username || url.password || url.hash ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Release URL requires HTTPS or loopback HTTP without credentials or fragment')
  }
  return url.href
}

function safePath(value: unknown, directory = false): string {
  const path = text(value, 'Resource path')
  const stripped = directory && path.endsWith('/') ? path.slice(0, -1) : path
  if (path.length > 4096 || path !== path.normalize('NFC') || /[\\\x00-\x1f\x7f:<>"|?*]/.test(stripped) ||
    stripped.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|conin\$|conout\$|clock\$|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(part.replace(/\..*$/, '').trimEnd()))) {
    throw new Error(`Unsafe resource path: ${path}`)
  }
  return stripped
}

function inventoryPath(value: unknown): string {
  const path = safePath(value)
  if (!path.startsWith('skills/') && !['LICENSE', 'NOTICE'].includes(path)) {
    throw new Error(`Resource inventory path is outside skills/: ${path}`)
  }
  return path
}

function claimPath(paths: Map<string, { path: string; directory: boolean; explicit: boolean }>,
  path: string, directory: boolean): void {
  const components = path.split('/')
  for (let i = 1; i <= components.length; i++) {
    const name = components.slice(0, i).join('/')
    const key = name.toUpperCase().toLowerCase()
    const explicit = i === components.length
    const isDirectory = !explicit || directory
    const previous = paths.get(key)
    if (previous && (previous.path !== name || previous.directory !== isDirectory ||
      (explicit && previous.explicit))) throw new Error(`Duplicate or colliding resource path: ${path}`)
    paths.set(key, { path: name, directory: isDirectory, explicit: explicit || previous?.explicit === true })
  }
}

/**
 * Parses the schema-1 network manifest; archive URLs are absolute HTTPS or loopback HTTP.
 * @param value Untrusted manifest JSON.
 * @param manifestUrl Absolute URL that supplied the document.
 * @returns The validated release and its exact file and skill inventories.
 */
export function parseReleaseManifest(value: unknown, manifestUrl: string): SecuritySkillRelease {
  releaseUrl(manifestUrl)
  const data = record(value, 'Release manifest')
  if (data.schemaVersion !== 1 || data.id !== 'security-skills') throw new Error('Unsupported resource manifest')
  const contentSha256 = digest(data.contentSha256)
  const version = text(data.version, 'Release version')
  if (version !== `1-${contentSha256.slice(0, 16)}`) throw new Error('Release version does not match content SHA-256')
  const archive = record(data.archive, 'Release archive')
  if (archive.format !== 'zip') throw new Error('Release archive must use ZIP')
  const fileName = safePath(archive.fileName)
  if (fileName.includes('/') || !fileName.endsWith('.zip')) throw new Error('Archive fileName must name a ZIP file')
  const archiveUrl = releaseUrl(archive.url)
  const bytes = integer(archive.bytes, 'Archive bytes')
  const sha256 = digest(archive.sha256)
  if (!Array.isArray(data.platforms) || data.platforms.length !== 3 ||
    !['win32', 'darwin', 'linux'].every(platform => (data.platforms as unknown[]).includes(platform))) {
    throw new Error('Release platforms must contain win32, darwin and linux')
  }
  record(data.license, 'Release license')
  record(data.provenance, 'Release provenance')
  const fileCount = integer(data.fileCount, 'File count')
  const skillCount = integer(data.skillCount, 'Skill count')
  if (!Array.isArray(data.files) || data.files.length !== fileCount ||
    !Array.isArray(data.skills) || data.skills.length !== skillCount) throw new Error('Release inventory count mismatch')
  const paths = new Map<string, { path: string; directory: boolean; explicit: boolean }>()
  const files = data.files.map((value) => {
    const file = record(value, 'Resource file')
    const path = inventoryPath(file.path)
    claimPath(paths, path, false)
    return { path, bytes: integer(file.bytes, 'File bytes', 0), sha256: digest(file.sha256) }
  })
  const skillFiles = new Set(files.filter(file => file.path.endsWith('/SKILL.md')).map(file => file.path))
  const names = new Set<string>()
  const skills = data.skills.map((value) => {
    const skill = record(value, 'Resource skill')
    const name = text(skill.name, 'Skill name')
    const path = inventoryPath(skill.path)
    if (!isSkillName(name) || names.has(name) || !skillFiles.delete(path)) throw new Error('Invalid or duplicate skill inventory')
    names.add(name)
    return { name, path }
  })
  if (skillFiles.size) throw new Error('Skill inventory omits SKILL.md files')
  return { version, archiveUrl, bytes, sha256, contentSha256, fileCount, skillCount, files, skills }
}

interface ZipEntry {
  path: string
  directory: boolean
  method: number
  flags: number
  crc: number
  compressed: number
  expanded: number
  offset: number
  dataOffset: number
}

function zipEntries(archive: Uint8Array, limits: { maxExpandedBytes: number; maxFiles: number },
  signal: AbortSignal): ZipEntry[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  const u16 = (offset: number): number => view.getUint16(offset, true)
  const u32 = (offset: number): number => view.getUint32(offset, true)
  let end = archive.length - 22
  for (; end >= Math.max(0, archive.length - 65_557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === archive.length) break
  }
  if (end < Math.max(0, archive.length - 65_557) || u32(end) !== 0x06054b50) throw new Error('ZIP end record is missing')
  const count = u16(end + 10)
  const central = u32(end + 16)
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 0xffff ||
    central + u32(end + 12) !== end) throw new Error('ZIP64, split or malformed ZIP is unsupported')
  if (count > limits.maxFiles) throw new Error('ZIP entry count exceeds maxFiles')
  const entries: ZipEntry[] = []
  const paths = new Map<string, { path: string; directory: boolean; explicit: boolean }>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (start: number, size: number, flags: number): string => {
    const bytes = archive.subarray(start, start + size)
    if (!(flags & 0x800) && bytes.some(byte => byte > 127)) throw new Error('ZIP filenames must use UTF-8 or ASCII')
    return decoder.decode(bytes)
  }
  const extras = (start: number, size: number): void => {
    const end = start + size
    while (start < end) {
      if (start + 4 > end || u16(start) === 1) throw new Error('Malformed or ZIP64 extra field')
      start += 4 + u16(start + 2)
    }
    if (start !== end) throw new Error('Malformed ZIP extra field')
  }
  let cursor = central
  let expanded = 0
  for (let i = 0; i < count; i++) {
    signal.throwIfAborted()
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw new Error('Malformed ZIP central directory')
    const flags = u16(cursor + 8)
    const method = u16(cursor + 10)
    const nameSize = u16(cursor + 28)
    const extraSize = u16(cursor + 30)
    const next = cursor + 46 + nameSize + extraSize + u16(cursor + 32)
    if (next > end || u16(cursor + 34) || flags & ~0x80e || ![0, 8].includes(method)) {
      throw new Error('Unsupported ZIP encryption, flags or compression')
    }
    const name = decode(cursor + 46, nameSize, flags)
    const directory = name.endsWith('/')
    const path = safePath(name, directory)
    claimPath(paths, path, directory)
    const attributes = u32(cursor + 38)
    const type = (attributes >>> 16) & 0xf000
    if ((type !== 0 && type !== (directory ? 0x4000 : 0x8000)) ||
      (attributes & 0x448) || ((attributes & 0x10) !== 0 && !directory)) {
      throw new Error('ZIP symlinks and special files are forbidden')
    }
    const entry: ZipEntry = { path, directory, method, flags, crc: u32(cursor + 16),
      compressed: u32(cursor + 20), expanded: u32(cursor + 24), offset: u32(cursor + 42), dataOffset: 0 }
    if (entry.compressed === 0xffffffff || entry.expanded === 0xffffffff || entry.offset === 0xffffffff) {
      throw new Error('ZIP64 is unsupported')
    }
    expanded += entry.expanded
    if (expanded > limits.maxExpandedBytes) throw new Error('ZIP expanded bytes exceed maxExpandedBytes')
    if (directory && (entry.expanded || entry.crc)) throw new Error('ZIP directory contains data')
    extras(cursor + 46 + nameSize, extraSize)
    entries.push(entry)
    cursor = next
  }
  if (cursor !== end) throw new Error('ZIP central directory size mismatch')
  entries.sort((a, b) => a.offset - b.offset)
  cursor = 0
  for (const entry of entries) {
    signal.throwIfAborted()
    const offset = entry.offset
    if (offset !== cursor || offset + 30 > central || u32(offset) !== 0x04034b50) {
      throw new Error('ZIP local entries overlap or contain unlisted data')
    }
    const nameSize = u16(offset + 26)
    const extraSize = u16(offset + 28)
    entry.dataOffset = offset + 30 + nameSize + extraSize
    if (entry.dataOffset + entry.compressed > central || u16(offset + 6) !== entry.flags ||
      u16(offset + 8) !== entry.method ||
      decode(offset + 30, nameSize, entry.flags) !== entry.path + (entry.directory ? '/' : '')) {
      throw new Error('ZIP local metadata differs from central directory')
    }
    extras(offset + 30 + nameSize, extraSize)
    cursor = entry.dataOffset + entry.compressed
    if (entry.flags & 8) {
      if (cursor + 12 > central) throw new Error('Truncated ZIP data descriptor')
      if (u32(cursor) === 0x08074b50) cursor += 4
      if (cursor + 12 > central || u32(cursor) !== entry.crc ||
        u32(cursor + 4) !== entry.compressed || u32(cursor + 8) !== entry.expanded) {
        throw new Error('ZIP data descriptor mismatch')
      }
      cursor += 12
    } else if (u32(offset + 14) !== entry.crc || u32(offset + 18) !== entry.compressed ||
      u32(offset + 22) !== entry.expanded) throw new Error('ZIP local sizes or CRC mismatch')
  }
  if (cursor !== central) throw new Error('ZIP contains unlisted local data')
  return entries
}

async function directoryOnly(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Resource directory is not a real directory: ${path}`)
}

/**
 * Extracts ZIP32 stored/deflate entries without stripping any path prefix.
 * Preflights every path, attribute and size before writing; verifies expanded sizes and CRCs.
 * @param archive Complete ZIP bytes; ZIP64, encryption and split archives are rejected.
 * @param destination Existing empty private directory, exclusively owned by the caller.
 * @param limits Maximum ZIP entries (including directories) and total uncompressed bytes.
 * @param signal Cancellation lifetime; rejection can leave partial files for caller cleanup.
 * @returns Completion after all writes and decompression streams have settled.
 */
export async function extractResourceArchive(archive: Uint8Array, destination: string,
  limits: { maxExpandedBytes: number; maxFiles: number }, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const entries = zipEntries(archive, limits, signal)
  destination = resolve(destination)
  await directoryOnly(destination)
  if ((await readdir(destination)).length) throw new Error('ZIP destination must be empty')
  const directories = new Set([destination])
  async function ensureDirectory(path: string): Promise<void> {
    if (directories.has(path)) return
    await ensureDirectory(dirname(path))
    signal.throwIfAborted()
    await mkdir(path, { mode: 0o700 })
    directories.add(path)
  }
  for (const entry of entries) {
    signal.throwIfAborted()
    const path = join(destination, ...entry.path.split('/'))
    const compressed = archive.subarray(entry.dataOffset, entry.dataOffset + entry.compressed)
    let data: Uint8Array = compressed
    if (entry.method === 8) {
      const chunks: Buffer[] = []
      let size = 0
      await pipeline(Readable.from([compressed]), createInflateRaw(), new Writable({
        write(chunk: Buffer, _encoding, callback) {
          size += chunk.length
          if (size > entry.expanded) {
            callback(new Error('ZIP expanded size exceeds declared size'))
            return
          }
          chunks.push(chunk)
          callback()
        },
      }), { signal })
      data = Buffer.concat(chunks, size)
    }
    if (data.length !== entry.expanded || crc32(data) !== entry.crc) throw new Error(`ZIP size or CRC mismatch: ${entry.path}`)
    if (entry.directory) {
      await ensureDirectory(path)
      continue
    }
    await ensureDirectory(dirname(path))
    signal.throwIfAborted()
    await writeFile(path, data, { flag: 'wx', mode: 0o600, signal })
  }
  signal.throwIfAborted()
}

async function resourceFiles(directory: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted()
  await directoryOnly(directory)
  const pending = ['']
  const files: string[] = []
  let relative: string | undefined
  while ((relative = pending.pop()) !== undefined) {
    for (const name of await readdir(join(directory, relative))) {
      signal.throwIfAborted()
      const path = relative ? relative + '/' + name : name
      const metadata = await lstat(join(directory, path))
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
        throw new Error(`Resource symlinks and special files are forbidden: ${path}`)
      }
      if (metadata.isDirectory()) pending.push(path)
      else files.push(path)
    }
  }
  signal.throwIfAborted()
  return files.sort()
}

async function skillName(path: string, signal: AbortSignal): Promise<string> {
  const raw = await readFile(path, { encoding: 'utf8', signal })
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw)
  if (!match) throw new Error(`Missing YAML frontmatter: ${path}`)
  const document = parseDocument(match[1] ?? '', { uniqueKeys: true, strict: true })
  if (document.errors.length || document.warnings.length) throw new Error(`Invalid YAML frontmatter: ${path}`)
  const data = record(document.toJS({ maxAliasCount: 0 }) as unknown, 'Skill frontmatter')
  const name = text(data.name, 'Skill name')
  text(data.description, 'Skill description')
  if (!isSkillName(name)) throw new Error(`Invalid skill name: ${name}`)
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    if (data[key] !== undefined && typeof data[key] !== 'boolean') throw new Error(`Skill ${key} must be boolean`)
  }
  for (const key of ['disableModelInvocation', 'modelInvocable', 'userInvocable']) {
    if (Object.hasOwn(data, key)) throw new Error(`Unsupported skill invocation field: ${key}`)
  }
  signal.throwIfAborted()
  return name
}

/**
 * Validates every SKILL.md below skills/ and refuses symlinks anywhere in the resource tree.
 * @param directory Private generation root containing a real skills/ directory.
 * @param signal Cancellation lifetime checked during traversal and file reads.
 * @returns The nonzero number of skills with unique names and valid mandatory frontmatter.
 */
export async function validateResourceDirectory(directory: string, signal: AbortSignal): Promise<{ skillCount: number }> {
  const files = await resourceFiles(directory, signal)
  await directoryOnly(join(directory, 'skills'))
  const names = new Set<string>()
  for (const path of files.filter(path => path.startsWith('skills/') && path.endsWith('/SKILL.md'))) {
    const name = await skillName(join(directory, path), signal)
    if (names.has(name)) throw new Error(`Duplicate resource skill name: ${name}`)
    names.add(name)
  }
  if (!names.size) throw new Error('Resource directory must contain at least one SKILL.md')
  signal.throwIfAborted()
  return { skillCount: names.size }
}

/**
 * Verifies exact file inventory, byte lengths, SHA-256 digests and declared skill names.
 * @param directory Private extracted generation root; no concurrent writers are permitted.
 * @param release Validated network release metadata.
 * @param signal Cancellation lifetime checked while traversing and hashing files.
 * @returns Completion only when the files and canonical inventory hash match the release.
 */
export async function verifyResourceFiles(directory: string, release: SecuritySkillRelease,
  signal: AbortSignal): Promise<void> {
  const paths = await resourceFiles(directory, signal)
  for (const name of await readdir(directory)) {
    if (!['skills', 'LICENSE', 'NOTICE'].includes(name)) throw new Error(`Unlisted resource root entry: ${name}`)
  }
  const expected = new Map(release.files.map(file => [file.path, file]))
  if (paths.length !== release.fileCount) throw new Error('Resource file count mismatch')
  const actual: SecuritySkillRelease['files'] = []
  for (const path of paths) {
    const file = expected.get(path)
    if (!file) throw new Error(`Unlisted resource file: ${path}`)
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of createReadStream(join(directory, path), { signal })) {
      const data = chunk as Buffer
      bytes += data.length
      if (bytes > file.bytes) throw new Error(`Resource byte length mismatch: ${path}`)
      hash.update(data)
    }
    const sha256 = hash.digest('hex')
    if (bytes !== file.bytes || sha256 !== file.sha256) throw new Error(`Resource bytes or SHA-256 mismatch: ${path}`)
    actual.push({ path, sha256, bytes })
  }
  if (createHash('sha256').update(JSON.stringify(actual)).digest('hex') !== release.contentSha256) {
    throw new Error('Resource content SHA-256 mismatch')
  }
  const { skillCount } = await validateResourceDirectory(directory, signal)
  if (skillCount !== release.skillCount) throw new Error('Resource skill count mismatch')
  for (const skill of release.skills) {
    if (await skillName(join(directory, skill.path), signal) !== skill.name) throw new Error('Resource skill name mismatch')
  }
  signal.throwIfAborted()
}
