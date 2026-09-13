import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadComputerScreenshot } from '../src/screenshot.ts'

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('loadComputerScreenshot', () => {
  it('loads canonical inline PNG data', async () => {
    await expect(loadComputerScreenshot({
      format: 'png', width: 2, height: 1, scale: 2, data: Buffer.from(PNG).toString('base64'),
    }, 100)).resolves.toEqual({ mediaType: 'image/png', data: PNG, width: 2, height: 1, scale: 2 })
    const unpaddedPng = Uint8Array.from([...PNG, 0])
    await expect(loadComputerScreenshot({
      format: 'png', width: 2, height: 1, scale: 1, data: Buffer.from(unpaddedPng).toString('base64'),
    }, 100)).resolves.toMatchObject({ data: unpaddedPng })
  })

  it('loads a bounded unexpired absolute PNG file', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-computer-screenshot-'))
    const path = join(root, 'shot.png')
    await writeFile(path, PNG)
    await expect(loadComputerScreenshot({
      format: 'png', width: 2, height: 1, scale: 1, path,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }, 100)).resolves.toMatchObject({ data: PNG })
  })

  it.each([
    [{ format: 'png', width: 1, height: 1, scale: 1 }, 100, 'inline data or a temporary path'],
    [{ format: 'png', width: 1, height: 1, scale: 1, data: '' }, 100, 'canonical padded base64'],
    [{ format: 'png', width: 1, height: 1, scale: 1, data: '!!!!' }, 100, 'canonical padded base64'],
    [{ format: 'png', width: 1, height: 1, scale: 1, data: Buffer.from(PNG).toString('base64') }, 2, 'byte limit'],
    [{ format: 'png', width: 1, height: 1, scale: 1, data: Buffer.from('not png').toString('base64') }, 100, 'not a PNG'],
  ] as const)('rejects invalid inline source %#', async (source, max, message) => {
    await expect(loadComputerScreenshot(source, max)).rejects.toThrow(message)
  })

  it('rejects invalid temporary paths, expiry, empty files, and oversized files', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-computer-screenshot-'))
    const textPath = join(root, 'shot.txt')
    await writeFile(textPath, PNG)
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: 'shot.png' }, 100))
      .rejects.toThrow(/absolute PNG path/)
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: textPath }, 100))
      .rejects.toThrow(/absolute PNG path/)
    const pngPath = join(root, 'shot.png')
    await writeFile(pngPath, new Uint8Array())
    await expect(loadComputerScreenshot({
      format: 'png', width: 1, height: 1, scale: 1, path: pngPath,
      expiresAt: new Date(Date.now() - 1).toISOString(),
    }, 100)).rejects.toThrow(/expired/)
    await expect(loadComputerScreenshot({
      format: 'png', width: 1, height: 1, scale: 1, path: pngPath, expiresAt: 'invalid',
    }, 100)).rejects.toThrow(/invalid expiry/)
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: pngPath }, 100))
      .rejects.toThrow(/empty/)
    await writeFile(pngPath, PNG)
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: pngPath }, 2))
      .rejects.toThrow(/byte limit/)
    const directoryPath = join(root, 'directory.png')
    await mkdir(directoryPath)
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: directoryPath }, 100))
      .rejects.toThrow(/regular file/)
    await writeFile(pngPath, Buffer.from('not png'))
    await expect(loadComputerScreenshot({ format: 'png', width: 1, height: 1, scale: 1, path: pngPath }, 100))
      .rejects.toThrow(/not a PNG/)
  })
})
