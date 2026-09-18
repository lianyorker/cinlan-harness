/** Real Loader behavior and controlled external read settlement. */

import { mkdir, realpath, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExecutionHostId } from '@deepseek-ai/dsh-execution-host'
import * as Worker from '../src/index.ts'
import { resolveConfig } from '../src/config.ts'
import { directoryInspectionSchema, workerResultSchema } from '../src/protocol.ts'
import { createHarness } from './harness.ts'

const readBarriers = vi.hoisted(() => new Map<string, {
  entered: () => void
  release: Promise<void>
}>())

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    async readdir(...args: Parameters<typeof actual.readdir>) {
      const result = await actual.readdir(...args)
      const barrier = readBarriers.get(String(args[0]))
      if (barrier) {
        barrier.entered()
        await barrier.release
      }
      return result
    },
  }
})

const cleanups: (() => Promise<void>)[] = []
const releases: (() => void)[] = []

afterEach(async () => {
  for (const release of releases.splice(0)) release()
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  readBarriers.clear()
})

async function mount(config: Parameters<typeof createHarness>[0] = {}) {
  const harness = await createHarness(config)
  cleanups.push(harness.dispose)
  return harness
}

async function blockRead(root: string) {
  const entered = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  releases.push(() => { gate.resolve(undefined) })
  readBarriers.set(await realpath(root), {
    entered: () => { entered.resolve(undefined) }, release: gate.promise,
  })
  return { entered: entered.promise, release: () => { gate.resolve(undefined) } }
}

const inspection = workerResultSchema(directoryInspectionSchema)

