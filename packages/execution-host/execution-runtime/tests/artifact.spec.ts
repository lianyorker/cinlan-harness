/** Materialized-release inventory, sealing, and pinned verification edges. */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { readRuntimeArtifact, sha256, writeRuntimeManifest } from '../src/artifact.ts'
import type { RuntimeLimits, RuntimeManifest } from '../src/types.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

const LIMITS: RuntimeLimits = {
  operationTimeoutMs: 60_000,
  shutdownTimeoutMs: 5_000,
  maxResponseBytes: 64 * 1024,
  maxManifestBytes: 64 * 1024,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxFiles: 64,
}

const METADATA = {
  version: '1.0.0',
  sourceCommit: 'a'.repeat(40),
  protocol: 1,
  platform: 'linux',
  arch: 'x64',
  helper: 'helper.js',
  bootstrap: 'process.js',
} as const

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-artifact-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  return root
}

async function put(root: string, path: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

/** Seal a minimal valid release and return its pinned digest. */
async function seal(root: string): Promise<string> {
  await put(root, 'helper.js', 'helper')
  await put(root, 'process.js', 'bootstrap')
  await put(root, 'package.json', '{"name":"runtime-fixture"}')
  return writeRuntimeManifest(root, METADATA)
}

/** Rewrite the sealed manifest with edited entries and return its new digest. */
async function tamper(root: string, edit: (manifest: RuntimeManifest) => RuntimeManifest): Promise<string> {
  const file = join(root, 'runtime-manifest.json')
  const manifest = edit(JSON.parse(await readFile(file, 'utf8')) as RuntimeManifest)
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  await writeFile(file, bytes)
  return sha256(bytes)
}

it('seals a materialized release and verifies it end to end', async () => {
  const root = await fixtureRoot()
  const expected = await seal(root)
  const artifact = await readRuntimeArtifact(root, expected, LIMITS)
  expect(artifact.generation).toBe(expected)
  expect(artifact.manifest.helper).toBe('helper.js')
  expect(artifact.manifest.files.map(file => file.path).sort()).toEqual(['helper.js', 'package.json', 'process.js'])
})

it('rejects non-absolute sealing and reading roots', async () => {
  await expect(writeRuntimeManifest('relative/tree', METADATA)).rejects.toThrow(/absolute/)
  await expect(readRuntimeArtifact('relative/tree', 'a'.repeat(64), LIMITS)).rejects.toThrow(/absolute/)
})

it('rejects executable metadata naming a file outside the sealed tree', async () => {
  const root = await fixtureRoot()
  await put(root, 'helper.js', 'helper')
  await expect(writeRuntimeManifest(root, METADATA, new Set(['helper.js', 'missing.js'])))
    .rejects.toThrow(/missing file/)
})

it('rejects a stale or oversized manifest file', async () => {
  const root = await fixtureRoot()
  const expected = await seal(root)
  await expect(readRuntimeArtifact(root, expected, { ...LIMITS, maxManifestBytes: 1 }))
    .rejects.toThrow(/Invalid runtime manifest/)
  const empty = await fixtureRoot()
  await expect(readRuntimeArtifact(empty, 'a'.repeat(64), LIMITS)).rejects.toThrow()
})

it('rejects a pinned digest that does not match the sealed manifest', async () => {
  const root = await fixtureRoot()
  await seal(root)
  await expect(readRuntimeArtifact(root, 'b'.repeat(64), LIMITS)).rejects.toThrow(/SHA-256 mismatch/)
})

it('rejects inventories that exceed the cap, repeat a path, or name the manifest', async () => {
  const root = await fixtureRoot()
  await seal(root)

  const capped = await tamper(root, manifest => ({
    ...manifest,
    files: [...manifest.files, manifest.files[0]!],
  }))
  await expect(readRuntimeArtifact(root, capped, { ...LIMITS, maxFiles: 1 }))
    .rejects.toThrow(/Invalid runtime file inventory/)

  const duplicated = await tamper(root, manifest => ({
    ...manifest,
    files: [manifest.files[0]!, manifest.files[0]!, manifest.files[1]!, manifest.files[2]!],
  }))
  await expect(readRuntimeArtifact(root, duplicated, LIMITS)).rejects.toThrow(/Invalid runtime file inventory/)

  const selfListed = await tamper(root, manifest => ({
    ...manifest,
    files: [...manifest.files, { path: 'runtime-manifest.json', size: 1, sha256: 'a'.repeat(64), executable: false }],
  }))
  await expect(readRuntimeArtifact(root, selfListed, LIMITS)).rejects.toThrow(/Invalid runtime file inventory/)
})

it('rejects releases missing the helper, PTC, or package manifest', async () => {
  const root = await fixtureRoot()
  await put(root, 'helper.js', 'helper')
  await put(root, 'process.js', 'bootstrap')
  await writeRuntimeManifest(root, METADATA)
  const expected = sha256(await readFile(join(root, 'runtime-manifest.json')))
  await expect(readRuntimeArtifact(root, expected, LIMITS)).rejects.toThrow(/required/)
})

it('rejects a tree that differs from the sealed inventory', async () => {
  const root = await fixtureRoot()
  const expected = await seal(root)
  await put(root, 'stray.txt', 'added after sealing')
  await expect(readRuntimeArtifact(root, expected, LIMITS)).rejects.toThrow(/differs from the release tree/)
})

it('rejects single-file and cumulative transfers over the limits', async () => {
  const root = await fixtureRoot()
  const expected = await seal(root)
  await expect(readRuntimeArtifact(root, expected, { ...LIMITS, maxFileBytes: 1 }))
    .rejects.toThrow(/exceeds transfer limits/)
  await expect(readRuntimeArtifact(root, expected, { ...LIMITS, maxTotalBytes: 2 }))
    .rejects.toThrow(/exceeds transfer limits/)
})

it('rejects a file whose live size or content no longer matches the manifest', async () => {
  const root = await fixtureRoot()
  const expected = await seal(root)
  await writeFile(join(root, 'helper.js'), 'longer-content')
  await expect(readRuntimeArtifact(root, expected, LIMITS)).rejects.toThrow(/size differs/)

  const root2 = await fixtureRoot()
  const expected2 = await seal(root2)
  await writeFile(join(root2, 'helper.js'), 'XXLPER')
  await expect(readRuntimeArtifact(root2, expected2, LIMITS)).rejects.toThrow(/SHA-256 mismatch: helper\.js/)
})

it('rejects non-regular entries inside a release tree', async () => {
  const root = await fixtureRoot()
  await put(root, 'helper.js', 'helper')
  const special = { name: 'pipe', isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false } as never
  vi.mocked(readdir).mockResolvedValueOnce([special])
  await expect(writeRuntimeManifest(root, METADATA)).rejects.toThrow(/regular files and directories/)
})
