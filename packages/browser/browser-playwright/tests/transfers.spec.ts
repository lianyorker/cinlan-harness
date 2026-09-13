/** Native Browser transfer byte limits and safe filenames. */
import { Readable } from 'node:stream'
import type { Download } from 'playwright-core'
import { expect, it, vi } from 'vitest'
import { assertUploadName, downloadBytes, downloadName } from '../src/transfers.ts'

it('sanitizes download filenames and rejects unsafe upload basenames', () => {
  expect(downloadName('../../file.txt')).toBe('file.txt')
  expect(downloadName('CON.txt')).toBe('download.bin')
  expect(downloadName('a:b.txt')).toBe('a_b.txt')
  for (const name of ['../file.txt', 'a\\b', 'NUL', '', 'x'.repeat(181)]) { expect(() => { assertUploadName(name) }).toThrow() }
  expect(() => { assertUploadName('fixture.txt') }).not.toThrow()
})
it('reads exact bounded chunks and destroys oversized streams without returning partial bytes', async () => {
  const first = Readable.from([Buffer.from('hello'), Buffer.from(' world')])
  const download = { createReadStream: vi.fn(async () => first) } as unknown as Download
  expect(Buffer.from(await downloadBytes(download, 11, new AbortController().signal)).toString()).toBe('hello world')
  const second = Readable.from([Buffer.alloc(5), Buffer.alloc(6)])
  const oversized = { createReadStream: vi.fn(async () => second) } as unknown as Download
  await expect(downloadBytes(oversized, 10, new AbortController().signal)).rejects.toMatchObject({ code: 'BROWSER_TRANSFER_TOO_LARGE' })
  expect(second.destroyed).toBe(true)
})
it('rejects canceled reads before accessing download bytes', async () => {
  const createReadStream = vi.fn()
  const signal = AbortSignal.abort(new Error('cancelled'))
  await expect(downloadBytes({ createReadStream } as unknown as Download, 10, signal)).rejects.toThrow('cancelled')
  expect(createReadStream).not.toHaveBeenCalled()
})

it('settles a canceled active stream before returning', async () => {
  const started = Promise.withResolvers<undefined>()
  const stream = new Readable({ read() { started.resolve(undefined) } })
  const download = { createReadStream: async () => stream } as unknown as Download
  const controller = new AbortController()
  const reading = downloadBytes(download, 10, controller.signal)
  await started.promise
  controller.abort(new Error('cancelled'))
  await expect(reading).rejects.toThrow()
  expect(stream.closed).toBe(true)
})
