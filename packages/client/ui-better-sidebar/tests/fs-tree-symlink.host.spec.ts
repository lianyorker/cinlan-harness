/// <reference types="node" />
/**
 * fs-tree symlink listing: the explorer must show a symlink as what it
 * points at (a symlink to a directory expands like a directory) and flag
 * links whose target is missing. The host listing keeps the probe cheap:
 * only entries that are actually symlinks are stat'ed.
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listDirectory } from '../src/fs-tree.ts'

/** Create a directory link using the Windows junction form when required. */
function symlinkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Some Windows runners permit creating junctions but do not permit traversing
 * them from the test process; skip only when the capability probe cannot follow
 * a directory link.
 */
const canSymlink = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-symlink-probe-'))
  try {
    const target = join(dir, 'target')
    mkdirSync(target)
    symlinkDirectory(target, join(dir, 'link'))
    return statSync(join(dir, 'link')).isDirectory()
  } catch {
    return false
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

/** File symlinks require a separate Windows privilege from directory junctions. */
const canSymlinkFile = process.platform !== 'win32' || (() => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-file-link-probe-'))
  try {
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'fixture')
    symlinkSync(target, join(dir, 'link.txt'), 'file')
    return statSync(join(dir, 'link.txt')).isFile()
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error
      && (error.code === 'EPERM' || error.code === 'EACCES')) return false
    throw error
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})()

/** A scratch level with real entries plus three symlinks (dir/file/dangling). */
function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-symlink-'))
  mkdirSync(join(dir, 'real-dir'))
  writeFileSync(join(dir, 'real-file.txt'), 'content')
  symlinkDirectory(join(dir, 'real-dir'), join(dir, 'link-to-dir'))
  if (canSymlinkFile) symlinkSync(join(dir, 'real-file.txt'), join(dir, 'link-to-file'))
  symlinkDirectory(join(dir, 'missing-target'), join(dir, 'broken-link'))
  return dir
}

describe.skipIf(!canSymlink)('fs-tree symlink listing', () => {
  it('reports a symlink to a directory as an expandable directory', async () => {
    const dir = makeFixture()
    try {
      const listing = await listDirectory(dir)
      const row = listing.entries.find(entry => entry.name === 'link-to-dir')
      expect(row).toMatchObject({ isDir: true, isSymlink: true, broken: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!canSymlinkFile)('reports a symlink to a file as a file with a link badge', async () => {
    const dir = makeFixture()
    try {
      const listing = await listDirectory(dir)
      const row = listing.entries.find(entry => entry.name === 'link-to-file')
      expect(row).toMatchObject({ isDir: false, isSymlink: true, broken: false })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('flags a dangling symlink as broken', async () => {
    const dir = makeFixture()
    try {
      const listing = await listDirectory(dir)
      const row = listing.entries.find(entry => entry.name === 'broken-link')
      expect(row).toMatchObject({ isDir: false, isSymlink: true, broken: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves regular entries unmarked and sorts symlinked dirs with the directories', async () => {
    const dir = makeFixture()
    try {
      const listing = await listDirectory(dir)
      const realDir = listing.entries.find(entry => entry.name === 'real-dir')
      const realFile = listing.entries.find(entry => entry.name === 'real-file.txt')
      expect(realDir).toMatchObject({ isDir: true, isSymlink: false, broken: false })
      expect(realFile).toMatchObject({ isDir: false, isSymlink: false, broken: false })
      // Directory-first ordering counts a symlinked directory as a directory.
      const dirs = listing.entries.filter(entry => entry.isDir).map(entry => entry.name)
      expect(dirs).toEqual(['link-to-dir', 'real-dir'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it.skipIf(!canSymlinkFile)('classifies every row correctly across a symlink-heavy level (bounded probe)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-sidebar-symlink-many-'))
    mkdirSync(join(dir, 'real-dir'))
    writeFileSync(join(dir, 'real-file.txt'), 'content')
    try {
      // More links than the probe concurrency cap exercises the worker pool;
      // every directory link must still classify as a directory and every
      // file link as a file (order is already checked by the sort assertion).
      for (let index = 0; index < 48; index += 1) {
        symlinkDirectory(join(dir, 'real-dir'), join(dir, `dir-link-${index}`))
        symlinkSync(join(dir, 'real-file.txt'), join(dir, `file-link-${index}`))
      }
      const listing = await listDirectory(dir)
      for (let index = 0; index < 48; index += 1) {
        expect(listing.entries.find(entry => entry.name === `dir-link-${index}`))
          .toMatchObject({ isDir: true, isSymlink: true, broken: false })
        expect(listing.entries.find(entry => entry.name === `file-link-${index}`))
          .toMatchObject({ isDir: false, isSymlink: true, broken: false })
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
