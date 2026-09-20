import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { extractResourceArchive, parseReleaseManifest, validateResourceDirectory, verifyResourceFiles } from '../src/resource-files.ts'

const signal = new AbortController().signal
const limits = { maxExpandedBytes: 1024 * 1024, maxFiles: 100 }
const skill = '---\nname: example\ndescription: A valid skill\n---\nBody\n'
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true, maxRetries: 3 })))
})

async function staging(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'resource-files-'))
  roots.push(root)
  return root
}

async function put(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), contents)
}

function sha(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function releaseFixture(contents: Record<string, string> = { 'skills/example/SKILL.md': skill }) {
  const files = Object.entries(contents).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, data]) => ({ path, sha256: sha(data), bytes: Buffer.byteLength(data) }))
  const contentSha256 = sha(JSON.stringify(files))
  const archive = zipSync(Object.fromEntries(Object.entries(contents).map(([path, data]) => [path, strToU8(data)])))
  const manifest = {
    schemaVersion: 1, id: 'security-skills', version: '1-' + contentSha256.slice(0, 16), contentSha256,
    archive: { format: 'zip', fileName: 'resources.zip', url: 'https://example.test/resources.zip', bytes: archive.length, sha256: sha(archive) },
    platforms: ['win32', 'darwin', 'linux'], fileCount: files.length, skillCount: 1, files,
    skills: [{ name: 'example', path: 'skills/example/SKILL.md' }], license: {}, provenance: {},
  }
  return { archive, manifest }
}

function centralOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(bytes.length - 6, true)
}

function patchEntry(bytes: Uint8Array, local: number, central: number, value: number): Uint8Array {
  const result = bytes.slice()
  const view = new DataView(result.buffer)
  view.setUint32(local, value, true)
  view.setUint32(centralOffset(result) + central, value, true)
  return result
}

describe('release manifest validation', () => {
  it('returns the flattened release with complete inventories', () => {
    const { manifest } = releaseFixture()
    const parsed = parseReleaseManifest(manifest, 'https://example.test/release.json')
    expect(parsed).toEqual({ version: manifest.version, archiveUrl: manifest.archive.url, bytes: manifest.archive.bytes,
      sha256: manifest.archive.sha256, contentSha256: manifest.contentSha256, fileCount: 1, skillCount: 1,
      files: manifest.files, skills: manifest.skills })
  })

  it.each(['http://localhost:8000/release.zip', 'http://127.0.0.1/release.zip', 'http://[::1]/release.zip'])(
    'accepts loopback HTTP at %s', (url) => {
      const { manifest } = releaseFixture()
      manifest.archive.url = url
      expect(parseReleaseManifest(manifest, 'http://localhost/release.json').archiveUrl).toBe(url)
    })

  it.each([
    ['schemaVersion', 2], ['id', 'other'], ['version', ' '], ['contentSha256', '0'],
    ['fileCount', 0], ['skillCount', 1.5], ['files', []], ['skills', []], ['platforms', ['win32']],
    ['license', null], ['provenance', []],
  ])('rejects invalid %s', (key, value) => {
    const { manifest } = releaseFixture()
    expect(() => parseReleaseManifest({ ...manifest, [key]: value }, 'https://example.test/release.json')).toThrow()
  })

  it.each([
    ['format', 'tar'], ['bytes', 0], ['bytes', Number.MAX_SAFE_INTEGER + 1], ['sha256', 'g'.repeat(64)],
    ['url', 'relative.zip'], ['url', 'https:example.test/a.zip'], ['url', ' https://example.test/a.zip'],
    ['url', 'file:///tmp/archive.zip'], ['url', 'http://example.test/a.zip'],
    ['url', 'https://user:password@example.test/a.zip'], ['url', 'https://example.test/a.zip#fragment'],
    ['fileName', '../escape.zip'],
  ])('rejects invalid archive %s', (key, value) => {
    const { manifest } = releaseFixture()
    expect(() => parseReleaseManifest({ ...manifest, archive: { ...manifest.archive, [key]: value } }, 'https://example.test/release.json')).toThrow()
  })

  it('requires every field and refuses an invalid manifest URL', () => {
    const { manifest } = releaseFixture()
    for (const key of Object.keys(manifest)) {
      const value = Object.fromEntries(Object.entries(manifest).filter(([field]) => field !== key))
      expect(() => parseReleaseManifest(value, 'https://example.test/release.json')).toThrow()
    }
    expect(() => parseReleaseManifest(manifest, 'relative.json')).toThrow()
    expect(() => parseReleaseManifest(null, 'https://example.test/release.json')).toThrow()
  })

  it('rejects inventory paths, duplicate skills and omitted skills', () => {
    const { manifest } = releaseFixture()
    for (const path of ['../SKILL.md', 'other/SKILL.md', 'skills/CON/SKILL.md']) {
      expect(() => parseReleaseManifest({ ...manifest, files: [{ ...manifest.files[0], path }] }, 'https://example.test/release.json')).toThrow()
    }
    expect(() => parseReleaseManifest({ ...manifest, fileCount: 2, files: [...manifest.files, ...manifest.files] }, 'https://example.test/release.json')).toThrow(/colliding/)
    expect(() => parseReleaseManifest({ ...manifest, skillCount: 2, skills: [...manifest.skills, ...manifest.skills] }, 'https://example.test/release.json')).toThrow(/duplicate/)
    expect(() => parseReleaseManifest({ ...manifest, skills: [{ name: 'other', path: 'skills/unknown/SKILL.md' }] }, 'https://example.test/release.json')).toThrow()
  })
})

