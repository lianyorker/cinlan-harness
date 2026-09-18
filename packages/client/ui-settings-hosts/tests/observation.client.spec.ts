/** Snapshot ordering and follow disposal are driven by explicit promise barriers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { observeHosts } from '../src/client/observation.ts'
import { createHostsCallbacks } from '../src/client/callbacks.ts'
import { baseline, deferred, failure, readyTarget, remoteFixture } from './fixtures.client.ts'
import type { ListTargetsValue } from '@deepseek-ai/dsh-api-execution-host-controller/types'

const observers: ReturnType<typeof observeHosts>[] = []
afterEach(async () => { for (const observer of observers.splice(0)) await observer.dispose() })
function bench() {
  const b = remoteFixture()
  const observer = observeHosts(createHostsCallbacks(b.remote))
  observers.push(observer)
  return { ...b, observer }
}

describe('execution host observation', () => {
  it('follows ready and transport-loss snapshots without polling and awaits teardown', async () => {
    const b = bench()
    const list = vi.spyOn(b.remote, 'list')
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('ready') })
    b.frames.push({ ...baseline, targets: [readyTarget] })
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().value?.targets[0]?.state.phase).toBe('ready') })
    b.frames.fail(failure('execution-host/connection-lost'))
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('error') })
    expect(b.observer.source.getSnapshot().error?.code).toBe('execution-host/connection-lost')
    expect(list).not.toHaveBeenCalled()
    await b.observer.dispose()
    expect(b.frames.closed).toBe(1)
  })

  it('does not let an overlapping list response overwrite a newer stream frame', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('ready') })
    const read = deferred<ListTargetsValue>()
    b.remote.list = async () => ({ ok: true, value: await read.promise })
    const refresh = b.observer.refresh()
    const newer = { ...baseline, targets: [readyTarget] }
    b.frames.push(newer)
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().value).toBe(newer) })
    read.resolve(baseline)
    expect(await refresh).toBe(newer)
    expect(b.observer.source.getSnapshot().value).toBe(newer)
  })

  it('marks an ended stream unavailable and restarts on explicit refresh', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('ready') })
    b.frames.end()
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('error') })
    const replacement = remoteFixture({ ...baseline, targets: [readyTarget] })
    b.remote.follow = replacement.remote.follow
    await b.observer.refresh()
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().value?.targets[0]?.state.phase).toBe('ready') })
    await b.observer.dispose()
    expect(replacement.frames.closed).toBe(1)
  })

  it('prevents late list publication and waits for the active follow after disposal', async () => {
    const b = bench()
    await vi.waitFor(() => { expect(b.observer.source.getSnapshot().status).toBe('ready') })
    const read = deferred<ListTargetsValue>()
    b.remote.list = async () => ({ ok: true, value: await read.promise })
    const refresh = b.observer.refresh()
    const previous = b.observer.source.getSnapshot()
    await b.observer.dispose()
    read.resolve({ ...baseline, targets: [] })
    await refresh
    expect(b.observer.source.getSnapshot()).toBe(previous)
    expect(b.frames.closed).toBe(1)
  })
})
