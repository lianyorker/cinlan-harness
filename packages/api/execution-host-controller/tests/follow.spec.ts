/** Follow snapshots and teardown through the real authenticated stream carrier and Gateway iterator. */
import { describe, expect, it, vi } from 'vitest'
import { RuntimeError } from '@deepseek-ai/dsh-execution-runtime'
import type ExecutionRuntimes from '@deepseek-ai/dsh-execution-runtime'
import type { ExecutionTargetId } from '@deepseek-ai/dsh-execution-host-targets/types'
import type { RuntimeTaskId, RuntimeTaskRequest, RuntimeTaskValue } from '@deepseek-ai/dsh-execution-runtime/types'
import type { ListTargetsValue, TargetValue } from '../src/types.ts'
import { createHarness, remoteResult, success } from './harness.ts'

const CONTROLLER = '@deepseek-ai/dsh-api-execution-host-controller'

describe('executionHosts follow composition', () => {
  it('captures trusted-local authority before iterating runtime task receipts', async () => {
    const h = await createHarness()
    const task = { id: 'runtime-stream' as RuntimeTaskId, target: { id: 'target' as ExecutionTargetId, revision: 1 },
      operation: 'install' as const, state: 'running' as const, startedAt: '2026-09-20T00:00:00.000Z' }
    const follow = vi.fn(async function*(): AsyncGenerator<RuntimeTaskValue> {
      yield { task }
      yield { task: { ...task, state: 'failed', completedAt: '2026-09-20T00:00:01.000Z', error: 'fixture failure' } }
    })
    h.ctx.provide('executionRuntimes')
    h.ctx.set('executionRuntimes', { follow } as unknown as ExecutionRuntimes)
    const stream = await h.socket()
    stream.socket.send(JSON.stringify({ type: 'open', streamId: 'runtime', endpoint: 'executionHosts/followRuntimeTask',
      payload: { args: { request: { id: task.id } } } }))
    await vi.waitFor(() => {
      expect(stream.frames.filter(frame => frame.type === 'item' && frame.streamId === 'runtime')).toHaveLength(2)
    })
    const values = stream.frames.filter(frame => frame.type === 'item' && frame.streamId === 'runtime')
      .map(frame => (frame as Extract<typeof frame, { type: 'item' }>).value as RuntimeTaskValue)
    expect(values.map(value => value.task.state)).toEqual(['running', 'failed'])
    expect(follow).toHaveBeenCalledOnce()
  })

  it('ends blocked runtime observation after cleanup and recovers its retained task on controller reload', async () => {
    const h = await createHarness()
    const task = { id: 'retained-runtime' as RuntimeTaskId, target: { id: 'target' as ExecutionTargetId, revision: 1 },
      operation: 'install' as const, state: 'running' as const, startedAt: '2026-09-20T00:00:00.000Z' }
    const blocked = Promise.withResolvers<undefined>()
    const cleaning = Promise.withResolvers<undefined>()
    const releaseCleanup = Promise.withResolvers<undefined>()
    const returned = vi.fn(async () => {
      cleaning.resolve(undefined); await releaseCleanup.promise; return { done: true as const, value: undefined }
    })
    const cancel = vi.fn()
    const follow = vi.fn((_request: RuntimeTaskRequest, signal?: AbortSignal): AsyncIterable<RuntimeTaskValue> => {
      let initial = true
      return { [Symbol.asyncIterator]() { return {
        next: async () => {
          if (initial) { initial = false; return { done: false as const, value: { task } } }
          return await new Promise<IteratorResult<RuntimeTaskValue, undefined>>((_resolve, reject) => {
            const abort = (): void => {
              const reason: unknown = signal?.reason
              reject(reason instanceof Error ? reason : new Error('Observation aborted'))
            }
            signal?.addEventListener('abort', abort, { once: true })
            blocked.resolve(undefined)
            if (signal?.aborted) abort()
          })
        },
        return: returned,
      } } }
    })
    h.ctx.provide('executionRuntimes')
    h.ctx.set('executionRuntimes', { follow, cancel, listTasks: () => ({ tasks: [task] }) } as unknown as ExecutionRuntimes)
    const stream = await h.socket()
    const open = (streamId: string): void => { stream.socket.send(JSON.stringify({
      type: 'open', streamId, endpoint: 'executionHosts/followRuntimeTask', payload: { args: { request: { id: task.id } } },
    })) }
    try {
      open('runtime-before')
      await blocked.promise
      const disposing = h.setEnabled(CONTROLLER, false)
      await cleaning.promise
      expect(stream.frames.filter(frame => frame.streamId === 'runtime-before' && frame.type !== 'item')).toEqual([])
      releaseCleanup.resolve(undefined)
      await disposing
      await vi.waitFor(() => { expect(stream.frames).toContainEqual({ type: 'end', streamId: 'runtime-before' }) })
      expect(returned).toHaveBeenCalledOnce()
      expect(cancel).not.toHaveBeenCalled()
      await h.setEnabled(CONTROLLER, true)
      expect(await success(await h.desktop('listRuntimeTasks'))).toEqual({ tasks: [task] })
      open('runtime-after')
      await vi.waitFor(() => { expect(stream.frames).toContainEqual({ type: 'item', streamId: 'runtime-after', value: { task } }) })
      stream.cancel('runtime-after')
      await vi.waitFor(() => { expect(returned).toHaveBeenCalledTimes(2) })
      expect(cancel).not.toHaveBeenCalled()
      expect(stream.frames.filter(frame => frame.type === 'error')).toEqual([])
    } finally { releaseCleanup.resolve(undefined) }
  })

  it.each([
    { failure: new RuntimeError('verification-failed'), code: 'execution-runtime/verification-failed', disposing: false },
    { failure: new Error('private diagnostic'), code: 'execution-host/inspection-failed', disposing: false },
    { failure: new RuntimeError('verification-failed'), code: 'execution-runtime/verification-failed', disposing: true },
    { failure: new Error('private diagnostic'), code: 'execution-host/inspection-failed', disposing: true },
  ])('preserves $code observation failures with controller disposal=$disposing', async ({ failure, code, disposing }) => {
    const h = await createHarness()
    h.ctx.provide('executionRuntimes')
    const blocked = Promise.withResolvers<undefined>()
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }))
    h.ctx.set('executionRuntimes', { follow: (_request: RuntimeTaskRequest, signal: AbortSignal) => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<RuntimeTaskValue, undefined>>((_resolve, reject) => {
          blocked.resolve(undefined)
          if (disposing) signal.addEventListener('abort', () => { reject(failure) }, { once: true })
          else reject(failure)
        }), return: returned,
      }),
    }) } as unknown as ExecutionRuntimes)
    const stream = await h.socket()
    stream.socket.send(JSON.stringify({ type: 'open', streamId: 'runtime-failure', endpoint: 'executionHosts/followRuntimeTask',
      payload: { args: { request: { id: 'runtime-failure' } } } }))
    await blocked.promise
    if (disposing) await h.setEnabled(CONTROLLER, false)
    await vi.waitFor(() => {
      const frame = stream.frames.find(value => value.type === 'error')
      expect(frame?.type === 'error' ? frame.error.code : undefined).toBe(code)
    })
    expect(returned).toHaveBeenCalledOnce()
    expect(JSON.stringify(stream.frames)).not.toContain('private diagnostic')
  })

  it('publishes complete baselines and changes, cancels one stream, and closes the remaining socket subscription', async () => {
    const h = await createHarness()
    const stream = await h.socket()
    stream.follow('a')
    stream.follow('b')
    const initial = await stream.waitForSnapshot('a', value => value.targets.length === 0)
    expect(initial.current).toEqual(h.ctx.executionHost.current())
    await stream.waitForSnapshot('b', value => value.targets.length === 0)
    expect(h.subscriptions()).toBe(2)
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: 'Observed', sshAlias: 'observed' } }))
    const created = await stream.waitForSnapshot('a', value => value.targets.some(item => item.id === target.id))
    expect(created).toEqual({ current: initial.current, targets: [target] })
    await stream.waitForSnapshot('b', value => value.targets.some(item => item.id === target.id))
    stream.cancel('a')
    await vi.waitFor(() => { expect(h.subscriptions()).toBe(1) })
    const settledCount = stream.snapshots('a').length
    const updated = await success<TargetValue>(await h.http('update', { request: {
      id: target.id, revision: 1, label: 'Updated', sshAlias: 'updated',
    } }))
    const changed = await stream.waitForSnapshot('b', value => value.targets.some(item => item.revision === 2))
    expect(changed.targets).toEqual([updated.target])
    expect(stream.snapshots('a')).toHaveLength(settledCount)
    stream.socket.close()
    await stream.closed
    await vi.waitFor(() => { expect(h.subscriptions()).toBe(0) })
    expect(stream.errors).toEqual([])
  })

  it('subscribes before returning the baseline and coalesces changes while the Gateway consumer is paused', async () => {
    const h = await createHarness()
    const cancellation = new AbortController()
    const source = await h.ctx.typertGateway.stream({
      namespace: 'executionHosts', method: 'follow', args: {}, signal: cancellation.signal, access: h.ctx.connection.trustedAccess,
    })
    const iterator = source[Symbol.asyncIterator]()
    try {
      expect(h.subscriptions()).toBe(0)
      expect(await iterator.next()).toEqual({ done: false, value: { current: h.ctx.executionHost.current(), targets: [] } })
      expect(h.subscriptions()).toBe(1)
      const first = await success<TargetValue>(await h.http('create', { request: { label: 'First', sshAlias: 'first' } }))
      await success(await h.http('update', { request: { id: first.target.id, revision: 1, label: 'Revised', sshAlias: 'revised' } }))
      const second = await success<TargetValue>(await h.http('create', { request: { label: 'Second', sshAlias: 'second' } }))
      await success(await h.http('removeTarget', { request: { id: first.target.id, revision: 2 } }))
      const latest = await success<ListTargetsValue>(await h.http('list'))
      expect(latest.targets).toEqual([second.target])
      expect(await iterator.next()).toEqual({ done: false, value: latest })
      const waiting = iterator.next()
      cancellation.abort(new Error('test consumer cancelled'))
      await expect(waiting).rejects.toMatchObject({ code: 'gateway/cancelled' })
      expect(h.subscriptions()).toBe(0)
    } finally {
      cancellation.abort()
      await iterator.return?.()
    }
  })

  it('ends an active authenticated stream when the controller is disposed and follows a reloaded controller', async () => {
    const h = await createHarness()
    const stream = await h.socket()
    stream.follow('before-disposal')
    await stream.waitForSnapshot('before-disposal', value => value.targets.length === 0)
    expect(h.subscriptions()).toBe(1)
    await h.setEnabled(CONTROLLER, false)
    await vi.waitFor(() => {
      expect(stream.frames).toContainEqual({ type: 'end', streamId: 'before-disposal' })
      expect(h.subscriptions()).toBe(0)
    })
    const withdrawn = await h.http('list')
    expect(withdrawn.status).toBe(404)
    expect(await withdrawn.text()).toBe('not found')
    await h.setEnabled(CONTROLLER, true)
    stream.follow('after-reload')
    await stream.waitForSnapshot('after-reload', value => value.targets.length === 0)
    expect(h.subscriptions()).toBe(1)
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: 'After reload', sshAlias: 'reloaded' } }))
    await stream.waitForSnapshot('after-reload', value => value.targets.some(item => item.id === target.id))
    expect(stream.snapshots('before-disposal')).toHaveLength(1)
  })

  it('enforces the streaming transport and publishes provider failures as complete target observations', async () => {
    const h = await createHarness()
    expect(await remoteResult(await h.http('follow'))).toMatchObject({ ok: false, error: { code: 'gateway/signature-invalid' } })
    const stream = await h.socket()
    stream.follow('failures')
    await stream.waitForSnapshot('failures', value => value.targets.length === 0)
    const { target } = await success<TargetValue>(await h.http('create', { request: { label: 'Missing executable', sshAlias: 'configured-alias' } }))
    await stream.waitForSnapshot('failures', value => value.targets.length === 1)
    expect(await remoteResult(await h.http('connect', { request: { id: target.id, revision: 1 } })))
      .toMatchObject({ ok: false, error: { code: 'execution-host/ssh-unavailable' } })
    const failed = await stream.waitForSnapshot('failures', value => value.targets[0]?.state.phase === 'error')
    expect(failed.targets[0]?.state).toMatchObject({ phase: 'error', generation: 1, code: 'ssh-unavailable' })
    expect(stream.snapshots('failures').some(value => value.targets.some(item => item.state.phase === 'ready'))).toBe(false)
    expect(JSON.stringify(failed)).not.toContain(h.root)
  })
})
