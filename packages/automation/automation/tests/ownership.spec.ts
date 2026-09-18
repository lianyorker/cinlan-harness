/** Real independent-process proof of SQLite exclusion and crash release. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { AutomationOwnership } from '../src/ownership.ts'

const roots: string[] = []
const held: AutomationOwnership[] = []
const children: { process: ChildProcess; exited: Promise<void> }[] = []
afterEach(async () => {
  for (const lock of held.splice(0)) lock.close()
  for (const child of children.splice(0)) {
    if (child.process.exitCode === null && child.process.signalCode === null) child.process.kill('SIGKILL')
    await child.exited
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-automation-owner-'))
  roots.push(root)
  return root
}
function startOwner(root: string) {
  const child = spawn(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('./fixtures/owner.ts', import.meta.url)), root], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const exited = new Promise<void>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', () => { resolve() })
  })
  const ready = new Promise<unknown>((resolve, reject) => {
    child.once('error', reject)
    child.once('message', resolve)
    child.once('exit', () => { reject(new Error('owner exited before readiness')) })
  })
  children.push({ process: child, exited })
  return { child, ready, exited }
}

describe('automation SQLite ownership', () => {
  it('excludes independent processes and releases after abrupt owner death', { timeout: 30_000 }, async () => {
    const root = await directory()
    const owner = startOwner(root)
    expect(await owner.ready).toEqual({ kind: 'owned' })
    const contender = startOwner(root)
    expect(await contender.ready).toEqual({ kind: 'busy' })
    expect(await AutomationOwnership.acquire(root)).toBeNull()
    owner.child.kill('SIGKILL')
    await owner.exited
    const successor = startOwner(root)
    expect(await successor.ready).toEqual({ kind: 'owned' })
  })

  it('holds exclusion until explicit release while data writes continue in another file', async () => {
    const root = await directory()
    const owner = startOwner(root)
    expect(await owner.ready).toEqual({ kind: 'owned' })
    const data = new DatabaseSync(join(root, 'state.sqlite3'))
    try {
      data.exec('CREATE TABLE proof (id INTEGER PRIMARY KEY); INSERT INTO proof VALUES (1)')
      expect(data.prepare('SELECT id FROM proof').get()).toMatchObject({ id: 1 })
    } finally { data.close() }
    expect(await AutomationOwnership.acquire(root)).toBeNull()
    owner.child.send('release')
    await owner.exited
    const lock = await AutomationOwnership.acquire(root)
    expect(lock).not.toBeNull()
    if (lock !== null) held.push(lock)
  })

  it('shares exclusion across a directory alias while separate profile directories remain independent', async () => {
    const root = await directory()
    const primary = join(root, 'profile-a')
    const first = await AutomationOwnership.acquire(primary)
    if (first !== null) held.push(first)
    const alias = join(root, 'profile-alias')
    await symlink(primary, alias, process.platform === 'win32' ? 'junction' : 'dir')
    expect(await AutomationOwnership.acquire(alias)).toBeNull()
    const other = await AutomationOwnership.acquire(join(root, 'profile-b'))
    expect(other).not.toBeNull()
    if (other !== null) held.push(other)
  })

  it('reports corruption as a failure rather than pretending another owner exists', async () => {
    const root = await directory()
    await writeFile(join(root, 'owner.sqlite3'), 'invalid SQLite contents')
    await expect(AutomationOwnership.acquire(root)).rejects.toThrow()
  })
})
