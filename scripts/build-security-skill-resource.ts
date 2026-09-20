/** Build an offline, deterministic security-skill resource ZIP from reviewed repository inputs. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, type Zippable } from 'fflate'
import { assertResourcePath, collectResourceInventory, compareResourcePaths, resourceContentSha256, type ResourceFile, type ResourceSkill } from '@deepseek-ai/dsh-security-skills/resource-inventory'

export { assertResourcePath, collectResourceInventory } from '@deepseek-ai/dsh-security-skills/resource-inventory'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'packages/security/security-skills/assets/skills'
function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Create a ZIP with sorted entries, fixed local DOS timestamps and stored UTF-8 bytes.
 * @param data - reviewed archive paths and exact file bytes.
 * @returns deterministic ZIP bytes; no compression or executable metadata is introduced.
 */
export function createResourceZip(data: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const archive: Zippable = Object.create(null) as Zippable
  for (const [path, bytes] of [...data].sort(([a], [b]) => compareResourcePaths(a, b))) {
    assertResourcePath(path)
    archive[path] = [bytes, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 0, attrs: 0 }]
  }
  return zipSync(archive)
}

/** Local builder input; the optional URL is supplied by the release owner, never invented. */
export interface BuildOptions {
  sourceRoot: string
  outputDirectory: string
  licensePath: string
  noticePath: string
  provenancePath: string
  archiveUrl?: string
}

/** External descriptor shared by local inspection and a configured network release. */
export interface ResourceManifest {
  schemaVersion: 1
  id: 'security-skills'
  version: string
  contentSha256: string
  archive: { format: 'zip'; fileName: string; sha256: string; bytes: number; url?: string }
  fileCount: number
  skillCount: number
  files: ResourceFile[]
  skills: ResourceSkill[]
  platforms: string[]
  license: Record<string, unknown>
  provenance: Record<string, unknown>
}

function releaseUrl(input: string): string {
  const url = new URL(input)
  if (url.username || url.password || url.hash || url.search || !url.pathname.endsWith('.zip')
    || !(url.protocol === 'https:' || (url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Archive URL must be HTTPS (or loopback HTTP for a controlled test), without credentials, query or fragment')
  }
  return url.href
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Build an immutable local ZIP and its descriptor; no network or resource command is executed.
 * @param options - reviewed inputs and output directory, plus an optional explicitly configured archive URL.
 * @returns output paths and the complete descriptor; a missing URL denotes local-only output.
 */
export async function buildSecuritySkillResource(options: BuildOptions): Promise<{
  archivePath: string
  manifestPath: string
  manifest: ResourceManifest
}> {
  const source = resolve(options.sourceRoot)
  const output = resolve(options.outputDirectory)
  const offset = relative(source, output)
  if (offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`))) {
    throw new Error('Resource output must be outside the source directory')
  }
  const url = options.archiveUrl === undefined ? undefined : releaseUrl(options.archiveUrl)
  const provenance: unknown = JSON.parse(await readFile(options.provenancePath, 'utf8'))
  if (!record(provenance) || !record(provenance.license) || !record(provenance.audit)
    || typeof provenance.audit.skillCount !== 'number') throw new Error('Invalid resource provenance record')
  const inventory = await collectResourceInventory(source, { licensePath: options.licensePath, noticePath: options.noticePath })
  if (inventory.skills.length !== provenance.audit.skillCount) throw new Error('Resource skill count differs from reviewed provenance')
  const files = inventory.files
  const contentSha256 = resourceContentSha256(files)
  const version = `1-${contentSha256.slice(0, 16)}`
  const fileName = `security-skills-${version}.zip`
  const zip = createResourceZip(inventory.data)
  const manifest: ResourceManifest = {
    schemaVersion: 1, id: 'security-skills', version, contentSha256,
    archive: { format: 'zip', fileName, sha256: sha256(zip), bytes: zip.length, ...(url === undefined ? {} : { url }) },
    fileCount: files.length, skillCount: inventory.skills.length, files, skills: inventory.skills,
    platforms: ['win32', 'darwin', 'linux'], license: provenance.license, provenance,
  }
  await mkdir(output, { recursive: true })
  const archivePath = resolve(output, fileName)
  const manifestPath = resolve(output, `security-skills-${version}.manifest.json`)
  await writeFile(archivePath, zip)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { archivePath, manifestPath, manifest }
}

async function main(args: string[]): Promise<void> {
  let outputDirectory = resolve(ROOT, '.artifacts/security-resources')
  let archiveUrl: string | undefined
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]
    const value = args[index + 1]
    if ((flag !== '--output' && flag !== '--archive-url') || !value || value.startsWith('--') || seen.has(flag)) {
      throw new Error('Usage: build-security-skill-resource.ts [--output directory] [--archive-url explicit-url]')
    }
    seen.add(flag)
    if (flag === '--output') outputDirectory = resolve(value)
    else archiveUrl = value
  }
  const result = await buildSecuritySkillResource({
    sourceRoot: resolve(ROOT, SOURCE), outputDirectory, licensePath: resolve(ROOT, 'packages/security/security-skills/assets/LICENSE'),
    noticePath: resolve(ROOT, 'packages/security/security-skills/assets/NOTICE'),
    provenancePath: resolve(ROOT, 'packages/security/security-skills/assets/resource-provenance.json'),
    ...(archiveUrl === undefined ? {} : { archiveUrl }),
  })
  console.log(JSON.stringify({ archive: relative(ROOT, result.archivePath).split(sep).join('/'),
    manifest: relative(ROOT, result.manifestPath).split(sep).join('/'),
    version: result.manifest.version, fileCount: result.manifest.fileCount, skillCount: result.manifest.skillCount,
    contentSha256: result.manifest.contentSha256, archiveSha256: result.manifest.archive.sha256,
    archiveBytes: result.manifest.archive.bytes, source: archiveUrl === undefined ? 'local-only' : 'configured-url' }, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2))
}
