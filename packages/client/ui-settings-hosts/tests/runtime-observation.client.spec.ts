/** Runtime receipts survive renderer disposal; only explicit cancellation mutates Host tasks. */
import { expect, it, vi } from 'vitest'
import { observeRuntimes } from '../src/client/runtime-observation.ts'
import { createHostsCallbacks } from '../src/client/callbacks.ts'
import { feed, remoteFixture, runtimeTask } from './fixtures.client.ts'

it('recovers running tasks, detaches on disposal, and cancels only an explicit exact id', async () => {
  const { remote } = remoteFixture()
  const frames = feed({ task: runtimeTask })
  remote.listRuntimeTasks = async () => ({ ok: true, value: { tasks: [runtimeTask] } })
  remote.followRuntimeTask = (_request, signal) => frames.open(signal)
  const cancel = vi.spyOn(remote, 'cancelRuntimeTask')
  const first = observeRuntimes(createHostsCallbacks(remote))
  await vi.waitFor(() => { expect(first.source.getSnapshot().tasks[0]?.state).toBe('running') })
  await first.dispose()
  expect(frames.closed).toBe(1)
  expect(cancel).not.toHaveBeenCalled()
  const recovered = observeRuntimes(createHostsCallbacks(remote))
  try {
    await vi.waitFor(() => { expect(recovered.source.getSnapshot().tasks[0]?.id).toBe(runtimeTask.id) })
    await recovered.cancel({ id: runtimeTask.id })
    expect(cancel).toHaveBeenCalledWith({ id: runtimeTask.id }, expect.any(AbortSignal))
    expect(recovered.source.getSnapshot().tasks[0]?.state).toBe('cancelled')
  } finally { await recovered.dispose() }
})

it('surfaces interrupted observations and restores them through refresh', async () => {
  const { remote } = remoteFixture()
  let frames = feed({ task: runtimeTask })
  remote.listRuntimeTasks = async () => ({ ok: true, value: { tasks: [runtimeTask] } })
  remote.followRuntimeTask = (_request, signal) => frames.open(signal)
  const observation = observeRuntimes(createHostsCallbacks(remote))
  try {
    await vi.waitFor(() => { expect(observation.source.getSnapshot().tasks).toHaveLength(1) })
    frames.fail(new Error('Transport disconnected'))
    await vi.waitFor(() => { expect(observation.source.getSnapshot().status).toBe('error') })
    frames = feed({ task: runtimeTask })
    await observation.refresh()
    frames.push({ task: { ...runtimeTask, state: 'succeeded' } })
    await vi.waitFor(() => { expect(observation.source.getSnapshot().tasks[0]?.state).toBe('succeeded') })
  } finally { await observation.dispose() }
})
