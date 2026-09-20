import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceStore } from '../src/resource-store.ts'
import type { SecuritySkillGenerationId, SecuritySkillResourceInstallation } from '../src/types.ts'

const signal = new AbortController().signal
const roots: string[] = []
const cleanupErrors: unknown[] = []
const children: { process: ChildProcess; done: Promise<{ code: number | null; signal: NodeJS.Signals | null }> }[] = []
const fixture = fileURLToPath(new URL('./fixtures/resource-store-child.mjs', import.meta.url))

function childEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    ['path', 'systemroot', 'windir', 'temp', 'tmp'].includes(key.toLowerCase())))
}

function start(args: string[], ipc = false) {
  const process = spawn(globalThis.process.execPath, args, {
    env: childEnvironment(),
    stdio: ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : 'ignore',
  })
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    process.once('error', reject)
    process.once('exit', (code, signal) => { resolve({ code, signal }) })
  })
  void done.catch(() => undefined)
  children.push({ process, done })
  return { process, done }
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill()
    await child.done
  }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3 })))
  expect(cleanupErrors.splice(0)).toEqual([])
})

async function setup(): Promise<{ root: string; first: ResourceStore; second: ResourceStore }> {
  const root = await mkdtemp(join(tmpdir(), 'resource-store-'))
  roots.push(root)
  const first = new ResourceStore(root, (error) => { cleanupErrors.push(error) })
  const second = new ResourceStore(root, (error) => { cleanupErrors.push(error) })
  await Promise.all([first.initialize(), second.initialize()])
  return { root, first, second }
}

async function generation(root: string): Promise<SecuritySkillResourceInstallation> {
  const generation = randomUUID() as SecuritySkillGenerationId
  const directory = join(root, 'generations', generation)
  await mkdir(directory)
  await writeFile(join(directory, 'sentinel'), generation)
  return { generation, version: 'test', source: { kind: 'bundled' }, installedAt: Date.now(), skillCount: 1 }
}

async function exitedPid(): Promise<number> {
  const child = start(['-e', ''])
  expect(await child.done).toEqual({ code: 0, signal: null })
  if (child.process.pid === undefined) throw new Error('Fixture child has no PID')
  expect(() => process.kill(child.process.pid as number, 0)).toThrow()
  return child.process.pid
}

async function storeProcess(root: string) {
  const child = start(['--import', 'tsx/esm', fixture, root], true)
  await new Promise<void>((resolve, reject) => {
    const onMessage = (value: unknown): void => {
      if (value && typeof value === 'object' && 'ready' in value && value.ready === true) {
        child.process.off('message', onMessage)
        resolve()
      }
    }
    child.process.on('message', onMessage)
    void child.done.then(() => { reject(new Error('Store child exited before readiness')) }, reject)
  })
  return {
    process: child.process,
    done: child.done,
    request(command: string, revision?: number): Promise<unknown> {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const onMessage = (value: unknown): void => {
          if (!value || typeof value !== 'object' || !('id' in value) || value.id !== id) return
          child.process.off('message', onMessage)
          if ('error' in value) reject(new Error(String(value.error)))
          else resolve('result' in value ? value.result : undefined)
        }
        child.process.on('message', onMessage)
        child.process.send({ id, command, revision }, (error) => {
          if (error) {
            child.process.off('message', onMessage)
            reject(error)
          }
        })
        void child.done.then(() => { reject(new Error('Store child exited before response')) }, reject)
      })
    },
  }
}