describe('execution-host worker through source Loader', () => {
  it('reports process provenance and inspects real named-root files', async () => {
    expect('default' in Worker).toBe(false)
    const h = await mount()
    await writeFile(join(h.root, 'hello.txt'), 'actual contents')
    await mkdir(join(h.root, 'nested'))
    const info = await h.initialize()
    expect(info.executionHost).toEqual(h.ctx.executionHost.current())
    expect(info.executionHost.pid).toBe(process.pid)
    expect(info.capabilities).toEqual(['directory-inspection'])
    expect(info.roots).toEqual([{ id: 'project', label: 'Project', path: h.root }])
    expect(inspection.parse(await h.inspect('one'))).toEqual({
      ok: true,
      value: {
        executionHostId: info.executionHost.hostId, rootId: 'project', path: '',
        entries: [{ name: 'hello.txt', type: 'file' }, { name: 'nested', type: 'directory' }], truncated: false,
      },
    })
    expect(await h.client.request('cancel', { operationId: 'one' })).toEqual({ ok: true, value: { settled: true } })
    for (const frame of h.frames.join('').trim().split('\n')) expect(JSON.parse(frame)).toHaveProperty('jsonrpc', '2.0')
  })

  it('initializes with no filesystem roots exported', async () => {
    const h = await mount({ roots: [] })
    expect((await h.initialize()).roots).toEqual([])
    expect(await h.inspect('empty')).toMatchObject({ ok: false, error: { code: 'ROOT_UNKNOWN' } })
  })

  it('validates initialization, request fields, versions, and expected host identity', async () => {
    const h = await mount()
    expect(await h.inspect('early')).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('initialize', { protocolVersion: '1' })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('initialize', { protocolVersion: 2 })).toMatchObject({ error: { code: 'UNSUPPORTED_VERSION' } })
    await h.initialize()
    expect(await h.client.request('inspectDirectory', { operationId: 'bad' })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('cancel', { operationId: '' })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('cancel', { operationId: 'unknown' })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('shutdown', { extra: true })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('runCommand', {})).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.inspect('stale', '', ExecutionHostId('some-other-host'))).toMatchObject({ error: { code: 'STALE_HOST' } })
  })

  it('refuses absolute paths, traversal, unknown roots, files, and resolved symlink escapes', async () => {
    const h = await mount()
    await h.initialize()
    await writeFile(join(h.root, 'file'), 'contents')
    for (const [index, path] of ['../outside', 'nested/../../outside', '/tmp', 'C:\\outside', 'C:outside', '\\server', 'a\0b'].entries()) {
      expect(await h.inspect('invalid-' + String(index), path)).toMatchObject({ error: { code: 'PATH_OUTSIDE_ROOT' } })
    }
    expect(await h.inspect('missing-root', '', undefined, 'unexported')).toMatchObject({ error: { code: 'ROOT_UNKNOWN' } })
    expect(await h.inspect('file-path', 'file')).toMatchObject({ error: { code: 'NOT_DIRECTORY' } })
    const escape = join(h.root, 'escape')
    await symlink(h.outside, escape, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(await h.inspect('symlink-escape', 'escape')).toMatchObject({ error: { code: 'PATH_OUTSIDE_ROOT' } })
      const result = inspection.parse(await h.inspect('list-link'))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.entries).toContainEqual({ name: 'escape', type: 'symlink' })
    } finally {
      await unlink(escape)
    }
  })

  it('caps entries and retains only a bounded set of completed operation IDs', async () => {
    const h = await mount({ maxEntries: 1, maxCompletedOperations: 1 })
    await writeFile(join(h.root, 'a'), '')
    await writeFile(join(h.root, 'b'), '')
    await h.initialize()
    expect(inspection.parse(await h.inspect('first'))).toMatchObject({ value: { entries: [{ name: 'a', type: 'file' }], truncated: true } })
    expect(await h.inspect('first')).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    await h.inspect('second')
    expect(await h.client.request('cancel', { operationId: 'first' })).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    expect(await h.client.request('cancel', { operationId: 'second' })).toEqual({ ok: true, value: { settled: true } })
  })

  it('caps the complete UTF-8 result including metadata and multibyte entry names', async () => {
    const h = await mount({ maxResultBytes: 600, maxFrameBytes: 2048 })
    for (const prefix of ['a', 'b', 'c']) await writeFile(join(h.root, prefix + '字'.repeat(60)), '')
    await h.initialize()
    const result = inspection.parse(await h.inspect('bytes'))
    expect(result).toMatchObject({ ok: true, value: { truncated: true } })
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(600)
    expect(h.frames.every(frame => Buffer.byteLength(frame.trimEnd(), 'utf8') <= 2048)).toBe(true)
  })

  it('waits for actual Loader settlement before initialize responds', async () => {
    const h = await mount()
    const entered = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    releases.push(() => { gate.resolve(undefined) })
    h.ctx.loader.builtins.delayed = { async apply() { entered.resolve(undefined); await gate.promise } }
    const load = h.ctx.loader.create({ name: 'cordis:delayed' })
    await entered.promise
    let answered = false
    const initializing = h.initialize().then((value) => { answered = true; return value })
    await h.client.request('probe', {})
    expect(answered).toBe(false)
    gate.resolve(undefined)
    await load
    await initializing
    expect(answered).toBe(true)
  })

  it('acknowledges cancellation only after the external read settles and refuses concurrent excess', async () => {
    const h = await mount({ maxConcurrentOperations: 1 })
    await h.initialize()
    const barrier = await blockRead(h.root)
    const operation = h.inspect('held')
    await barrier.entered
    expect(await h.inspect('excess')).toMatchObject({ error: { code: 'BUSY' } })
    let acknowledged = false
    const cancellation = h.client.request('cancel', { operationId: 'held' }).then((value) => { acknowledged = true; return value })
    await h.client.request('probe', {})
    expect(acknowledged).toBe(false)
    barrier.release()
    expect(await operation).toMatchObject({ error: { code: 'CANCELLED' } })
    expect(await cancellation).toEqual({ ok: true, value: { settled: true } })
  })

  it('waits for timed-out filesystem work to settle', async () => {
    const h = await mount({ operationTimeoutMs: 10 })
    await h.initialize()
    const barrier = await blockRead(h.root)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let answered = false
    const operation = h.inspect('deadline').then((value) => { answered = true; return value })
    await barrier.entered
    await vi.advanceTimersByTimeAsync(10)
    await h.client.request('probe', {})
    expect(answered).toBe(false)
    barrier.release()
    expect(await operation).toMatchObject({ error: { code: 'OPERATION_TIMEOUT' } })
  })

  it('sanitizes real filesystem failures from a cyclic symbolic link', async () => {
    const h = await mount()
    await h.initialize()
    const cycle = join(h.root, 'private-path-cycle')
    await symlink(cycle, cycle, process.platform === 'win32' ? 'junction' : 'dir')
    try {
      expect(await h.inspect('failure', 'private-path-cycle')).toEqual({
        ok: false, error: { code: 'OPERATION_FAILED', message: 'Directory inspection failed' },
      })
    } finally {
      await unlink(cycle)
    }
  })

  it('shutdown joins active work, flushes its acknowledgment, and disposes the root', async () => {
    const h = await mount()
    await h.initialize()
    const barrier = await blockRead(h.root)
    const operation = h.inspect('shutdown-work')
    await barrier.entered
    let acknowledged = false
    const shutdown = h.client.request('shutdown', {}).then((value) => { acknowledged = true; return value })
    await h.client.request('probe', {})
    expect(acknowledged).toBe(false)
    barrier.release()
    expect(await operation).toMatchObject({ error: { code: 'CANCELLED' } })
    expect(await shutdown).toEqual({ ok: true, value: {} })
    await h.waitForExit()
    expect(h.exits).toEqual([0])
    expect(h.input.listenerCount('data')).toBe(0)
    expect(h.ctx.get('fs')).toBeUndefined()
  })

  it('keeps transport inactive until the launcher commits successful startup', async () => {
    const h = await createHarness({}, { deferReady: true })
    cleanups.push(h.dispose)
    const initialized = h.initialize()
    expect(h.input.listenerCount('data')).toBe(0)
    expect(h.frames).toEqual([])
    h.ready.commit()
    await initialized
    expect(h.input.listenerCount('data')).toBe(1)
  })

  it('keeps startup failure authoritative when EOF arrives before readiness', async () => {
    const h = await createHarness({}, { deferReady: true })
    cleanups.push(h.dispose)
    h.input.end()
    expect(h.exits).toEqual([])
    await h.ctx.fiber.dispose()
    h.ready.commit()
    expect(h.exits).toEqual([])
    expect(h.frames).toEqual([])
  })

  it('requests launcher exit for buffered EOF only after successful startup', async () => {
    const h = await createHarness({}, { deferReady: true })
    cleanups.push(h.dispose)
    h.input.end()
    expect(h.exits).toEqual([])
    h.ready.commit()
    await h.waitForExit()
    expect(h.exits).toEqual([0])
  })

  it.each(['eof', 'plugin-dispose'] as const)('%s removes listeners and joins active reads', async (reason) => {
    const h = await mount()
    await h.initialize()
    const barrier = await blockRead(h.root)
    const operation = h.inspect('disposal-work').catch(() => undefined)
    await barrier.entered
    if (reason === 'eof') {
      h.input.end()
      await new Promise<void>(resolve => setImmediate(resolve))
    }
    let settled = false
    const disposal = (reason === 'eof' ? h.waitForExit() : h.ctx.fiber.dispose()).then(() => { settled = true })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(settled).toBe(false)
    barrier.release()
    await disposal
    h.client.close()
    await operation
    expect(h.input.listenerCount('data')).toBe(0)
    expect(h.ctx.get('subprocess')).toBeUndefined()
  })
})

