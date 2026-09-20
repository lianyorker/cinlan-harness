import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import type { VoiceModelDefinition, VoiceModelId } from '@deepseek-ai/dsh-voice'
import { VoiceResourceNotReadyError, VoiceResourceStore } from '../src/resource-store.ts'

const signal = new AbortController().signal
const options = { lockTimeoutMs: 10_000, lockRetryMs: 10 }
const roots: string[] = []
const children: { process: ChildProcess; done: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }[] = []
const fixture = fileURLToPath(new URL('./fixtures/resource-store-child.mjs', import.meta.url))
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

function definition(content = 'first', model = 'model.onnx'): VoiceModelDefinition {
  return {
    id: 'test-model' as VoiceModelId, name: 'Test model', description: 'Fixture', recommended: false,
    kind: 'non-streaming', approximateBytes: content.length + 6,
    architecture: { type: 'sense-voice', model, tokens: 'tokens.txt', language: 'auto' },
    download: { type: 'files', entries: [
      { name: model, url: 'https://user:password@example.com/' + model + '?token=secret#private', sha256: digest(content), bytes: Buffer.byteLength(content) },
      { name: 'tokens.txt', url: 'https://example.com/tokens.txt', sha256: digest('tokens'), bytes: 6 },
    ] },
  }
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'voice-resource-store-'))
  roots.push(root)
  return { root, store: new VoiceResourceStore(root, options) }
}
async function staging(root: string, store: VoiceResourceStore, entry = definition(), content = 'first') {
  const directory = await mkdtemp(join(root, 'staging-'))
  if (entry.architecture.type !== 'sense-voice') throw new Error('Expected fixture architecture')
  await writeFile(join(directory, entry.architecture.model), content)
  await writeFile(join(directory, 'tokens.txt'), 'tokens')
  await store.prepare(entry, directory, signal)
  return directory
}
async function install(root: string, store: VoiceResourceStore, entry = definition(), content = 'first') {
  const revision = (await store.inspect(entry, signal)).revision
  expect(await store.commit(entry, await staging(root, store, entry, content), revision, signal)).toBe(true)
  return store.inspect(entry, signal)
}
async function storeProcess(root: string) {
  // This fixture exercises source-only generation code with workspace atomic-write resolution.
  const child = spawn(process.execPath, ['--import', 'tsx/esm', fixture, root], {
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'temp', 'tmp'].includes(key.toLowerCase()))),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  void done.catch(() => undefined)
  children.push({ process: child, done })
  await new Promise<void>((resolve, reject) => {
    const onMessage = (message: unknown): void => {
      if (message && typeof message === 'object' && 'ready' in message) { child.off('message', onMessage); resolve() }
    }
    child.on('message', onMessage)
    void done.then(() => { child.off('message', onMessage); reject(new Error('Voice child exited before readiness')) }, reject)
  })
  return {
    process: child, done,
    request(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const onMessage = (message: unknown): void => {
          if (!message || typeof message !== 'object' || !('id' in message) || message.id !== id) return
          child.off('message', onMessage)
          if ('error' in message) reject(new Error(String(message.error)))
          else resolve('result' in message ? message.result : undefined)
        }
        child.on('message', onMessage)
        void done.then(() => { child.off('message', onMessage); reject(new Error('Voice child exited during request')) }, reject)
        child.send({ id, command, ...args }, (error) => { if (error) { child.off('message', onMessage); reject(error) } })
      })
    },
  }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill()
    await child.done
  }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 })))
})

