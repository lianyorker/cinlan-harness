import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ root: '', prepare: vi.fn(), execute: vi.fn() }))
vi.mock('../scripts/prepare-primary-runtime.ts', () => ({ preparePrimaryRuntime: fixture.prepare }))
vi.mock('../scripts/desktop-build-paths.mjs', () => ({ resolveDesktopTargetBuildPaths: () => ({
  runtime: join(fixture.root, 'runtime'), downloads: join(fixture.root, 'downloads'), nodeExtract: join(fixture.root, 'extract'),
}) }))
vi.mock('node:module', () => ({ createRequire: () => ({ resolve: () => join(fixture.root, 'pnpm', 'package.json') }) }))
vi.mock('node:child_process', () => ({ spawnSync: fixture.execute }))

beforeEach(async () => {
  vi.resetModules()
  fixture.root = await mkdtemp(join(tmpdir(), 'desktop-runtime-pipeline-'))
  vi.stubEnv('DSH_DESKTOP_TARGET_PLATFORM', 'win32')
  vi.stubEnv('DSH_DESKTOP_TARGET_ARCH', 'x64')
  fixture.prepare.mockReset()
  fixture.execute.mockReset().mockReturnValue({ status: 0, stdout: 'v24.17.0', stderr: '' })
  await mkdir(join(fixture.root, 'downloads'))
  await mkdir(join(fixture.root, 'pnpm', 'bin'), { recursive: true })
  await writeFile(join(fixture.root, 'pnpm', 'package.json'), JSON.stringify({ version: '11.7.0' }))
  await writeFile(join(fixture.root, 'pnpm', 'bin', 'pnpm.mjs'), '// fixture package manager')
  const archive = zipSync({ 'node-v24.17.0-win-x64/node.exe': Buffer.from('fixture host node') })
  await writeFile(join(fixture.root, 'downloads', 'node-v24.17.0-win-x64.zip'), archive)
  await writeFile(join(fixture.root, 'downloads', 'node-v24.17.0-SHASUMS256.txt'),
    createHash('sha256').update(archive).digest('hex') + '  node-v24.17.0-win-x64.zip\n')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('unexpected download') }))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(fixture.root, { recursive: true, force: true })
})

it.each([false, true])('prepares Host files before primary payload, deferring smoke=%s', async (deferSmoke) => {
  fixture.prepare.mockImplementation(async () => {
    expect(JSON.parse(await readFile(join(fixture.root, 'runtime', 'versions.json'), 'utf8')))
      .toEqual({ schemaVersion: 1, node: '24.17.0', pnpm: '11.7.0' })
    expect(await readFile(join(fixture.root, 'runtime', 'node', 'node.exe'), 'utf8')).toBe('fixture host node')
    expect(await readFile(join(fixture.root, 'runtime', 'pnpm', 'bin', 'pnpm.mjs'), 'utf8')).toContain('fixture package manager')
  })
  const { prepareDesktopRuntime } = await import('../scripts/prepare-runtime.ts')
  await prepareDesktopRuntime(deferSmoke ? ['--defer-primary-runtime-smoke'] : [])
  expect(fixture.prepare).toHaveBeenCalledExactlyOnceWith({ deferSmoke })
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects a corrupt Host archive before preparing the primary payload', async () => {
  await writeFile(join(fixture.root, 'downloads', 'node-v24.17.0-win-x64.zip'), 'corrupt')
  const { prepareDesktopRuntime } = await import('../scripts/prepare-runtime.ts')
  await expect(prepareDesktopRuntime([])).rejects.toThrow('checksum mismatch')
  expect(fixture.prepare).not.toHaveBeenCalled()
})

it('propagates primary preparation failures after preparing the Host runtime', async () => {
  fixture.prepare.mockRejectedValue(new Error('primary archive checksum mismatch'))
  const { prepareDesktopRuntime } = await import('../scripts/prepare-runtime.ts')
  await expect(prepareDesktopRuntime([])).rejects.toThrow('primary archive checksum mismatch')
})