describe('ZIP extraction', () => {
  it.each([0, 6] as const)('extracts stored/deflate ZIP method level %s and preserves resources', async (level) => {
    const root = await staging()
    const archive = zipSync({ 'skills/': [new Uint8Array(), { attrs: 0x10 }], 'skills/example/SKILL.md': strToU8(skill),
      'skills/example/reference.txt': strToU8('reference'), LICENSE: strToU8('license') }, { level })
    await extractResourceArchive(archive, root, limits, signal)
    expect(await readFile(join(root, 'skills/example/SKILL.md'), 'utf8')).toBe(skill)
    expect(await readFile(join(root, 'LICENSE'), 'utf8')).toBe('license')
    expect(await validateResourceDirectory(root, signal)).toEqual({ skillCount: 1 })
  })

  it.each(['../escape', '/absolute', 'C:/drive', 'skills/../escape', 'skills\\escape', 'skills/x\0y',
    'skills/x:stream', 'skills/CON.txt', 'skills/LPT1', 'skills/trailing.', 'skills/trailing ',
    'skills//empty', './dot', 'skills/a?b', 'skills/COM¹.txt', 'skills/CONIN$', 'skills/CON .txt'])(
    'rejects unsafe ZIP path %s before writing', async (path) => {
      const root = await staging()
      const archive = zipSync({ 'safe.txt': strToU8('safe'), [path]: strToU8('bad') })
      await expect(extractResourceArchive(archive, root, limits, signal)).rejects.toThrow(/path/)
      expect(await readdir(root)).toEqual([])
    })

  it.each([0xa000, 0x1000, 0x2000, 0x6000, 0xc000])('rejects Unix special file type %s', async (type) => {
    const root = await staging()
    const archive = zipSync({ 'skills/link': [strToU8('../outside'), { os: 3, attrs: (type << 16) >>> 0 }] })
    await expect(extractResourceArchive(archive, root, limits, signal)).rejects.toThrow(/special files/)
    expect(await readdir(root)).toEqual([])
  })

  it.each([['A', 'a'], ['a', 'a/b'], ['A/x', 'a/y']])('rejects case and parent collisions %s / %s', async (a, b) => {
    const root = await staging()
    await expect(extractResourceArchive(zipSync({ [a]: strToU8('a'), [b]: strToU8('b') }), root, limits, signal)).rejects.toThrow(/colliding/)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects duplicate local and central filenames', async () => {
    const root = await staging()
    const archive = zipSync({ a: strToU8('a'), b: strToU8('b') }, { level: 0 })
    const view = new DataView(archive.buffer)
    const central = centralOffset(archive)
    const second = central + 47
    archive[view.getUint32(second + 42, true) + 30] = 97
    archive[second + 46] = 97
    await expect(extractResourceArchive(archive, root, limits, signal)).rejects.toThrow(/colliding/)
    expect(await readdir(root)).toEqual([])
  })

  it('preflights aggregate expanded bytes and entry counts', async () => {
    const root = await staging()
    const archive = zipSync({ a: strToU8('aa'), b: strToU8('bb') })
    await expect(extractResourceArchive(archive, root, { maxExpandedBytes: 3, maxFiles: 2 }, signal)).rejects.toThrow(/maxExpandedBytes/)
    await expect(extractResourceArchive(archive, root, { maxExpandedBytes: 4, maxFiles: 1 }, signal)).rejects.toThrow(/maxFiles/)
    expect(await readdir(root)).toEqual([])
    await extractResourceArchive(archive, root, { maxExpandedBytes: 4, maxFiles: 2 }, signal)
    expect(await readFile(join(root, 'a'), 'utf8')).toBe('aa')
  })

  it('bounds inflation even when local and central expanded sizes lie', async () => {
    const root = await staging()
    const archive = patchEntry(zipSync({ bomb: new Uint8Array(2 * 1024 * 1024) }), 22, 24, 1)
    await expect(extractResourceArchive(archive, root, { maxExpandedBytes: 1, maxFiles: 1 }, signal)).rejects.toThrow(/declared size/)
    expect(await readdir(root)).toEqual([])
  })

  it('rejects local metadata disagreement, CRC mismatch and malformed archives', async () => {
    const root = await staging()
    const archive = zipSync({ file: strToU8('bytes') }, { level: 0 })
    const inconsistent = archive.slice()
    inconsistent[30] = 120
    await expect(extractResourceArchive(inconsistent, root, limits, signal)).rejects.toThrow(/metadata/)
    await expect(extractResourceArchive(patchEntry(archive, 14, 16, 0), root, limits, signal)).rejects.toThrow(/CRC/)
    for (const malformed of [new Uint8Array(), archive.subarray(0, 40)]) {
      await expect(extractResourceArchive(malformed, root, limits, signal)).rejects.toThrow(/ZIP/)
    }
    expect(await readdir(root)).toEqual([])
  })

  it.each([['encrypted', 8, 1], ['unsupported compression', 10, 99], ['split archive', 34, 1],
    ['ZIP64 extra', 24, 0xffff], ['reparse point', 38, 0x400]])('rejects %s metadata before writing', async (_label, field, value) => {
    const root = await staging()
    const archive = zipSync({ file: strToU8('bytes') })
    const view = new DataView(archive.buffer)
    view.setUint16(centralOffset(archive) + field, value, true)
    await expect(extractResourceArchive(archive, root, { ...limits, maxExpandedBytes: 10 }, signal)).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
  })

  it('accepts validated signed data descriptors and rejects altered descriptor sizes', async () => {
    const root = await staging()
    const original = zipSync({ file: strToU8('bytes') })
    const central = centralOffset(original)
    const archive = new Uint8Array(original.length + 16)
    archive.set(original.subarray(0, central))
    archive.set(original.subarray(central), central + 16)
    const view = new DataView(archive.buffer)
    const originalView = new DataView(original.buffer)
    view.setUint16(6, 8, true)
    view.setUint16(central + 16 + 8, 8, true)
    view.setUint32(central, 0x08074b50, true)
    for (let i = 0; i < 3; i++) view.setUint32(central + 4 + i * 4, originalView.getUint32(14 + i * 4, true), true)
    view.setUint32(archive.length - 6, central + 16, true)
    await extractResourceArchive(archive, root, limits, signal)
    expect(await readFile(join(root, 'file'), 'utf8')).toBe('bytes')
    const other = await staging()
    view.setUint32(central + 12, 99, true)
    await expect(extractResourceArchive(archive, other, limits, signal)).rejects.toThrow(/descriptor/)
    expect(await readdir(other)).toEqual([])
  })

  it('refuses preexisting destination content and already cancelled work', async () => {
    const root = await staging()
    await put(root, 'sentinel', 'unchanged')
    const { archive } = releaseFixture()
    await expect(extractResourceArchive(archive, root, limits, signal)).rejects.toThrow(/empty/)
    const stopped = AbortSignal.abort(new Error('cancelled'))
    await expect(extractResourceArchive(archive, root, limits, stopped)).rejects.toThrow('cancelled')
    expect(await readFile(join(root, 'sentinel'), 'utf8')).toBe('unchanged')
  })
})

