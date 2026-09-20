/** Static, offline security resource inventory shared by bundled installation and release packaging. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { parse } from 'yaml'

const OMIT = new Set(['.gitkeep', '.gitignore', '.claude-plugin'])
const TEXT_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml', '.ps1', '.sh', '.py', '.txt'])

/** One immutable UTF-8 file in the archive. */
export interface ResourceFile {
  /** Portable archive-relative filename. */
  path: string
  /** SHA-256 over normalized UTF-8 bytes. */
  sha256: string
  /** Exact normalized byte count. */
  bytes: number
}

/** One parsed skill entry in the archive. */
export interface ResourceSkill {
  name: string
  path: string
}

/** Collected resource bytes and the matching manifest inventory. */
export interface ResourceInventory {
  files: ResourceFile[]
  skills: ResourceSkill[]
  data: Map<string, Uint8Array>
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Compare portable resource paths by Unicode code point.
 * @param a - first path.
 * @param b - second path.
 * @returns ordering for canonical inventories.
 */
export function compareResourcePaths(a: string, b: string): number {
  const left = Array.from(a)
  const right = Array.from(b)
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const delta = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0)
    if (delta !== 0) return delta
  }
  return left.length - right.length
}

/**
 * Reject names unsafe for extraction on any supported Host filesystem.
 * @param path - archive-relative slash-separated path.
 */
export function assertResourcePath(path: string): void {
  if (path.length === 0 || path.includes('\\') || path.includes(':') || path.startsWith('/')
    || /[\u0000-\u001f]/u.test(path)
    || path.split('/').some(part => part === '' || part === '.' || part === '..' || /[. ]$/u.test(part)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error(`Unsafe resource path: ${path}`)
  }
}

function normalizedText(data: Uint8Array, path: string): Uint8Array {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\r\n/g, '\n')
  // Resource text can contain inert example passwords; these patterns identify credential containers or tokens.
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u.test(text)
    || /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}\b/u.test(text)) {
    throw new Error(`Credential material is not allowed in resource file: ${path}`)
  }
  return Buffer.from(text, 'utf8')
}

/**
 * Inventory a reviewed resource directory without following links or executing scripts.
 * @param sourceRoot - existing root containing SKILL.md.
 * @param notices - optional distribution LICENSE and NOTICE, included in the canonical inventory.
 * @returns deterministic file and skill inventories plus the exact ZIP bytes for each file.
 */
export async function collectResourceInventory(
  sourceRoot: string, notices?: { licensePath: string; noticePath: string },
): Promise<ResourceInventory> {
  const data = new Map<string, Uint8Array>()
  const collisions = new Set<string>()
  async function visit(directory: string, prefix: string): Promise<void> {
    const entries = (await readdir(directory)).sort(compareResourcePaths)
    for (const name of entries) {
      if (OMIT.has(name)) continue
      const path = `${prefix}/${name}`
      assertResourcePath(path)
      if (name.startsWith('.') || /^(?:id_rsa|id_ed25519|credentials|tool-index\.(?:json|md))$/iu.test(name)) {
        throw new Error(`Unreviewed private or generated resource entry: ${path}`)
      }
      const folded = path.normalize('NFC').toLowerCase()
      if (collisions.has(folded)) throw new Error(`Resource path collision: ${path}`)
      collisions.add(folded)
      const absolute = resolve(directory, name)
      const metadata = await lstat(absolute)
      if (metadata.isSymbolicLink()) throw new Error(`Resource links are not allowed: ${path}`)
      if (metadata.isDirectory()) {
        await visit(absolute, path)
      } else if (metadata.isFile()) {
        if (name !== 'LICENSE' && !TEXT_EXTENSIONS.has(extname(name).toLowerCase())) {
          throw new Error(`Unreviewed resource file format: ${path}`)
        }
        data.set(path, normalizedText(await readFile(absolute), path))
      } else {
        throw new Error(`Non-regular resource entry: ${path}`)
      }
    }
  }
  if (!(await lstat(sourceRoot)).isDirectory()) throw new Error('Resource root must be a real directory')
  await visit(sourceRoot, 'skills')
  if (!data.has('skills/SKILL.md')) throw new Error('Resource root SKILL.md is missing')
  if (notices !== undefined) {
    for (const [path, input] of [['LICENSE', notices.licensePath], ['NOTICE', notices.noticePath]] as const) {
      data.set(path, normalizedText(await readFile(input), path))
    }
  }
  const files: ResourceFile[] = []
  const skills: ResourceSkill[] = []
  const names = new Set<string>()
  for (const [path, bytes] of [...data].sort(([a], [b]) => compareResourcePaths(a, b))) {
    files.push({ path, sha256: sha256(bytes), bytes: bytes.length })
    if (path.endsWith('/SKILL.md')) {
      const text = new TextDecoder().decode(bytes)
      const match = /^---\n([\s\S]*?)\n---(?:\n|$)/u.exec(text)
      const metadata: unknown = match === null ? undefined : parse(match[1] ?? '')
      if (typeof metadata !== 'object' || metadata === null || !('name' in metadata)
        || typeof metadata.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(metadata.name)
        || !('description' in metadata) || typeof metadata.description !== 'string' || metadata.description.trim() === '') {
        throw new Error(`Invalid skill frontmatter: ${path}`)
      }
      if (names.has(metadata.name)) throw new Error(`Duplicate resource skill name: ${metadata.name}`)
      names.add(metadata.name)
      skills.push({ name: metadata.name, path })
    }
  }
  return { files, skills, data }
}

/**
 * Hash the canonical inventory, including all LICENSE/NOTICE and skill files.
 * @param files - sorted entries with property order path, sha256, bytes.
 * @returns lowercase SHA-256 of UTF-8 JSON.stringify(files), without a trailing newline.
 */
export function resourceContentSha256(files: readonly ResourceFile[]): string {
  return sha256(JSON.stringify(files))
}
