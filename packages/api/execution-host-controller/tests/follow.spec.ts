/** Follow snapshots and teardown through the real authenticated stream carrier and Gateway iterator. */
import { describe, expect, it, vi } from 'vitest'
import type { ListTargetsValue, TargetValue } from '../src/types.ts'
import { createHarness, remoteResult, success } from './harness.ts'

const CONTROLLER = '@deepseek-ai/dsh-api-execution-host-controller'

describe('executionHosts follow composition', () => {
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
    const source = await h.ctx.typertGateway.stream({ namespace: 'executionHosts', method: 'follow', args: {}, signal: cancellation.signal })
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
