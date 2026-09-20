/** Authenticated Remote calls cross real OpenSSH encryption into a production Loader worker. */
import { expect, it } from 'vitest'
import { createHarness as createSshHarness } from '../../../execution-host/execution-host-targets/tests/harness.ts'
import { createHarness, remoteResult, success } from './harness.ts'
import type { InspectionValue, ListTargetsValue, TargetValue } from '../src/types.ts'

it('saves through Remote, authenticates, inspects, reconnects, and removes without changing the managing Host', async () => {
  const ssh = await createSshHarness()
  const worker = await ssh.worker('remote-managed', { process: true })
  const host = await createHarness({ sshExecutable: 'ssh', sshConfigFile: ssh.configPath })
  const initial = await success<ListTargetsValue>(await host.http('list'))
  const { target } = await success<TargetValue>(await host.http('create', {
    request: { label: 'Loopback SSH', sshAlias: worker.alias },
  }))
  const stream = await host.socket()
  stream.follow('ssh-status')
  const connected = await success<TargetValue>(await host.desktop('connect', {
    request: { id: target.id, revision: target.revision },
  }))
  if (connected.target.state.phase !== 'ready') throw new Error('SSH worker did not become ready')
  const generation = connected.target.state.generation
  await stream.waitForSnapshot('ssh-status', value => value.targets.some(row => row.state.phase === 'ready'))
  const request = { id: target.id, generation, rootId: 'project', path: '' }
  const inspection = await success<InspectionValue>(await host.http('inspectDirectory', { request }))
  expect(inspection.inspection.entries).toContainEqual({ name: 'remote-managed.txt', type: 'file' })
  expect(inspection.inspection.executionHostId).not.toBe(initial.current.hostId)
  expect(worker.commands).toEqual(['dsh --profile execution-host'])
  expect(worker.childPids).toHaveLength(1)
  expect(worker.childPids[0]).not.toBe(process.pid)
  expect(worker.authentication.some(value => value === 'publickey:worker:true:true')).toBe(true)
  expect((await success<ListTargetsValue>(await host.http('list'))).current).toEqual(initial.current)
  expect(JSON.stringify(await host.savedDocument())).not.toContain(ssh.configPath)
  await success(await host.http('disconnect', { request: { id: target.id } }))
  await worker.exited
  const reconnect = await success<TargetValue>(await host.http('connect', { request: { id: target.id, revision: target.revision } }))
  if (reconnect.target.state.phase !== 'ready') throw new Error('SSH reconnect did not become ready')
  expect(reconnect.target.state.generation).not.toBe(generation)
  expect(await remoteResult(await host.http('inspectDirectory', { request })))
    .toMatchObject({ ok: false, error: { code: 'execution-host/connection-lost' } })
  await success(await host.http('removeTarget', { request: { id: target.id, revision: target.revision } }))
  expect((await success<ListTargetsValue>(await host.desktop('list'))).targets).toEqual([])
}, 30_000)

it('propagates HTTP cancellation to the real SSH worker and waits for acknowledged cleanup', async () => {
  const ssh = await createSshHarness()
  const worker = await ssh.worker('remote-cancel', { process: true })
  const host = await createHarness({ sshExecutable: 'ssh', sshConfigFile: ssh.configPath })
  const { target } = await success<TargetValue>(await host.http('create', { request: { label: 'Cancellation', sshAlias: worker.alias } }))
  const connected = await success<TargetValue>(await host.http('connect', { request: { id: target.id, revision: target.revision } }))
  if (connected.target.state.phase !== 'ready') throw new Error('SSH worker did not become ready')
  const request = { id: target.id, generation: connected.target.state.generation, rootId: 'project', path: '' }
  const hold = worker.hold()
  const controller = new AbortController()
  const pending = host.http('inspectDirectory', { request }, true, controller.signal)
  const rejected = expect(pending).rejects.toThrow()
  await hold.entered
  controller.abort()
  await rejected
  await hold.cancelled
  hold.release()
  await success(await host.http('disconnect', { request: { id: target.id } }))
  await worker.exited
  expect((await success<ListTargetsValue>(await host.http('list'))).targets[0]?.state.phase).toBe('disconnected')
}, 30_000)

it('withdraws Remote readiness on SSH transport loss and never falls back to local inspection', async () => {
  const ssh = await createSshHarness()
  const worker = await ssh.worker('remote-loss', { process: true })
  const host = await createHarness({ sshExecutable: 'ssh', sshConfigFile: ssh.configPath })
  const { target } = await success<TargetValue>(await host.http('create', { request: { label: 'Drop', sshAlias: worker.alias } }))
  const connected = await success<TargetValue>(await host.http('connect', { request: { id: target.id, revision: target.revision } }))
  if (connected.target.state.phase !== 'ready') throw new Error('SSH worker did not become ready')
  const stream = await host.socket()
  stream.follow('lost-ssh')
  worker.drop()
  await stream.waitForSnapshot('lost-ssh', value => value.targets.some(row => row.state.phase === 'error'))
  expect(await remoteResult(await host.http('inspectDirectory', { request: {
    id: target.id, generation: connected.target.state.generation, rootId: 'project', path: '',
  } }))).toMatchObject({ ok: false, error: { code: 'execution-host/connection-lost' } })
  expect(worker.commands).toEqual(['dsh --profile execution-host'])
}, 30_000)
