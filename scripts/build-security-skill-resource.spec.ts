/** Resource packing verifies delivered bytes and rejects unsafe inputs in isolated temporary roots. */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { assertResourcePath, buildSecuritySkillResource, collectResourceInventory } from './build-security-skill-resource.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'security-resource-'))
  roots.push(root)
  const sourceRoot = join(root, 'skills')
  await mkdir(sourceRoot)
  await writeFile(join(sourceRoot, 'SKILL.md'), '---\nname: security-test\ndescription: Local resource fixture.\n---\n# Fixture\n')
  const licensePath = join(root, 'LICENSE')
  const noticePath = join(root, 'NOTICE')
  const provenancePath = join(root, 'provenance.json')
  await writeFile(licensePath, 'MIT\n')
  await writeFile(noticePath, 'Local fixture notice\n')
  await writeFile(provenancePath, JSON.stringify({ source: 'fixture', license: { declared: 'MIT' }, audit: { skillCount: 1 } }))
  return { sourceRoot, licensePath, noticePath, provenancePath, outputDirectory: join(root, 'output') }
}

function hash(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex') }

describe('security skill resource builder', () => {
  it('delivers the exact enumerated files with independently verifiable content and archive hashes', async () => {
    const options = await fixture()
    const result = await buildSecuritySkillResource(options)
    const archive = await readFile(result.archivePath)
    const entries = unzipSync(archive)
    expect(Object.keys(entries)).toEqual(result.manifest.files.map(file => file.path))
    expect(Object.keys(entries)).toEqual(['LICENSE', 'NOTICE', 'skills/SKILL.md'])
    for (const file of result.manifest.files) {
      expect(hash(entries[file.path]!)).toBe(file.sha256)
      expect(entries[file.path]!.length).toBe(file.bytes)
    }
    expect(hash(archive)).toBe(result.manifest.archive.sha256)
    expect(archive.length).toBe(result.manifest.archive.bytes)
    expect(hash(JSON.stringify(result.manifest.files))).toBe(result.manifest.contentSha256)
    expect(result.manifest.version).toBe(`1-${result.manifest.contentSha256.slice(0, 16)}`)
    expect(result.manifest.archive).not.toHaveProperty('url')
    expect(result.manifest.skills).toEqual([{ name: 'security-test', path: 'skills/SKILL.md' }])
    expect(JSON.parse(await readFile(result.manifestPath, 'utf8'))).toEqual(result.manifest)
  })

  it('ignores filesystem times and normalizes checkout line endings while keeping build outputs deterministic', async () => {
    const options = await fixture()
    const first = await buildSecuritySkillResource(options)
    const firstBytes = await readFile(first.archivePath)
    const path = join(options.sourceRoot, 'SKILL.md')
    await writeFile(path, (await readFile(path, 'utf8')).replace(/\n/g, '\r\n'))
    await utimes(path, new Date(0), new Date(0))
    const second = await buildSecuritySkillResource({ ...options, outputDirectory: join(options.outputDirectory, 'second') })
    expect(await readFile(second.archivePath)).toEqual(firstBytes)
    expect(second.manifest).toEqual(first.manifest)
    await writeFile(options.noticePath, 'Changed notice\n')
    expect((await buildSecuritySkillResource(options)).manifest.version).not.toBe(first.manifest.version)
  })

  it('retains an explicit transport address without changing the archive identity', async () => {
    const options = await fixture()
    const local = await buildSecuritySkillResource(options)
    const published = await buildSecuritySkillResource({ ...options, archiveUrl: 'http://127.0.0.1:12345/resource.zip' })
    expect(published.manifest.archive.url).toBe('http://127.0.0.1:12345/resource.zip')
    expect(published.manifest.archive.sha256).toBe(local.manifest.archive.sha256)
    for (const archiveUrl of ['https://user:secret@example.test/a.zip', 'http://example.test/a.zip', 'file:///tmp/a.zip', 'https://example.test/a.zip?token=secret']) {
      await expect(buildSecuritySkillResource({ ...options, archiveUrl })).rejects.toThrow('Archive URL')
    }
  })

  it('omits repository metadata without activating external-client marketplace entries', async () => {
    const options = await fixture()
    await writeFile(join(options.sourceRoot, '.gitkeep'), '')
    await mkdir(join(options.sourceRoot, '.claude-plugin'))
    await writeFile(join(options.sourceRoot, '.claude-plugin/marketplace.json'), '{}')
    expect((await collectResourceInventory(options.sourceRoot)).files.map(file => file.path)).toEqual(['skills/SKILL.md'])
  })

  it('rejects credential files, unknown formats, malformed skills and duplicate identities', async () => {
    const options = await fixture()
    for (const [name, content] of [['.env', 'TOKEN=redacted'], ['payload.exe', 'binary'], ['key.txt', '-----BEGIN PRIVATE KEY-----']]) {
      const path = join(options.sourceRoot, name!)
      await writeFile(path, content!)
      await expect(collectResourceInventory(options.sourceRoot)).rejects.toThrow()
      await rm(path)
    }
    await mkdir(join(options.sourceRoot, 'other'))
    await writeFile(join(options.sourceRoot, 'other/SKILL.md'), await readFile(join(options.sourceRoot, 'SKILL.md')))
    await expect(collectResourceInventory(options.sourceRoot)).rejects.toThrow('Duplicate')
    await writeFile(join(options.sourceRoot, 'other/SKILL.md'), '# Missing metadata')
    await expect(collectResourceInventory(options.sourceRoot)).rejects.toThrow('frontmatter')
  })

  it('rejects linked directories and output paths inside the source', async () => {
    const options = await fixture()
    await expect(buildSecuritySkillResource({ ...options, outputDirectory: join(options.sourceRoot, 'out') })).rejects.toThrow('outside')
    const target = join(options.outputDirectory, 'target')
    await mkdir(target, { recursive: true })
    await symlink(target, join(options.sourceRoot, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(collectResourceInventory(options.sourceRoot)).rejects.toThrow('links')
  })

  it('serves the configured descriptor and verified ZIP through a real controlled HTTP transport', async () => {
    const options = await fixture()
    let descriptor = ''
    let archive = Buffer.alloc(0)
    const server = createServer((request, response) => {
      response.setHeader('Content-Type', request.url === '/resource.zip' ? 'application/zip' : 'application/json')
      response.end(request.url === '/resource.zip' ? archive : descriptor)
    })
    try {
      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('Expected loopback TCP address')
      const base = `http://127.0.0.1:${address.port}`
      const built = await buildSecuritySkillResource({ ...options, archiveUrl: `${base}/resource.zip` })
      descriptor = await readFile(built.manifestPath, 'utf8')
      archive = await readFile(built.archivePath)
      const response = await fetch(`${base}/manifest.json`)
      expect(response.ok).toBe(true)
      const delivered = await response.json() as typeof built.manifest
      const bytes = new Uint8Array(await (await fetch(delivered.archive.url!)).arrayBuffer())
      expect(hash(bytes)).toBe(delivered.archive.sha256)
      expect(bytes.length).toBe(delivered.archive.bytes)
      expect(Object.keys(unzipSync(bytes))).toContain('skills/SKILL.md')
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => { server.close((error) => { if (error) reject(error); else resolve() }) })
    }
  })

  it('rejects traversal and Windows-unsafe names in portable archives', () => {
    for (const path of ['../escape', '/absolute', 'skills/../escape', 'skills/a:b', 'skills/CON', 'skills/a.', 'skills/a\\b']) {
      expect(() => { assertResourcePath(path) }).toThrow('Unsafe')
    }
    expect(() => { assertResourcePath('skills/知识库/参考.md') }).not.toThrow()
  })
})
