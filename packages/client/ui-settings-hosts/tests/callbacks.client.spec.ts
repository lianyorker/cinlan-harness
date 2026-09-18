/** Generated-result adaptation preserves values, failures, request fences, and cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHostsCallbacks } from '../src/client/callbacks.ts'
import { baseline, failure, inspection, readyTarget, remoteFixture, target } from './fixtures.client.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  const fixture = remoteFixture()
  new TestRemote(ctx, { executionHosts: fixture.remote })
  return { ...fixture, callbacks: createHostsCallbacks(fixture.remote) }
}

describe('execution host callbacks', () => {
  it('unwraps all successful management methods and passes exact revisions, generations and signals', async () => {
    const b = bench()
    for (const name of ['list', 'create', 'update', 'removeTarget', 'connect', 'disconnect', 'inspectDirectory'] as const) vi.spyOn(b.remote, name)
    const signal = new AbortController().signal
    const draft = { label: 'Build', sshAlias: 'build-host' }
    const revision = { id: target.id, revision: target.revision }
    const request = { id: target.id, generation: 4, rootId: 'project', path: 'src' }
    expect(await b.callbacks.list(signal)).toBe(baseline)
    expect(await b.callbacks.create(draft, signal)).toEqual({ target })
    expect(await b.callbacks.update({ ...draft, ...revision }, signal)).toEqual({ target })
    expect(await b.callbacks.removeTarget(revision, signal)).toEqual({})
    expect(await b.callbacks.connect(revision, signal)).toEqual({ target: readyTarget })
    expect(await b.callbacks.disconnect({ id: target.id }, signal)).toEqual({ target })
    expect(await b.callbacks.inspectDirectory(request, signal)).toEqual({ inspection, target: readyTarget })
    expect(b.remote.list).toHaveBeenCalledWith(signal)
    expect(b.remote.create).toHaveBeenCalledWith(draft, signal)
    expect(b.remote.update).toHaveBeenCalledWith({ ...draft, ...revision }, signal)
    expect(b.remote.removeTarget).toHaveBeenCalledWith(revision, signal)
    expect(b.remote.connect).toHaveBeenCalledWith(revision, signal)
    expect(b.remote.disconnect).toHaveBeenCalledWith({ id: target.id }, signal)
    expect(b.remote.inspectDirectory).toHaveBeenCalledWith(request, signal)
  })

  it('throws the original typed error without hiding its details', async () => {
    const b = bench()
    const error = new RemoteError('gateway/bad-request', 'Alias was rejected', {
      issues: [{ path: ['sshAlias'], message: 'Alias is not configured' }],
    })
    b.remote.update = async () => ({ ok: false, error })
    await expect(b.callbacks.update({ id: target.id, revision: 3, label: 'Draft', sshAlias: 'draft-alias' })).rejects.toBe(error)
  })

  it('passes raw live snapshots through and preserves stream errors', async () => {
    const b = bench()
    const controller = new AbortController()
    const iterator = b.callbacks.follow(controller.signal)[Symbol.asyncIterator]()
    try {
      expect(await iterator.next()).toEqual({ done: false, value: baseline })
      b.frames.push({ ...baseline, targets: [readyTarget] })
      expect(await iterator.next()).toEqual({ done: false, value: { ...baseline, targets: [readyTarget] } })
      const error = failure('execution-host/connection-lost')
      b.frames.fail(error)
      await expect(iterator.next()).rejects.toBe(error)
      expect(b.frames.closed).toBe(1)
    } finally { controller.abort(); await iterator.return?.() }
  })
})
