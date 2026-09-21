/** Real encrypted provisioning transport; Windows fixtures do not claim POSIX execution support. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { readRuntimeArtifact, sha256, writeRuntimeManifest, type RuntimeArtifact } from '../src/artifact.ts'
import { RuntimeConnectionError, runRemoteOperation } from '../src/transport.ts'
import type { RuntimeGeneration, RuntimeLimits } from '../src/types.ts'
import { sshFixture } from './ssh-fixture.ts'

const limits: RuntimeLimits = { operationTimeoutMs: 20_000, shutdownTimeoutMs: 1000, maxManifestBytes: 1024 * 1024,
  maxFileBytes: 1024 * 1024, maxTotalBytes: 8 * 1024 * 1024, maxFiles: 1000, maxResponseBytes: 65536 }
async function payload(functional = false, missingDependency = false) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-runtime-payload-'))
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }) })
  await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module', name: 'fixture-runtime', version: '0.1.6-alpha.2',
    ...(missingDependency ? { dependencies: { 'absent-runtime-dependency': '1.0.0' } } : {}) }))
  await mkdir(join(root, 'tools'))
  await writeFile(join(root, 'tools', 'package.json'), JSON.stringify({ name: 'fixture-tools', version: '0.1.0', dependencies: { glob: '99.0.0' } }))
  await writeFile(join(root, 'helper.js'), functional
    ? await readFile(new URL('./fixture-helper.mjs', import.meta.url))
    : 'throw new Error("fixture helper is not a production runtime")\n')
  await writeFile(join(root, 'process.js'), await readFile(new URL('../../../ptc-runtime/ptc-runtime-node/lib/process.js', import.meta.url)))
  const pin = await writeRuntimeManifest(root, { version: '0.1.6-alpha.2', sourceCommit: 'a'.repeat(40), protocol: 1,
    platform: 'linux', arch: 'x64', helper: 'helper.js', bootstrap: 'process.js' })
  const artifact = await readRuntimeArtifact(root, pin, limits)
  if (!functional) return artifact
  // Only this low-level transport fixture admits Windows for running the real supervisor/PTC child.
  // Production artifact validation continues to admit linux/darwin only.
  const manifest = { ...artifact.manifest, platform: process.platform, arch: process.arch }
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  return { ...artifact, manifest, bytes, generation: sha256(bytes) as RuntimeGeneration } as RuntimeArtifact
}

describe('runtime release inventory', () => {
  it('rejects altered files, unlisted files and mismatched manifest pins before SSH', async () => {
    const artifact = await payload()
    await expect(readRuntimeArtifact(artifact.root, '0'.repeat(64), limits)).rejects.toThrow('manifest SHA-256')
    const original = await readFile(join(artifact.root, 'helper.js'))
    await writeFile(join(artifact.root, 'helper.js'), Buffer.alloc(original.length, 0x61))
    await expect(readRuntimeArtifact(artifact.root, artifact.generation, limits)).rejects.toThrow('file SHA-256')
    await writeFile(join(artifact.root, 'extra.js'), 'unlisted')
    await expect(readRuntimeArtifact(artifact.root, artifact.generation, limits)).rejects.toThrow('inventory differs')
  })
})

describe('encrypted cold provisioning transport', () => {
  it('publishes a complete immutable generation after real PTC evaluation and retains old bytes on update', async () => {
    const state = await sshFixture(); const artifact = await payload(true)
    const installed = await runRemoteOperation(state.location, artifact.generation, limits, artifact, new AbortController().signal)
    expect(installed).toMatchObject({ state: 'installed', generation: artifact.generation, protocol: 1 })
    const previous = await readFile(join(state.installRoot, 'generations', artifact.generation, 'process.js'))
    const next = await payload(true)
    const manifest = { ...next.manifest, sourceCommit: 'b'.repeat(40) }
    const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
    const replacement = { ...next, manifest, bytes, generation: sha256(bytes) as RuntimeGeneration }
    await runRemoteOperation(state.location, replacement.generation, limits, replacement, new AbortController().signal)
    expect(await readdir(join(state.installRoot, 'generations'))).toEqual([artifact.generation, replacement.generation].sort())
    expect(await readFile(join(state.installRoot, 'generations', artifact.generation, 'process.js'))).toEqual(previous)
    expect(await readdir(join(state.installRoot, '.staging'))).toEqual([])
  })

  it('rejects a missing transitive dependency before publication despite matching file hashes', async () => {
    const state = await sshFixture(); const artifact = await payload(true, true)
    await expect(runRemoteOperation(state.location, artifact.generation, limits, artifact,
      new AbortController().signal)).rejects.toThrow('Runtime dependency is missing')
    expect(await readdir(join(state.installRoot, 'generations'))).toEqual([])
    expect(await readdir(join(state.installRoot, '.staging'))).toEqual([])
  })

  it('reports actual Node/platform and absent runtime without requiring an installed helper', async () => {
    const state = await sshFixture()
    const result = await runRemoteOperation(state.location, '0'.repeat(64) as RuntimeGeneration, limits, undefined, new AbortController().signal)
    expect(result).toMatchObject({ state: 'missing', platform: process.platform, arch: process.arch, nodeVersion: process.version })
    expect(state.commands[0]).toContain("'env' '-i' 'PATH=/usr/bin:/bin' '/fixture/node'")
    await vi.waitFor(() => { expect(state.children.size).toBe(0); expect(state.clients.size).toBe(0) })
  })

  it('refuses a wrong pinned host key before exec or file transfer', async () => {
    const state = await sshFixture()
    const location = { ...state.location, endpoint: { ...state.location.endpoint, hostKeySHA256: '0'.repeat(64) } }
    await expect(runRemoteOperation(location, '0'.repeat(64) as RuntimeGeneration, limits, undefined,
      new AbortController().signal)).rejects.toBeInstanceOf(RuntimeConnectionError)
    expect(state.commands).toEqual([])
  })

  it('uploads by SFTP and refuses an incompatible or nonfunctional payload without activation', async () => {
    const state = await sshFixture(); const artifact = await payload()
    await expect(runRemoteOperation(state.location, artifact.generation, limits, artifact,
      new AbortController().signal)).rejects.toThrow(/incompatible|probe failed/i)
    expect(await readdir(join(state.installRoot, 'generations'))).toEqual([])
    expect(await readdir(join(state.installRoot, '.staging'))).toEqual([])
    await vi.waitFor(() => { expect(state.children.size).toBe(0) })
  })

  it('cancels an unacknowledged exec acquisition without starting another task', async () => {
    const state = await sshFixture({ holdExec: true }); const abort = new AbortController()
    const work = runRemoteOperation(state.location, '0'.repeat(64) as RuntimeGeneration, limits, undefined, abort.signal)
    const rejected = expect(work).rejects.toThrow(/closed|cancel/i)
    await state.execEntered; abort.abort(new Error('cancel acquisition')); await rejected
    expect(state.children.size).toBe(0)
    await vi.waitFor(() => { expect(state.clients.size).toBe(0) })
  })

  it('cancels a paused SFTP write and removes only its staging directory', async () => {
    const state = await sshFixture({ holdWrite: true }); const artifact = await payload(); const abort = new AbortController()
    const work = runRemoteOperation(state.location, artifact.generation, limits, artifact, abort.signal)
    const rejected = expect(work).rejects.toThrow(/cancel/i)
    await state.writeEntered; abort.abort(new Error('cancel transfer')); await rejected
    expect(await readdir(join(state.installRoot, 'generations'))).toEqual([])
    expect(await readdir(join(state.installRoot, '.staging'))).toEqual([])
    await vi.waitFor(() => { expect(state.children.size).toBe(0); expect(state.clients.size).toBe(0) })
  })
})