describe('ResourceStore shared-root publication', () => {
  it('rejects stale empty-state publication after an install/remove ABA cycle', async () => {
    const { root, first, second } = await setup()
    expect(await first.readState()).toEqual({ revision: 0, installed: undefined })
    expect(await first.acquireState()).toEqual({ revision: 0 })
    const installation = await generation(root)
    expect(await second.commit(installation, 0, signal)).toBe(true)
    const observed = await first.acquireState()
    expect(observed.revision).toBe(1)
    expect(observed.lease?.installation).toEqual(installation)
    await observed.lease?.release()
    expect(await second.commit(undefined, 1, signal)).toBe(true)
    expect(await first.readState()).toEqual({ revision: 2, installed: undefined })
    expect(await first.acquireState()).toEqual({ revision: 2 })
    const stale = await generation(root)
    const prepare = vi.fn(async () => {})
    expect(await first.commit(stale, 0, signal, prepare)).toBe(false)
    expect(prepare).not.toHaveBeenCalled()
    expect(await first.commit(undefined, 2, signal)).toBe(true)
    expect(await second.readState()).toEqual({ revision: 3, installed: undefined })
    expect(JSON.parse(await readFile(join(root, 'active.json'), 'utf8'))).toEqual({ schemaVersion: 1, revision: 3, installed: null })
  })

  it.each([undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'])(
    'rejects persisted invalid revision %s without rewriting the pointer', async (revision) => {
      const { root, first } = await setup()
      const raw = JSON.stringify({ schemaVersion: 1, revision, installed: null })
      await writeFile(join(root, 'active.json'), raw)
      await expect(first.readState()).rejects.toThrow(/revision/)
      expect(await readFile(join(root, 'active.json'), 'utf8')).toBe(raw)
    })

  it('refuses revision overflow before preparation or pointer publication', async () => {
    const { root, first } = await setup()
    const raw = JSON.stringify({ schemaVersion: 1, revision: Number.MAX_SAFE_INTEGER, installed: null })
    await writeFile(join(root, 'active.json'), raw)
    const prepare = vi.fn(async () => {})
    await expect(first.commit(undefined, Number.MAX_SAFE_INTEGER, signal, prepare)).rejects.toThrow(/exhausted/)
    expect(prepare).not.toHaveBeenCalled()
    expect(await readFile(join(root, 'active.json'), 'utf8')).toBe(raw)
  })

  it('keeps the durable pointer unchanged when preparation aborts before publication', async () => {
    const { root, first } = await setup()
    const initial = await generation(root)
    await first.commit(initial, 0, signal)
    const before = await readFile(join(root, 'active.json'), 'utf8')
    const controller = new AbortController()
    const next = await generation(root)
    const prepare = vi.fn(async () => { controller.abort(new Error('cancelled after preparation')) })
    await expect(first.commit(next, 1, controller.signal, prepare)).rejects.toThrow('cancelled after preparation')
    expect(prepare).toHaveBeenCalledOnce()
    expect(await readFile(join(root, 'active.json'), 'utf8')).toBe(before)
    expect(await first.readState()).toEqual({ revision: 1, installed: initial })
    expect(await readFile(join(root, 'generations', initial.generation, 'sentinel'), 'utf8')).toBe(initial.generation)
  })

  it('serializes startup collection behind generation preparation and publication', async () => {
    const { root, first, second } = await setup()
    const prepared = Promise.withResolvers<SecuritySkillResourceInstallation>()
    const publish = Promise.withResolvers<undefined>()
    const attempted = Promise.withResolvers<undefined>()
    const locked = second.lock.bind(second)
    const lockObserver = vi.spyOn(second, 'lock').mockImplementation((operation) => {
      attempted.resolve(undefined)
      return locked(operation)
    })
    const installation: SecuritySkillResourceInstallation = {
      generation: randomUUID() as SecuritySkillGenerationId, version: 'prepared', source: { kind: 'bundled' },
      installedAt: Date.now(), skillCount: 1,
    }
    const commit = first.commit(installation, 0, signal, async () => {
      const directory = join(root, 'generations', installation.generation)
      await mkdir(directory)
      await writeFile(join(directory, 'sentinel'), 'prepared bytes')
      prepared.resolve(installation)
      await publish.promise
    })
    let initialize: Promise<void> | undefined
    try {
      await prepared.promise
      initialize = second.initialize()
      await attempted.promise
      expect(await readFile(join(root, 'generations', installation.generation, 'sentinel'), 'utf8')).toBe('prepared bytes')
      publish.resolve(undefined)
      expect(await commit).toBe(true)
      await initialize
      expect(await second.read()).toEqual(installation)
      expect(await readFile(join(root, 'generations', installation.generation, 'sentinel'), 'utf8')).toBe('prepared bytes')
    } finally {
      publish.resolve(undefined)
      await Promise.allSettled([commit, ...(initialize ? [initialize] : [])])
      lockObserver.mockRestore()
    }
  })

  it('recovers a removed generation after its real reader process dies and a Host initializes', async () => {
    const { root, first, second } = await setup()
    const installation = await generation(root)
    expect(await first.commit(installation, 0, signal)).toBe(true)
    const reader = await storeProcess(root)
    expect(await reader.request('acquire')).toEqual(installation)
    expect(await second.commit(undefined, 1, signal)).toBe(true)
    await second.initialize()
    expect((await lstat(join(root, 'generations', installation.generation))).isDirectory()).toBe(true)
    expect(reader.process.kill()).toBe(true)
    await reader.done
    await first.initialize()
    await expect(lstat(join(root, 'generations', installation.generation))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(root, 'leases', installation.generation))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await first.readState()).toEqual({ revision: 2, installed: undefined })
  })

  it('startup preserves active and unknown-leased generations while removing abandoned unleased generations', async () => {
    const { root, first, second } = await setup()
    const active = await generation(root)
    await first.commit(active, 0, signal)
    const abandoned = await generation(root)
    const unknown = await generation(root)
    await mkdir(join(root, 'leases', unknown.generation))
    await writeFile(join(root, 'leases', unknown.generation, 'owner.json'), '{unknown')
    await second.initialize()
    expect(await second.read()).toEqual(active)
    expect((await lstat(join(root, 'generations', unknown.generation))).isDirectory()).toBe(true)
    await expect(lstat(join(root, 'generations', abandoned.generation))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('allows only one writer to replace a generation observed by both stores', async () => {
    const { root, first, second } = await setup()
    const initial = await generation(root)
    expect(await first.commit(initial, (await first.readState()).revision, signal)).toBe(true)
    const a = await generation(root)
    const b = await generation(root)
    const outcomes = await Promise.all([
      first.commit(a, 1, signal),
      second.commit(b, 1, signal),
    ])
    expect(outcomes.filter(Boolean)).toHaveLength(1)
    const winner = outcomes[0] ? a : b
    expect(await first.read()).toEqual(winner)
    expect(await second.read()).toEqual(winner)
    expect(await first.commit(undefined, 1, signal)).toBe(false)
    expect(await readFile(join(root, 'generations', winner.generation, 'sentinel'), 'utf8')).toBe(winner.generation)
    await expect(lstat(join(root, 'generations', initial.generation))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('retains a removed generation until the other store releases its lease', async () => {
    const { root, first, second } = await setup()
    const initial = await generation(root)
    await first.commit(initial, (await first.readState()).revision, signal)
    const lease = await first.acquire()
    expect(lease?.installation).toEqual(initial)
    if (!lease) throw new Error('Missing fixture lease')
    expect(await second.commit(undefined, 1, signal)).toBe(true)
    expect(await second.read()).toBeUndefined()
    expect(await readFile(join(root, 'generations', initial.generation, 'sentinel'), 'utf8')).toBe(initial.generation)
    expect(await readdir(join(root, 'leases', initial.generation))).toHaveLength(1)
    await Promise.all([lease.release(), lease.release()])
    await expect(lstat(join(root, 'generations', initial.generation))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(lstat(join(root, 'leases', initial.generation))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the pointer unchanged when publication is cancelled', async () => {
    const { root, first, second } = await setup()
    const initial = await generation(root)
    await first.commit(initial, (await first.readState()).revision, signal)
    await expect(second.commit(undefined, 1, AbortSignal.abort(new Error('cancelled')))).rejects.toThrow('cancelled')
    expect(await first.read()).toEqual(initial)
  })

  it('removes definitely dead staging while retaining unknown and live owners', async () => {
    const { root, second } = await setup()
    const pid = await exitedPid()
    const owners: Record<string, string | undefined> = {
      dead: JSON.stringify({ pid }), live: JSON.stringify({ pid: process.pid }), unknown: '{broken', absent: undefined,
    }
    const directories = new Map<string, string>()
    for (const [name, owner] of Object.entries(owners)) {
      const directory = join(root, 'staging-' + randomUUID())
      directories.set(name, directory)
      await mkdir(directory)
      if (owner !== undefined) await writeFile(join(directory, 'owner.json'), owner)
    }
    await second.initialize()
    for (const [name, directory] of directories) {
      if (name === 'dead') await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
      else expect((await lstat(directory)).isDirectory()).toBe(true)
    }
  })

  it('collects definitely dead leases but preserves generations with unknown owners', async () => {
    const { root, first, second } = await setup()
    const pid = await exitedPid()
    for (const owner of [JSON.stringify({ pid }), '{unknown']) {
      const initial = await generation(root)
      await first.commit(initial, (await first.readState()).revision, signal)
      const lease = await first.acquire()
      if (!lease) throw new Error('Missing fixture lease')
      const leaseDirectory = join(root, 'leases', initial.generation)
      await writeFile(join(leaseDirectory, 'owner.json'), owner)
      expect(await second.commit(undefined, (await second.readState()).revision, signal)).toBe(true)
      await lease.release()
      const directory = join(root, 'generations', initial.generation)
      if (owner === '{unknown') expect((await lstat(directory)).isDirectory()).toBe(true)
      else await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('honors a lease held by one Node process when another Node process removes the installation', async () => {
    const { root, first } = await setup()
    const initial = await generation(root)
    await first.commit(initial, (await first.readState()).revision, signal)
    const [reader, writer] = await Promise.all([storeProcess(root), storeProcess(root)])
    expect(reader.process.pid).not.toBe(writer.process.pid)
    expect(await reader.request('acquire')).toEqual(initial)
    const leases = await readdir(join(root, 'leases', initial.generation))
    expect(leases).toHaveLength(1)
    const owner = JSON.parse(await readFile(join(root, 'leases', initial.generation, leases[0] as string), 'utf8')) as { pid: number }
    expect(owner.pid).toBe(reader.process.pid)
    expect(await writer.request('remove', 1)).toBe(true)
    expect(await first.read()).toBeUndefined()
    expect(await readFile(join(root, 'generations', initial.generation, 'sentinel'), 'utf8')).toBe(initial.generation)
    expect(await reader.request('release')).toBe(true)
    await expect(lstat(join(root, 'generations', initial.generation))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
