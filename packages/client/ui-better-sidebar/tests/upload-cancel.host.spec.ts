/** Upload cancellation at the real file stream's flush/rename commit point. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { writeWorkspaceUpload } from '../src/fs-operations.ts'

const flush = vi.hoisted(() => ({ reached: false, abort: (): void => {} }))
// The real disk stream owns writes and close; only the cancellation timing is controlled.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, createWriteStream: (...args: Parameters<typeof fs.createWriteStream>) => {
    const stream = fs.createWriteStream(...args)
    stream.once('finish', () => { flush.reached = true; flush.abort() })
    return stream
  } }
})

describe('upload precommit cancellation', () => {
  it('preserves the old target and removes the temporary file when the final flush aborts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-sidebar-upload-flush-'))
    const lifetime = new AbortController()
    flush.reached = false
    flush.abort = () => { lifetime.abort() }
    onTestFinished(async () => {
      flush.abort = () => {}
      await rm(root, { recursive: true, force: true })
    })
    const target = join(root, 'keep.txt')
    await writeFile(target, 'original')
    const chunks = { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode('replacement') } }
    await expect(writeWorkspaceUpload({
      cwd: root, dir: root, relativePath: 'keep.txt', chunks, limit: 100, signal: lifetime.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(flush.reached).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('original')
    expect(await readdir(root)).toEqual(['keep.txt'])
  })
})