describe('strict resource validation', () => {
  it.each(['No frontmatter', '---\nname: example\n---\n', '---\nname: example\ndescription: " "\n---\n',
    '---\nname: 1\ndescription: text\n---\n', '---\nname: example\nname: duplicate\ndescription: text\n---\n',
    '---\n- name\n- description\n---\n', '---\nname: !unknown example\ndescription: text\n---\n',
    '---\nname: example\ndescription: text\ndisable-model-invocation: "false"\n---\n',
    '---\nname: example\ndescription: text\nmodelInvocable: false\n---\n'])(
    'rejects malformed frontmatter %j', async (content) => {
      const root = await staging()
      await put(root, 'skills/example/SKILL.md', content)
      await expect(validateResourceDirectory(root, signal)).rejects.toThrow()
    })

  it('requires skills/ and rejects empty inventories or duplicate names', async () => {
    const root = await staging()
    await expect(validateResourceDirectory(root, signal)).rejects.toThrow()
    await mkdir(join(root, 'skills'))
    await expect(validateResourceDirectory(root, signal)).rejects.toThrow(/at least one/)
    await put(root, 'skills/a/SKILL.md', skill)
    await put(root, 'skills/b/SKILL.md', skill)
    await expect(validateResourceDirectory(root, signal)).rejects.toThrow(/Duplicate/)
  })

  it('rejects junctions anywhere in the resource tree without traversing their targets', async () => {
    const root = await staging()
    const outside = await staging()
    await put(root, 'skills/example/SKILL.md', skill)
    await put(outside, 'sentinel', 'untouched')
    const link = join(root, 'linked')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      await expect(validateResourceDirectory(root, signal)).rejects.toThrow(/symlinks/)
      await expect(extractResourceArchive(releaseFixture().archive, link, limits, signal)).rejects.toThrow(/real directory/)
      expect(await readFile(join(outside, 'sentinel'), 'utf8')).toBe('untouched')
    } finally {
      await unlink(link)
    }
  })

  it('checks exact inventory SHA-256, lengths, aggregate hash and declared skill names', async () => {
    const root = await staging()
    const { archive, manifest } = releaseFixture({ 'skills/example/SKILL.md': skill, LICENSE: 'license', NOTICE: 'notice' })
    const release = parseReleaseManifest(manifest, 'https://example.test/release.json')
    await extractResourceArchive(archive, root, limits, signal)
    await expect(verifyResourceFiles(root, release, signal)).resolves.toBeUndefined()
    await expect(verifyResourceFiles(root, { ...release, contentSha256: '0'.repeat(64) }, signal)).rejects.toThrow(/content SHA/)
    await expect(verifyResourceFiles(root, { ...release, skills: [{ name: 'different', path: 'skills/example/SKILL.md' }] }, signal)).rejects.toThrow(/skill name/)
    await writeFile(join(root, 'NOTICE'), 'noticE')
    await expect(verifyResourceFiles(root, release, signal)).rejects.toThrow(/SHA-256/)
    await writeFile(join(root, 'NOTICE'), 'notice extra')
    await expect(verifyResourceFiles(root, release, signal)).rejects.toThrow(/length/)
    await put(root, 'skills/unlisted.txt', 'unlisted')
    await expect(verifyResourceFiles(root, release, signal)).rejects.toThrow(/count/)
    await expect(validateResourceDirectory(root, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
  })
})
