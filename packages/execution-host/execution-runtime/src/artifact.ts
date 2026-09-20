/** Inventory and verify a materialized runtime release without installing dependencies. */
import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, posix } from 'node:path'
import { z } from 'zod'
import type { RuntimeGeneration, RuntimeLimits, RuntimeManifest } from './types.ts'

const digest = z.string().regex(/^[0-9a-f]{64}$/u)
const relativePath = z.string().min(1).refine(value => !value.includes('\\') && !value.includes('\0')
  && !posix.isAbsolute(value) && posix.normalize(value) === value && !value.startsWith('../') && value !== '..')
const manifestSchema = z.object({
  schemaVersion: z.literal(1), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u),
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/u), protocol: z.literal(1), platform: z.enum(['linux', 'darwin']),
  arch: z.enum(['x64', 'arm64']), helper: relativePath, bootstrap: relativePath,
  files: z.array(z.object({ path: relativePath, size: z.number().int().nonnegative(), sha256: digest, executable: z.boolean() }).strict()),
}).strict()

/** Verified release bytes retained for transfer; individual files are rechecked while uploading. */
export interface RuntimeArtifact {
  readonly root: string
  readonly manifest: RuntimeManifest
  readonly bytes: Buffer
  readonly generation: RuntimeGeneration
}

/**
 * Hash bytes using the release manifest algorithm.
 * @param bytes - Exact file contents.
 * @returns Lowercase SHA-256.
 */
export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }

async function inventory(root: string, prefix = ''): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : prefix + '/' + entry.name
    if (path === 'runtime-manifest.json') continue
    if (entry.isDirectory()) files.push(...await inventory(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error('Runtime artifacts must contain only regular files and directories: ' + path)
  }
  return files.sort()
}

/**
 * Seal an already materialized release tree; no dependency resolution or installation occurs.
 * @param root - Owned staging tree containing helper, PTC and all runtime dependency files.
 * @param metadata - Exact version, source revision, protocol and entry coordinates.
 * @param executablePaths - Reviewed target executable paths; never inferred from the controller filesystem mode.
 * @returns SHA-256 to pin in the runtime installer configuration.
 */
export async function writeRuntimeManifest(
  root: string, metadata: Omit<RuntimeManifest, 'schemaVersion' | 'files'>, executablePaths: ReadonlySet<string> = new Set(),
): Promise<string> {
  if (!isAbsolute(root)) throw new Error('Artifact directory must be absolute')
  const files = await Promise.all((await inventory(root)).map(async (path) => {
    const filename = join(root, path)
    const bytes = await readFile(filename)
    return { path, size: bytes.length, sha256: sha256(bytes), executable: executablePaths.has(path) }
  }))
  if ([...executablePaths].some(path => !files.some(file => file.path === path))) throw new Error('Executable metadata names a missing file')
  const manifest = manifestSchema.parse({ ...metadata, schemaVersion: 1, files })
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  await writeFile(join(root, 'runtime-manifest.json'), bytes, { flag: 'wx' })
  return sha256(bytes)
}

/**
 * Reject stale, incomplete, linked or altered local artifact trees before opening SSH.
 * @param directory - Deployment-owned release directory.
 * @param expected - Explicitly pinned manifest digest.
 * @param limits - Transfer bounds.
 * @returns Validated immutable release description.
 */
export async function readRuntimeArtifact(directory: string, expected: string, limits: RuntimeLimits): Promise<RuntimeArtifact> {
  if (!isAbsolute(directory)) throw new Error('Artifact directory must be absolute')
  digest.parse(expected)
  const root = await realpath(directory)
  const manifestPath = join(root, 'runtime-manifest.json')
  const info = await lstat(manifestPath)
  if (!info.isFile() || info.size > limits.maxManifestBytes) throw new Error('Invalid runtime manifest file')
  const bytes = await readFile(manifestPath)
  if (sha256(bytes) !== expected) throw new Error('Runtime manifest SHA-256 mismatch')
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')))
  const paths = manifest.files.map(file => file.path)
  if (paths.length > limits.maxFiles || new Set(paths).size !== paths.length || paths.includes('runtime-manifest.json')) throw new Error('Invalid runtime file inventory')
  if (!paths.includes(manifest.helper) || !paths.includes(manifest.bootstrap) || !paths.includes('package.json')) throw new Error('Runtime helper, PTC and package manifest are required')
  if (JSON.stringify([...paths].sort()) !== JSON.stringify(await inventory(root))) throw new Error('Runtime file inventory differs from the release tree')
  let total = 0
  for (const file of manifest.files) {
    total += file.size
    if (file.size > limits.maxFileBytes || total > limits.maxTotalBytes) throw new Error('Runtime artifact exceeds transfer limits')
    const actual = await lstat(join(root, file.path))
    if (!actual.isFile() || actual.size !== file.size) throw new Error('Runtime file size differs from manifest')
    const content = await readFile(join(root, file.path))
    if (content.length !== file.size || sha256(content) !== file.sha256) throw new Error('Runtime file SHA-256 mismatch: ' + file.path)
  }
  return { root, manifest, bytes, generation: expected as RuntimeGeneration }
}
