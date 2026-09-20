/** Production Loader/target mutation queue races at the durable table write boundary. */
import { expect, it, vi } from 'vitest'
import { createHarness } from '../../execution-host-targets/tests/harness.ts'
import type { SshExecutionConfiguration } from '../../execution-host-targets/src/types.ts'
import Runtime from '../src/index.ts'
import type { RuntimeGeneration, RuntimeInspection } from '../src/types.ts'

const provisioning = vi.hoisted(() => ({ run: vi.fn(), artifact: vi.fn() }))
vi.mock('../src/transport.ts', () => ({ runRemoteOperation: provisioning.run }))
vi.mock('../src/artifact.ts', () => ({ readRuntimeArtifact: provisioning.artifact }))

it.each(['explicit cancellation', 'Host disposal'])('rejects %s while activation waits behind another target write', async (reason) => {
  const h = await createHarness(); const { targets } = await h.registry()
  const first = (await targets.create({ label: 'First', sshAlias: 'first' })).target
  const other = (await targets.create({ label: 'Other', sshAlias: 'other' })).target
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  // Observe the real storage table used by this Loader-created service; activation itself remains unmocked.
  const table = Reflect.get(targets, 'table') as { put(key: string, value: unknown): Promise<void> }
  const original = table.put.bind(table)
  const write = vi.spyOn(table, 'put').mockImplementationOnce(async (key, value) => {
    entered.resolve(undefined); await release.promise; await original(key, value)
  })
  const barrier = targets.update({ id: other.id, revision: 1, label: 'Other updated', sshAlias: 'other' })
  await entered.promise
  const signal = new AbortController()
  const deployment: SshExecutionConfiguration = { endpoint: { host: 'fixture', port: 22, username: 'fixture',
    privateKeyFile: h.root + '/key', hostKeySHA256: 'a'.repeat(64) }, node: '/usr/bin/node', workspace: '/srv/workspace',
  helper: '/opt/runtime/a/helper.js', helperHash: 'b'.repeat(64), bootstrapPath: '/opt/runtime/a/process.js', bootstrapHash: 'c'.repeat(64) }
  const activation = expect(targets.activateExecution({ id: first.id, revision: 1 }, deployment, signal.signal)).rejects.toThrow(reason)
  signal.abort(new Error(reason)); release.resolve(undefined)
  await barrier; await activation
  expect(targets.list().targets.find(target => target.id === first.id)).toMatchObject({ revision: 1 })
  expect(targets.list().targets.find(target => target.id === first.id)?.execution).toBeUndefined()
  expect(write).toHaveBeenCalledOnce()
})

it('preserves activation that has entered persistence when cancellation arrives', async () => {
  const h = await createHarness(); const { targets } = await h.registry()
  const target = (await targets.create({ label: 'Target', sshAlias: 'target' })).target
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  const table = Reflect.get(targets, 'table') as { put(key: string, value: unknown): Promise<void> }
  const original = table.put.bind(table)
  vi.spyOn(table, 'put').mockImplementationOnce(async (key, value) => {
    entered.resolve(undefined); await release.promise; await original(key, value)
  })
  const controller = new AbortController()
  const activation = targets.activateExecution({ id: target.id, revision: 1 }, {
    endpoint: { host: 'fixture', port: 22, username: 'fixture', privateKeyFile: h.root + '/key', hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', workspace: '/srv/workspace', helper: '/opt/runtime/a/helper.js', helperHash: 'b'.repeat(64),
    bootstrapPath: '/opt/runtime/a/process.js', bootstrapHash: 'c'.repeat(64),
  }, controller.signal)
  await entered.promise; controller.abort(new Error('cancel after persistence started')); release.resolve(undefined)
  await expect(activation).resolves.toMatchObject({ target: { revision: 2 } })
})

it.each(['cancel', 'dispose'])('propagates actual runtime %s into queued target persistence', async (action) => {
  const h = await createHarness(); const { ctx, targets } = await h.registry()
  const first = (await targets.create({ label: 'Runtime', sshAlias: 'runtime' })).target
  const other = (await targets.create({ label: 'Barrier', sshAlias: 'barrier' })).target
  const inspection: RuntimeInspection = { state: 'installed', platform: 'linux', arch: 'x64', node: '/usr/bin/node',
    nodeVersion: 'v24.9.0', installRoot: '/opt/runtime', generation: 'a'.repeat(64) as RuntimeGeneration,
    helper: '/opt/runtime/generations/a/helper.js', helperHash: 'b'.repeat(64),
    bootstrapPath: '/opt/runtime/generations/a/process.js', bootstrapHash: 'c'.repeat(64), protocol: 1 }
  provisioning.artifact.mockResolvedValue({ generation: inspection.generation })
  provisioning.run.mockResolvedValue(inspection)
  const internal = ctx.loader.internal
  if (internal === undefined) throw new Error('Source Loader importer is missing')
  if (internal.version === 'v1') {
    const originalImport = internal.import.bind(internal)
    internal.import = async (name, parentURL, importAttributes) => {
      if (name === 'runtime-install-test') return Runtime
      const imported: unknown = await originalImport(name, parentURL, importAttributes)
      return imported
    }
  } else {
    const originalImport = internal.import.bind(internal)
    internal.import = async (name, parentURL, importAttributes, phase, isEntryPoint) => {
      if (name === 'runtime-install-test') return Runtime
      const imported: unknown = await originalImport(name, parentURL, importAttributes, phase, isEntryPoint)
      return imported
    }
  }
  await ctx.loader.create({ name: 'runtime-install-test', config: { artifactDirectory: h.root, manifestSHA256: 'a'.repeat(64) } })
  await ctx.loader.await()
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.name === 'runtime-install-test')?.fiber
  if (fiber === undefined) throw new Error('Runtime installer was not Loader-admitted')
  const runtime = ctx.executionRuntimes
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  const queued = Promise.withResolvers<undefined>()
  const table = Reflect.get(targets, 'table') as { put(key: string, value: unknown): Promise<void> }
  const originalPut = table.put.bind(table)
  const writes = vi.spyOn(table, 'put').mockImplementationOnce(async (key, value) => {
    entered.resolve(undefined); await release.promise; await originalPut(key, value)
  })
  const originalActivation = targets.activateExecution.bind(targets)
  vi.spyOn(targets, 'activateExecution').mockImplementation((...args) => {
    const promise = originalActivation(...args); queued.resolve(undefined); return promise
  })
  const blocking = targets.update({ id: other.id, revision: 1, label: 'Barrier update', sshAlias: 'barrier' })
  await entered.promise
  const receipt = runtime.start({ operation: 'install', target: { id: first.id, revision: 1 },
    endpoint: { host: 'fixture', port: 22, username: 'fixture', privateKeyFile: h.root + '/key', hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', installRoot: '/opt/runtime', workspace: '/srv/workspace' })
  await queued.promise
  const cancellation = action === 'cancel' ? runtime.cancel({ id: receipt.task.id }) : fiber.dispose()
  release.resolve(undefined); await blocking; await cancellation
  if (action === 'cancel') expect(runtime.get({ id: receipt.task.id }).task.state).toBe('cancelled')
  else expect(runtime.listTasks().tasks).toEqual([])
  expect(targets.list().targets.find(target => target.id === first.id)).toMatchObject({ revision: 1 })
  expect(targets.list().targets.find(target => target.id === first.id)?.execution).toBeUndefined()
  expect(writes).toHaveBeenCalledOnce()
})
