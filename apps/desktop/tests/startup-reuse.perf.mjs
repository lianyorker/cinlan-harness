/** Diagnostic for warm profile reconciliation; run after build:desktop under plain Node. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createSeedMetadata, DesktopProjectManager } from '../lib/types/project-manager.js'
import { resolveDesktopPaths } from '../lib/types/paths.js'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../lib/types/host-protocol.js'
import { runDesktopPreparationWorker } from '../lib/types/startup-preparation.js'

// The Windows seed has roughly 320 first-party packages and 16 store shards totaling 544 MiB.
// Fixed bytes exercise hashing and filesystem work; no registry, installer, or backend runs here.
const packageCount = 320
const packageBytes = 64 * 1024
const shardCount = 16
const shardBytes = 34 * 1024 * 1024
const samples = 5
const root = mkdtempSync(join(tmpdir(), 'dsh-startup-reuse-perf-'))
try {
  const seed = join(root, 'seed')
  const paths = resolveDesktopPaths(join(root, 'home'))
  const version = '1.0.0'
  const coreNames = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host']
  const names = [...coreNames, ...Array.from({ length: packageCount - 2 }, (_, i) => `@fixture/package-${String(i).padStart(3, '0')}`)]
    .sort((left, right) => left.localeCompare(right))
  const inventory = []
  const put = (path, body) => {
    writeFileSync(join(seed, path), body)
    inventory.push({ path, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') })
  }
  mkdirSync(join(seed, 'desktop-packages'), { recursive: true })
  const packageBody = Buffer.alloc(packageBytes, 0x61)
  const packages = names.map((name, i) => {
    const file = `package-${String(i).padStart(3, '0')}.tgz`
    put(`desktop-packages/${file}`, packageBody)
    return { name, version, file, bytes: packageBytes, integrity: `sha512-${createHash('sha512').update(packageBody).digest('base64')}` }
  })
  put('desktop-packages.json', JSON.stringify({ schemaVersion: 1, packages }))
  createSeedMetadata(seed, { schemaVersion: 1, version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: '24.17.0', pnpmVersion: '11.7.0' })
  for (const file of ['desktop-release.json', 'package.json', 'pnpm-workspace.yaml']) put(file, readFileSync(join(seed, file)))
  put('pnpm-lock.yaml', 'lockfileVersion: 9\n')
  mkdirSync(paths.profile, { recursive: true })
  for (const file of ['desktop-release.json', 'desktop-packages.json', 'desktop-packages', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    cpSync(join(seed, file), join(paths.profile, file), { recursive: true })
  }
  for (const name of coreNames) {
    const directory = join(paths.profile, 'node_modules', ...name.split('/'))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }))
  }
  mkdirSync(join(seed, 'store-archives'))
  const shard = Buffer.alloc(shardBytes, 0x62)
  for (let i = 0; i < shardCount; i++) put(`store-archives/store-${i.toString(16).padStart(2, '0')}.tar`, shard)
  writeFileSync(join(seed, 'integrity.json'), JSON.stringify({ schemaVersion: 2, files: inventory }))
  const unexpected = async () => { throw new Error('Reusing the profile must not enter activation') }
  const hooks = { healthCheck: unexpected, beforeActivate: unexpected, afterActivate: unexpected }
  const elapsedMs = []
  for (let i = 0; i < samples; i++) {
    const manager = new DesktopProjectManager(paths, { node: process.execPath, pnpm: join(root, 'must-not-run.mjs') })
    const started = performance.now()
    assert.equal(await manager.applyRelease(seed, version, hooks), false)
    elapsedMs.push(Number((performance.now() - started).toFixed(2)))
  }
  // Exercise the packaged CJS worker with an interrupted transaction and inaccessible installer inputs.
  // The file at the UUID root cannot be recursively removed as a directory on any platform.
  const id = '5f8f4f3c-0f4f-4b6f-9a6e-2ccf8d70c8be'
  mkdirSync(paths.staging, { recursive: true })
  const orphan = join(paths.staging, id)
  writeFileSync(orphan, 'deferred cleanup')
  writeFileSync(paths.pending, JSON.stringify({ schemaVersion: 1, id, stagingProfile: join(orphan, 'profile'), step: 'prepared' }))
  rmSync(join(seed, 'store-archives'), { recursive: true })
  const workerStages = []
  await runDesktopPreparationWorker(readFileSync(new URL('../lib/startup-worker.cjs', import.meta.url), 'utf8'), {
    paths, runtime: { node: process.execPath, pnpm: join(root, 'must-not-run.mjs') }, seed, version,
  }, AbortSignal.timeout(30_000), stage => { workerStages.push(stage) })
  assert.deepEqual(workerStages, ['recovering', 'verifying'])
  assert.equal(existsSync(paths.pending), false)
  assert.equal(existsSync(paths.lock), false)
  assert.equal(readFileSync(orphan, 'utf8'), 'deferred cleanup')
  console.log(JSON.stringify({
    endpoint: 'applyRelease returns false for the identical verified profile',
    node: process.version, platform: process.platform, arch: process.arch,
    workload: { packageCount, packageBytes, shardCount, shardBytes },
    clock: 'fixture construction excluded; OS file cache warm; no model, network, backend, or UI',
    elapsedMs, medianMs: [...elapsedMs].sort((a, b) => a - b)[Math.floor(samples / 2)],
    builtWorker: { stages: workerStages, journalCleared: true, lockReleased: true, orphanRetained: true },
  }, null, 2))
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
