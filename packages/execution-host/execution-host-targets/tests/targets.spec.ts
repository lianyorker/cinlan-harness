/** Saved target behavior through actual SSH, source Loader, storage and filesystem providers. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHarness } from './harness.ts'
import type { TargetView } from '../src/types.ts'

function ready(target: TargetView) {
  if (target.state.phase !== 'ready') throw new Error('expected connected target')
  return { id: target.id, generation: target.state.generation, rootId: target.state.info.roots[0]!.id, path: '' }
}

async function connected(alias = 'target') {
  const h = await createHarness()
  const worker = await h.worker(alias)
  const { ctx, targets, fiber } = await h.registry()
  const saved = (await targets.create({ label: 'Remote project', sshAlias: alias })).target
  const target = (await targets.connect({ id: saved.id, revision: saved.revision }).catch((cause: unknown) => {
    throw new Error('SSH authentication steps: ' + worker.authentication.join(', '), { cause })
  })).target
  return { h, ctx, targets, worker, saved, target, fiber }
}

describe('saved execution targets through OpenSSH and real Loader composition', () => {
  it('authenticates and inspects distinct remote roots without changing current process provenance', async () => {
    const h = await createHarness()
    const leftWorker = await h.worker('left')
    const rightWorker = await h.worker('right')
    await mkdir(join(leftWorker.directory, 'same'))
    await mkdir(join(rightWorker.directory, 'same'))
    await writeFile(join(leftWorker.directory, 'same', 'left-only.txt'), 'left')
    await writeFile(join(rightWorker.directory, 'same', 'right-only.txt'), 'right')
    const { ctx, targets } = await h.registry()
    const local = ctx.executionHost.current()
    const left = (await targets.create({ label: 'Left', sshAlias: 'left' })).target
    const right = (await targets.create({ label: 'Right', sshAlias: 'right' })).target
    const [leftReady, rightReady] = await Promise.all([
      targets.connect({ id: left.id, revision: left.revision }), targets.connect({ id: right.id, revision: right.revision }),
    ])
    const [leftListing, rightListing] = await Promise.all([
      targets.inspectDirectory({ ...ready(leftReady.target), path: 'same' }),
      targets.inspectDirectory({ ...ready(rightReady.target), path: 'same' }),
    ])
    expect(leftListing.inspection.entries).toEqual([{ name: 'left-only.txt', type: 'file' }])
    expect(rightListing.inspection.entries).toEqual([{ name: 'right-only.txt', type: 'file' }])
    expect(leftListing.inspection.executionHostId).not.toBe(rightListing.inspection.executionHostId)
    expect(leftListing.inspection.executionHostId).not.toBe(local.hostId)
    expect(targets.list().current).toEqual(local)
    expect(leftWorker.commands).toEqual(['dsh --profile execution-host'])
    expect(rightWorker.commands).toEqual(['dsh --profile execution-host'])
    expect(leftWorker.frames.join('')).toContain('left-only.txt')
  })

  it('persists only saved metadata and refuses concurrent stale revisions', async () => {
    const { h, ctx, targets, saved } = await connected()
    const changes = await Promise.allSettled([
      targets.update({ id: saved.id, revision: saved.revision, label: 'First', sshAlias: 'target' }),
      targets.update({ id: saved.id, revision: saved.revision, label: 'Stale', sshAlias: 'target' }),
    ])
    expect(changes[0]?.status).toBe('fulfilled')
    expect(changes[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
    await ctx.fiber.dispose()
    const restored = await h.registry()
    expect(restored.targets.list().targets).toEqual([{ ...saved, label: 'First', revision: 2,
      updatedAt: expect.any(String) as unknown, state: { phase: 'disconnected' } }])
    await expect(restored.targets.remove({ id: saved.id, revision: 1 })).rejects.toMatchObject({ code: 'conflict' })
    await restored.targets.remove({ id: saved.id, revision: 2 })
    expect(restored.targets.list().targets).toEqual([])
  })

  it('rejects flags, shell fragments and unknown fields before persisting any target', async () => {
    const h = await createHarness()
    const { targets } = await h.registry()
    for (const sshAlias of ['-oProxyCommand=whoami', 'good;uname', 'user@host', 'https://host']) {
      expect(() => targets.create({ label: 'Invalid', sshAlias })).toThrow('Invalid execution target request')
    }
    expect(() => targets.create({ label: 'Invalid', sshAlias: 'valid', command: 'uname' } as never)).toThrow('Invalid execution target request')
    expect(targets.list().targets).toEqual([])
  })

  it('rejects timeout configuration outside the runtime timer range at load', async () => {
    const h = await createHarness()
    await expect(h.registry({ operationTimeoutMs: 2147483640, shutdownTimeoutMs: 10 })).rejects.toThrow(
      'Inspection timeout plus two shutdown deadlines exceeds the Node timer limit',
    )
    await expect(h.registry({ connectTimeoutMs: 2147483648 })).rejects.toThrow()
  })

  it('requires an explicitly exported root before publishing readiness', async () => {
    const h = await createHarness()
    await h.worker('empty', { roots: false })
    const { targets } = await h.registry()
    const { target } = await targets.create({ label: 'Empty', sshAlias: 'empty' })
    await expect(targets.connect({ id: target.id, revision: 1 })).rejects.toMatchObject({ code: 'roots-unconfigured' })
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code: 'roots-unconfigured' })
  })

  it.each([
    ['wrong host key', { wrongHostKey: true }, 'host-key-mismatch'],
    ['bad authentication', { denyAuthentication: true }, 'authentication-required'],
  ] as const)('refuses %s before starting any remote worker command', async (_label, options, code) => {
    const h = await createHarness()
    const worker = await h.worker('refused', options)
    const { targets } = await h.registry()
    const { target } = await targets.create({ label: 'Refused', sshAlias: 'refused' })
    await expect(targets.connect({ id: target.id, revision: 1 })).rejects.toMatchObject({ code })
    expect(worker.commands).toEqual([])
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code })
  })

  it('reports unavailable OpenSSH without substituting local filesystem execution', async () => {
    const h = await createHarness()
    const { targets } = await h.registry({ sshExecutable: 'dsh-no-such-openssh-fixture' })
    const { target } = await targets.create({ label: 'Unavailable', sshAlias: 'missing' })
    await expect(targets.connect({ id: target.id, revision: 1 })).rejects.toMatchObject({ code: 'ssh-unavailable' })
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code: 'ssh-unavailable' })
  })

  it('preserves the saved id across fresh worker incarnations and rejects stale generations', async () => {
    const { targets, saved, target } = await connected()
    const old = ready(target)
    const oldInspection = await targets.inspectDirectory(old)
    const next = (await targets.connect({ id: saved.id, revision: saved.revision })).target
    expect(next.id).toBe(saved.id)
    expect(ready(next).generation).toBeGreaterThan(old.generation)
    await expect(targets.inspectDirectory(old)).rejects.toMatchObject({ code: 'connection-lost' })
    const inspection = await targets.inspectDirectory(ready(next))
    expect(inspection.inspection.executionHostId).not.toBe(oldInspection.inspection.executionHostId)
  })

  it('enforces remote root containment through the actual worker request', async () => {
    const { targets, target } = await connected()
    await expect(targets.inspectDirectory({ ...ready(target), path: '../outside' })).rejects.toMatchObject({ code: 'inspection-failed' })
    await expect(targets.inspectDirectory({ ...ready(target), rootId: 'not-exported' })).rejects.toMatchObject({ code: 'invalid-request' })
    expect((await targets.inspectDirectory(ready(target))).inspection.entries).toEqual([{ name: 'target.txt', type: 'file' }])
  })

  it('awaits explicit remote cancellation acknowledgement while keeping the connection usable', async () => {
    const { targets, target, worker } = await connected()
    const gate = worker.hold()
    const controller = new AbortController()
    let settled = false
    const operation = targets.inspectDirectory(ready(target), controller.signal)
    const result = operation.catch((error: unknown) => { settled = true; return error })
    await gate.entered
    controller.abort()
    await gate.cancelled
    expect(settled).toBe(false)
    gate.release()
    expect(await result).toMatchObject({ code: 'cancelled' })
    expect((await targets.inspectDirectory(ready(target))).inspection.entries).toHaveLength(1)
  })

  it('disconnect waits for admitted inspection settlement', async () => {
    const { targets, target, worker } = await connected()
    const gate = worker.hold()
    const operation = targets.inspectDirectory(ready(target)).catch((error: unknown) => error)
    await gate.entered
    let disconnected = false
    const closing = targets.disconnect({ id: target.id }).then((value) => { disconnected = true; return value })
    await gate.cancelled
    expect(disconnected).toBe(false)
    gate.release()
    expect(await operation).toMatchObject({ code: 'cancelled' })
    expect((await closing).target.state).toEqual({ phase: 'disconnected' })
  })

  it('transport loss leaves an unconfirmed outcome and invalidates readiness', async () => {
    const { targets, target, worker } = await connected()
    const gate = worker.hold()
    const operation = targets.inspectDirectory(ready(target)).catch((error: unknown) => error)
    await gate.entered
    worker.drop()
    expect(await operation).toMatchObject({ code: 'outcome-unconfirmed' })
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code: 'connection-lost' })
    gate.release()
  })

  it('registry unload cancels and joins the actual SSH operation before disposal completes', async () => {
    const { fiber, targets, target, worker } = await connected()
    const gate = worker.hold()
    const operation = targets.inspectDirectory(ready(target)).catch((error: unknown) => error)
    await gate.entered
    let disposed = false
    const disposal = fiber.dispose().then(() => { disposed = true })
    await gate.cancelled
    expect(disposed).toBe(false)
    gate.release()
    expect(await operation).toMatchObject({ code: 'cancelled' })
    await disposal
    expect(() => targets.list()).toThrow('Execution target registry is unavailable')
  })

  it('full Host shutdown reports unconfirmed work when the process provider closes first', async () => {
    const { ctx, targets, target, worker } = await connected()
    const gate = worker.hold()
    const operation = targets.inspectDirectory(ready(target)).catch((error: unknown) => error)
    await gate.entered
    await ctx.fiber.dispose()
    expect(await operation).toMatchObject({ code: 'outcome-unconfirmed' })
    gate.release()
  })

  it('retires a malformed peer and releases the remote worker without a later UI action', async () => {
    const { targets, worker } = await connected()
    worker.writeProtocol('not-json\n')
    await worker.exited
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code: 'connection-lost' })
  })

  it.each(['error', 'mismatched-result'] as const)('retires a stale worker incarnation reported by %s', async (mode) => {
    const { targets, target, worker } = await connected()
    worker.replaceNextResult(mode === 'error'
      ? { ok: false, error: { code: 'STALE_HOST', message: 'incarnation changed' } }
      : { ok: true, value: { executionHostId: 'unexpected-worker', rootId: 'project', path: '', entries: [], truncated: false } })
    await expect(targets.inspectDirectory(ready(target))).rejects.toMatchObject({ code: 'connection-lost' })
    await worker.exited
    expect(targets.list().targets[0]?.state).toMatchObject({ phase: 'error', code: 'connection-lost' })
    await expect(targets.inspectDirectory(ready(target))).rejects.toMatchObject({ code: 'connection-lost' })
  })

  it('preserves a worker deadline error as a typed timeout', async () => {
    const { targets, target, worker } = await connected()
    worker.replaceNextResult({ ok: false, error: { code: 'OPERATION_TIMEOUT', message: 'Directory inspection timed out' } })
    await expect(targets.inspectDirectory(ready(target))).rejects.toMatchObject({ code: 'timeout' })
    expect((await targets.inspectDirectory(ready(target))).inspection.entries).toHaveLength(1)
  })

  it('does not admit a replacement SSH worker after unload begins during cancellation', async () => {
    const { fiber, targets, target, worker } = await connected()
    const gate = worker.hold()
    const inspection = targets.inspectDirectory(ready(target)).catch((error: unknown) => error)
    await gate.entered
    const replacement = targets.connect({ id: target.id, revision: target.revision }).catch((error: unknown) => error)
    await gate.cancelled
    const disposal = fiber.dispose()
    gate.release()
    expect(await inspection).toMatchObject({ code: 'cancelled' })
    expect(await replacement).toMatchObject({ code: 'closed' })
    await disposal
    expect(worker.commands).toEqual(['dsh --profile execution-host'])
  })
})