describe('worker configuration validation', () => {
  it('fails activation when the launcher does not provide readiness and exit', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const ctx = new Context()
    cleanups.push(() => ctx.fiber.dispose())
    await expect(Worker.apply(ctx, {})).rejects.toThrow('launcher must provide')
  })

  it('fails activation for non-directory roots and oversized initialization metadata', async () => {
    const h = await mount()
    const file = join(h.root, 'regular-file')
    await writeFile(file, '')
    await expect(Worker.apply(h.ctx, { roots: [{ id: 'bad', label: 'Bad', path: file }] })).rejects.toThrow('not a directory')
    await expect(Worker.apply(h.ctx, {
      roots: [{ id: 'large', label: 'x'.repeat(1024), path: h.root }], maxResultBytes: 600, maxFrameBytes: 2048,
    })).rejects.toThrow('exceed maxResultBytes')
  })
  it.each([
    { roots: [{ id: 'x', label: 'X', path: 'relative' }] },
    { operationTimeoutMs: 0 }, { operationTimeoutMs: 2147483648 },
    { maxEntries: 1.5 }, { maxResultBytes: 0 }, { maxFrameBytes: Infinity },
    { maxConcurrentOperations: -1 }, { maxCompletedOperations: 0 },
    { maxResultBytes: 2048, maxFrameBytes: 2048 },
    { roots: [{ id: 'x', label: 'X', path: '/root' }, { id: 'x', label: 'Other', path: '/other' }] },
  ])('rejects invalid deployment fields: %j', (config) => {
    expect(() => resolveConfig(config)).toThrow()
  })
})
