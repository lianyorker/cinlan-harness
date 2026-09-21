/** Execution-world file operations retain one lease and reject canonical SSH path escapes. */
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-execution-binding'
import type {
  ExecutionBinding, ExecutionIncarnation, ExecutionLease, SshExecutionSnapshot,
} from '@deepseek-ai/dsh-execution-binding/types'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { expect, it, onTestFinished, vi } from 'vitest'
import {
  executionRead, executionTarget, withSessionFiles,
} from '../src/execution-files.ts'

const sshBinding: SshExecutionSnapshot = {
  kind: 'ssh',
  targetId: 'remote-files' as SshExecutionSnapshot['targetId'],
  revision: 3,
  endpoint: {
    host: 'remote.invalid', port: 22, username: 'fixture', hostKeySHA256: 'fixture-host-key',
  },
  node: '/usr/bin/node',
  helper: '/opt/dsh/helper.mjs',
  helperHash: 'fixture-helper-hash',
  workspace: '/srv/work',
  bootstrapPath: '/opt/dsh/bootstrap.json',
  bootstrapHash: 'fixture-bootstrap-hash',
}

function ownedContext(): Context {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  return ctx
}

function fsTarget(path: string): FsTarget {
  return { targetKey: path as FsTarget['targetKey'], displayPath: path }
}

function lease(
  ctx: Context,
  binding: ExecutionBinding,
  release = vi.fn(async () => {}),
  signal = new AbortController().signal,
): ExecutionLease {
  return {
    binding,
    ctx,
    cwd: '/srv/work',
    platform: 'linux',
    incarnation: 'remote-files-incarnation' as ExecutionIncarnation,
    signal,
    assertCurrent: vi.fn(() => { signal.throwIfAborted() }),
    release,
  }
}

it('confines SSH targets by canonical identity while preserving local Host browsing', async () => {
  const world = ownedContext()
  const resolve = vi.fn(async (path: string) => fsTarget(
    path === '/srv/work/link/secret' ? '/etc/secret' : path,
  ))
  const contains = vi.fn((root: FsTarget, candidate: FsTarget) => {
    const base = String(root.targetKey)
    const path = String(candidate.targetKey)
    return path === base || path.startsWith(base + '/')
  })
  world.provide('fs', { resolve, contains } as unknown as FileSystem)
  const signal = new AbortController().signal

  await expect(executionTarget(lease(world, sshBinding), '/srv/work/link/secret', signal))
    .rejects.toMatchObject({ code: 'forbidden', status: 403 })
  await expect(executionTarget(lease(world, { kind: 'local' }), '/srv/work/link/secret', signal))
    .resolves.toEqual(fsTarget('/etc/secret'))
  expect(contains).toHaveBeenCalledOnce()
})

it('uses only the captured filesystem and retains its lease until a read settles', async () => {
  const host = ownedContext()
  const world = ownedContext()
  const started = Promise.withResolvers<undefined>()
  const bytes = Promise.withResolvers<Uint8Array>()
  const readByteRange = vi.fn(async () => {
    started.resolve(undefined)
    return bytes.promise
  })
  world.provide('fs', {
    resolve: vi.fn(async (path: string) => fsTarget(path)),
    contains: vi.fn(() => true),
    stat: vi.fn(async () => ({ type: 'file', size: 5, version: 'v1' })),
    readByteRange,
  } as unknown as FileSystem)
  const release = vi.fn(async () => {})
  const captured = lease(world, sshBinding, release)
  const forSession = vi.fn(async () => captured)
  host.provide('executionBindings', { forSession } as never)

  const pending = withSessionFiles(host, 'session-1', undefined,
    (current, signal) => executionRead(current, '/srv/work/file.txt', 64, signal))
  await started.promise
  expect(release).not.toHaveBeenCalled()
  bytes.resolve(Buffer.from('hello'))

  await expect(pending).resolves.toEqual({ kind: 'text', content: 'hello', truncated: false })
  expect(forSession).toHaveBeenCalledWith('session-1', undefined)
  expect(readByteRange).toHaveBeenCalledWith(fsTarget('/srv/work/file.txt'), { offset: 0, length: 65 }, expect.any(AbortSignal))
  expect(release).toHaveBeenCalledOnce()
})

it('waits for an operation that ignores cancellation before releasing its lease', async () => {
  const host = ownedContext()
  const world = ownedContext()
  const started = Promise.withResolvers<undefined>()
  const operation = Promise.withResolvers<string>()
  const release = vi.fn(async () => {})
  host.provide('executionBindings', { forSession: vi.fn(async () => lease(world, sshBinding, release)) } as never)
  const caller = new AbortController()

  const pending = withSessionFiles(host, 'session-2', caller.signal, async () => {
    started.resolve(undefined)
    return operation.promise
  })
  const rejected = expect(pending).rejects.toThrow('caller disconnected')
  await started.promise
  caller.abort(new Error('caller disconnected'))
  expect(release).not.toHaveBeenCalled()
  operation.resolve('late result')

  await rejected
  expect(release).toHaveBeenCalledOnce()
})