describe('VoiceResourceStore', () => {
  it('publishes verified immutable bytes and stable content versions with sanitized sources', async () => {
    const { root, store } = await setup()
    const model = definition()
    expect(await store.inspect(model, signal)).toMatchObject({ revision: '0', integrity: 'missing', installedVersion: null })
    const installed = await install(root, store)
    expect(installed).toMatchObject({ integrity: 'verified', updateAvailable: false, installedVersion: store.manifestFingerprint(model), source: ['https://example.com/model.onnx', 'https://example.com/tokens.txt'] })
    expect(installed.cacheDir).toContain(join('.resources', model.id, 'generations'))
    expect(store.manifestFingerprint({ ...model, name: 'Localized name' })).toBe(installed.installedVersion)
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
    const changed = definition('second', 'replacement.onnx')
    expect(await store.inspect(changed, signal)).toMatchObject({ integrity: 'verified', installedVersion: installed.installedVersion, updateAvailable: true })
    const lease = await store.acquire(changed, signal)
    expect(lease.definition).toEqual(model)
    await lease.release()
    await lease.release()
  })

  it('rejects modified prepared bytes and invalid inventories without replacing the installation', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const stage = await staging(root, store)
    await writeFile(join(stage, 'model.onnx'), 'wrong')
    await expect(store.commit(definition(), stage, installed.revision, signal)).rejects.toThrow('checksum')
    expect((await store.inspect(definition(), signal)).revision).toBe(installed.revision)
    const inventory = join(stage, '.dsh-voice-inventory.json')
    const value = JSON.parse(await readFile(inventory, 'utf8')) as { files: { path: string }[] }
    value.files[0]!.path = '../outside'
    await writeFile(inventory, JSON.stringify(value))
    await expect(store.commit(definition(), stage, installed.revision, signal)).rejects.toThrow('Unsafe')
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
  })

  it('detects committed byte tampering even when the inventory remains present', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    await writeFile(join(installed.cacheDir!, 'model.onnx'), 'wrong')
    expect(await store.inspect(definition(), signal)).toMatchObject({ integrity: 'corrupt', revision: installed.revision })
    await expect(store.acquire(definition(), signal)).rejects.toThrow('not verified: corrupt')
  })

  it('preserves the previous pointer when atomic publication fails', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const stage = await staging(root, store, definition('second'), 'second')
    vi.spyOn(atomic, 'writeFileAtomic').mockRejectedValueOnce(new Error('pointer unavailable'))
    await expect(store.commit(definition('second'), stage, installed.revision, signal)).rejects.toThrow('pointer unavailable')
    expect(await store.inspect(definition(), signal)).toMatchObject({ revision: installed.revision, cacheDir: installed.cacheDir, integrity: 'verified' })
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
  })

  it('lets only one real process publish the same revision and fences empty-state ABA', async () => {
    const { root, store } = await setup()
    const firstStage = await staging(root, store)
    const secondStage = await staging(root, store)
    const [first, second] = await Promise.all([storeProcess(root), storeProcess(root)])
    const results = await Promise.all([
      first.request('commit', { definition: definition(), stagingDir: firstStage, revision: '0' }),
      second.request('commit', { definition: definition(), stagingDir: secondStage, revision: '0' }),
    ])
    expect([...results].sort()).toEqual([false, true])
    const installed = await store.inspect(definition(), signal)
    expect(await second.request('remove', { definition: definition(), revision: '0' })).toBe(false)
    expect(await second.request('remove', { definition: definition(), revision: installed.revision })).toBe(true)
    const removed = await store.inspect(definition(), signal)
    expect(removed.integrity).toBe('missing')
    expect(removed.revision).not.toBe('0')
    expect(removed.revision).not.toBe(installed.revision)
    const loser = results[0] === false ? firstStage : secondStage
    expect(await first.request('commit', { definition: definition(), stagingDir: loser, revision: '0' })).toBe(false)
    expect((await store.inspect(definition(), signal)).revision).toBe(removed.revision)
    await Promise.all([first.request('exit'), second.request('exit')])
    expect(await first.done).toEqual({ code: 0, signal: null })
    expect(await second.done).toEqual({ code: 0, signal: null })
  })

  it('retains a real reader across replacement and removal until its release', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const reader = await storeProcess(root)
    expect(await reader.request('acquire', { definition: definition() })).toMatchObject({ cacheDir: installed.cacheDir })
    const replacement = await install(root, store, definition('second'), 'second')
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
    expect(await store.remove(definition(), replacement.revision, signal)).toBe(true)
    await expect(lstat(replacement.cacheDir!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
    await reader.request('release')
    await expect(lstat(installed.cacheDir!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('collects a crashed reader only after its real process exits', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const reader = await storeProcess(root)
    await reader.request('acquire', { definition: definition() })
    expect(await store.remove(definition(), installed.revision, signal)).toBe(true)
    expect(await readFile(join(installed.cacheDir!, 'tokens.txt'), 'utf8')).toBe('tokens')
    reader.process.kill()
    await reader.done
    expect(() => process.kill(reader.process.pid!, 0)).toThrow()
    const removed = await store.inspect(definition(), signal)
    expect(await store.remove(definition(), removed.revision, signal)).toBe(true)
    await expect(lstat(installed.cacheDir!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never renames staging while a different process holds the publication lock', async () => {
    const { root, store } = await setup()
    const stage = await staging(root, store)
    const writer = await storeProcess(root)
    await writer.request('hold-lock', { definition: definition() })
    const contender = new VoiceResourceStore(root, { lockTimeoutMs: 40, lockRetryMs: 5 })
    await expect(contender.commit(definition(), stage, '0', signal)).rejects.toThrow('Timed out')
    expect(await readdir(join(root, '.resources', 'test-model', 'generations'))).toEqual([])
    expect(await readFile(join(stage, 'model.onnx'), 'utf8')).toBe('first')
    writer.process.kill()
    await writer.done
    await expect(contender.remove(definition(), '0', signal)).rejects.toThrow('Timed out')
    expect(await lstat(join(root, '.resources', 'test-model', 'pointer.json.lock'))).toBeDefined()
  })

  it('cancels a contended operation without removing another writer lock', async () => {
    const { root, store } = await setup()
    await store.inspect(definition(), signal)
    const lock = join(root, '.resources', 'test-model', 'pointer.json.lock')
    await writeFile(lock, 'unknown owner', { flag: 'wx' })
    const controller = new AbortController()
    const pending = store.remove(definition(), '0', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    expect(await readFile(lock, 'utf8')).toBe('unknown owner')
  })

  it('copies pinned legacy files without deleting legacy or adopting again after removal', async () => {
    const { root, store } = await setup()
    const legacy = join(root, 'test-model')
    await mkdir(legacy)
    await writeFile(join(legacy, 'model.onnx'), 'first')
    await writeFile(join(legacy, 'tokens.txt'), 'tokens')
    await writeFile(join(legacy, 'user-notes.txt'), 'mine')
    const installed = await store.inspect(definition(), signal)
    expect(installed.integrity).toBe('verified')
    expect(installed.cacheDir).not.toBe(legacy)
    await writeFile(join(legacy, 'model.onnx'), 'changed legacy')
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
    expect(await store.remove(definition(), installed.revision, signal)).toBe(true)
    expect(await store.inspect(definition(), signal)).toMatchObject({ integrity: 'missing' })
    expect(await readFile(join(legacy, 'user-notes.txt'), 'utf8')).toBe('mine')
  })

  it('rejects corrupt pinned legacy data and never promotes an archive ready marker', async () => {
    const { root, store } = await setup()
    const legacy = join(root, 'test-model')
    await mkdir(legacy)
    await writeFile(join(legacy, 'model.onnx'), 'wrong')
    await writeFile(join(legacy, 'tokens.txt'), 'tokens')
    await writeFile(join(legacy, '.dsh-voice-ready'), 'ready')
    expect((await store.inspect(definition(), signal)).integrity).toBe('corrupt')
    const archive: VoiceModelDefinition = { ...definition(), download: { type: 'archive', url: 'https://example.com/model.tar.bz2', sha256: 'a'.repeat(64) } }
    expect((await store.inspect(archive, signal)).integrity).toBe('unverified')
    await expect(store.acquire(archive, signal)).rejects.toBeInstanceOf(VoiceResourceNotReadyError)
    await expect(store.prepare(archive, legacy, signal)).rejects.toThrow('protected storage')
    expect(await readFile(join(legacy, '.dsh-voice-ready'), 'utf8')).toBe('ready')
  })

  it('retains generations with malformed or unknown reader owners', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const leaseDir = join(root, '.resources', 'test-model', 'leases', basename(installed.cacheDir!))
    await mkdir(leaseDir)
    await writeFile(join(leaseDir, randomUUID() + '.json'), '{broken')
    await store.remove(definition(), installed.revision, signal)
    expect(await readFile(join(installed.cacheDir!, 'model.onnx'), 'utf8')).toBe('first')
  })

  it('rejects hard-linked model files instead of leasing externally mutable bytes', async () => {
    const { root, store } = await setup()
    const stage = await staging(root, store)
    await link(join(stage, 'model.onnx'), join(root, 'outside.onnx'))
    await expect(store.commit(definition(), stage, '0', signal)).rejects.toThrow('without hard links')
    expect((await store.inspect(definition(), signal)).integrity).toBe('missing')
  })

  it('hashes archive output and commits cancellation once pointer replacement starts', async () => {
    const { root, store } = await setup()
    const archive: VoiceModelDefinition = { ...definition(), download: { type: 'archive', url: 'https://example.com/model.tar.bz2', sha256: 'a'.repeat(64) } }
    const stage = await staging(root, store, archive)
    const controller = new AbortController()
    const replace = atomic.writeFileAtomic
    vi.spyOn(atomic, 'writeFileAtomic').mockImplementationOnce(async (...args) => {
      controller.abort(new Error('late cancellation'))
      return replace(...args)
    })
    expect(await store.commit(archive, stage, '0', controller.signal)).toBe(true)
    expect((await store.inspect(archive, signal)).integrity).toBe('verified')
  })

  it('unlinks nested generation junctions without removing their targets', async () => {
    const { root, store } = await setup()
    const installed = await install(root, store)
    const outside = join(root, 'user-data')
    await mkdir(outside)
    await writeFile(join(outside, 'keep.txt'), 'keep')
    await symlink(outside, join(installed.cacheDir!, 'unlisted-directory'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await store.remove(definition(), installed.revision, signal)).toBe(true)
    await expect(lstat(installed.cacheDir!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
  })

  it('rejects malformed pointer paths without touching the referenced directory', async () => {
    const { root, store } = await setup()
    await store.inspect(definition(), signal)
    await writeFile(join(root, '.resources', 'test-model', 'pointer.json'), JSON.stringify({ schemaVersion: 1, revision: randomUUID(), generation: '../outside' }))
    await expect(store.inspect(definition(), signal)).rejects.toThrow('Invalid voice resource pointer')
    await expect(store.remove(definition(), '0', signal)).rejects.toThrow('Invalid voice resource pointer')
  })
})
