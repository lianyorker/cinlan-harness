/** Complete archive byte and digest validation precedes extraction. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { fetch, Response } from 'undici'
import { catalog } from '../src/catalog.ts'
import { downloadArchive } from '../src/download.ts'
vi.mock('undici', async importOriginal => ({ ...await importOriginal<typeof import('undici')>(), fetch: vi.fn() }))
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); vi.restoreAllMocks() })
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'dsh-mobile-download-')); roots.push(path)
  const bytes = Buffer.from('pinned complete archive')
  const definition = { ...catalog.scrcpy, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  return { path: join(path, 'download.zip'), bytes, definition }
}
it('writes exact complete bytes and reports numeric progress only after each write', async () => {
  const f = await fixture(); const progress = vi.fn()
  vi.mocked(fetch).mockResolvedValue(new Response(f.bytes))
  await downloadArchive(f.definition, f.path, '', new AbortController().signal, progress)
  expect(await readFile(f.path)).toEqual(f.bytes)
  expect(progress).toHaveBeenLastCalledWith(f.bytes.length)
})
it.each(['overflow', 'truncated', 'digest'])('rejects %s without admitting an unverified archive', async (kind) => {
  const f = await fixture()
  const body = kind === 'overflow' ? Buffer.concat([f.bytes, Buffer.from('extra')])
    : kind === 'truncated' ? f.bytes.subarray(1) : Buffer.alloc(f.bytes.length, 97)
  vi.mocked(fetch).mockResolvedValue(new Response(body))
  await expect(downloadArchive(f.definition, f.path, '', new AbortController().signal, () => {})).rejects.toThrow(/limit|checksum/)
})
it('rejects mismatched declared size before creating the output file', async () => {
  const f = await fixture()
  vi.mocked(fetch).mockResolvedValue(new Response(f.bytes, { headers: { 'content-length': '999' } }))
  await expect(downloadArchive(f.definition, f.path, '', new AbortController().signal, () => {})).rejects.toThrow('size')
  await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' })
})
