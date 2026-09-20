/** Execution selection and runtime activation through production Loader, storage and owned SSH fixtures. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHarness } from './harness.ts'
import type { ExecutionTargetId, SavedTarget, SshExecutionConfiguration, SshExecutionSnapshot } from '../src/types.ts'

function deployment(root: string): SshExecutionConfiguration {
  return {
    endpoint: { host: 'remote.example', port: 2222, username: 'worker',
      privateKeyFile: join(root, 'private-key'), hostKeySHA256: 'a'.repeat(64) },
    node: '/usr/bin/node', helper: '/opt/dsh/helper.mjs', helperHash: 'b'.repeat(64), workspace: '/srv/project',
    bootstrapPath: '/opt/dsh/bootstrap.mjs', bootstrapHash: 'c'.repeat(64),
  }
}

function revision(target: SavedTarget) {
  return { id: target.id, revision: target.revision }
}

function editable(target: SavedTarget) {
  return { ...revision(target), label: target.label, sshAlias: target.sshAlias }
}

async function configured() {
  const h = await createHarness()
  const registry = await h.registry()
  const execution = deployment(h.root)
  const { target } = await registry.targets.create({ label: 'Execution', sshAlias: 'inspection', execution })
  return { ...registry, h, execution, target }
}

describe('saved SSH execution bindings', () => {
  it('retains exact predecessor deployments across activations and restart without exposing private history', async () => {
    const { h, ctx, targets, target, execution } = await configured()
    const original = targets.snapshotExecution(revision(target))
    const replacement = { ...execution, helper: '/generations/two/helper.mjs', bootstrapPath: '/generations/two/bootstrap.mjs',
      endpoint: { ...execution.endpoint, privateKeyFile: join(h.root, 'replacement-key'), host: 'replacement.example' } }
    const activated = (await targets.activateExecution(revision(target), replacement)).target
    const second = targets.snapshotExecution(revision(activated))
    expect(activated.revision).toBe(2)
    expect(activated.label).toBe(target.label)
    expect(activated.sshAlias).toBe(target.sshAlias)
    expect(activated.createdAt).toBe(target.createdAt)
    expect(activated).not.toHaveProperty('retainedExecutions')
    expect(targets.list().targets[0]).not.toHaveProperty('retainedExecutions')
    expect(targets.resolveExecution(original)).toEqual(execution)
    expect(targets.resolveExecution(second)).toEqual(replacement)
    expect(() => targets.snapshotExecution(revision(target))).toThrow(expect.objectContaining({ code: 'conflict' }))
    const thirdDeployment = { ...replacement, helper: '/generations/three/helper.mjs', bootstrapPath: '/generations/three/bootstrap.mjs' }
    const third = (await targets.activateExecution(revision(activated), thirdDeployment)).target
    expect(third.revision).toBe(3)
    await ctx.fiber.dispose()
    const restored = await h.registry()
    expect(restored.targets.resolveExecution(original)).toEqual(execution)
    expect(restored.targets.resolveExecution(second)).toEqual(replacement)
    expect(restored.targets.resolveExecution(restored.targets.snapshotExecution(revision(third)))).toEqual(thirdDeployment)
    expect(restored.targets.list().targets[0]).not.toHaveProperty('retainedExecutions')
    const resolved = restored.targets.resolveExecution(original)
    Object.assign(resolved.endpoint!, { privateKeyFile: 'caller-edit' })
    expect(restored.targets.resolveExecution(original)).toEqual(execution)
  })

  it('excludes ordinary edits and authorization acquisition in both call orders', async () => {
    const { targets, target } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    const authorization = targets.reserveExecution(snapshot)
    expect(() => { authorization.assertCurrent() }).not.toThrow()
    await expect(targets.update({ ...editable(target), label: 'Blocked edit', execution: target.execution }))
      .rejects.toMatchObject({ code: 'conflict' })
    authorization.release()
    authorization.release()
    expect(() => { authorization.assertCurrent() }).toThrow(expect.objectContaining({ code: 'conflict' }))

    const changing = targets.update({ ...editable(target), label: 'Committed edit', execution: target.execution })
    expect(() => targets.reserveExecution(snapshot)).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect((await changing).target).toMatchObject({ revision: target.revision + 1, label: 'Committed edit' })
  })

  it('contains a throwing change subscriber after runtime activation and persists the deployment', async () => {
    const { h, ctx, targets, target, execution } = await configured()
    const replacement = { ...execution, helper: '/generations/contained/helper.mjs' }
    const warnings: string[] = []
    let delivered = 0
    ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof ctx.logger.warn
    ctx.on('execution-host-targets/changed', () => { throw new Error('activation observer') })
    ctx.on('execution-host-targets/changed', () => { delivered++ })

    const activated = (await targets.activateExecution(revision(target), replacement)).target
    expect(activated).toMatchObject({ revision: 2, execution: replacement })
    expect(delivered).toBe(1)
    expect(warnings).toContain('execution-host-targets/changed listener threw: Error: activation observer')
    await ctx.fiber.dispose()

    const restored = await h.registry()
    const persisted = restored.targets.list().targets[0]!
    expect(persisted).toMatchObject({ revision: 2, execution: replacement })
    expect(restored.targets.resolveExecution(restored.targets.snapshotExecution(revision(persisted)))).toEqual(replacement)
  })

  it('keeps an active inspection connection and generation usable during runtime activation', async () => {
    const h = await createHarness()
    const worker = await h.worker('activation')
    const { targets } = await h.registry()
    const saved = (await targets.create({ label: 'Active', sshAlias: 'activation', execution: deployment(h.root) })).target
    const connected = (await targets.connect(revision(saved))).target
    if (connected.state.phase !== 'ready') throw new Error('expected ready inspection connection')
    const request = { id: saved.id, generation: connected.state.generation, rootId: connected.state.info.roots[0]!.id, path: '' }
    const next = (await targets.activateExecution(revision(saved), { ...deployment(h.root), helper: '/generation/two/helper.mjs' })).target
    expect(next.state).toEqual(connected.state)
    const inspected = await targets.inspectDirectory(request)
    expect(inspected.inspection.entries).toContainEqual({ name: 'activation.txt', type: 'file' })
    expect(inspected.target.revision).toBe(2)
    expect(worker.commands).toEqual(['dsh --profile execution-host'])
  })

  it('activates an inspection-only target without retaining an execution selection for its predecessor', async () => {
    const h = await createHarness()
    const { targets } = await h.registry()
    const target = (await targets.create({ label: 'Cold', sshAlias: 'inspection' })).target
    const next = (await targets.activateExecution(revision(target), deployment(h.root))).target
    expect(next.revision).toBe(2)
    const snapshot = targets.snapshotExecution(revision(next))
    expect(targets.resolveExecution(snapshot)).toEqual(deployment(h.root))
    expect(() => targets.resolveExecution({ ...snapshot, revision: 1 })).toThrow(expect.objectContaining({ code: 'conflict' }))
  })

  it('rejects altered public fields on retained snapshots', async () => {
    const { targets, target, execution } = await configured()
    const original = targets.snapshotExecution(revision(target))
    await targets.activateExecution(revision(target), { ...execution, helper: '/generation/two/helper.mjs' })
    for (const change of [
      { node: '/other/node' }, { helper: '/other/helper' }, { helperHash: 'd'.repeat(64) },
      { workspace: '/other/workspace' }, { bootstrapPath: '/other/bootstrap' }, { bootstrapHash: 'e'.repeat(64) },
    ]) {
      expect(() => targets.resolveExecution({ ...original, ...change })).toThrow(expect.objectContaining({ code: 'conflict' }))
    }
    for (const endpoint of [
      { ...original.endpoint, host: 'other.example' }, { ...original.endpoint, port: 22 },
      { ...original.endpoint, username: 'another' }, { ...original.endpoint, hostKeySHA256: 'f'.repeat(64) },
    ]) {
      expect(() => targets.resolveExecution({ ...original, endpoint })).toThrow(expect.objectContaining({ code: 'conflict' }))
    }
  })

  it.each(['label', 'credential', 'trust', 'remove'] as const)('invalidates retained history on ordinary %s mutation', async (kind) => {
    const { h, ctx, targets, target, execution } = await configured()
    const original = targets.snapshotExecution(revision(target))
    const active = (await targets.activateExecution(revision(target), { ...execution, helper: '/generation/two/helper.mjs' })).target
    const activeSnapshot = targets.snapshotExecution(revision(active))
    if (kind === 'remove') {
      await targets.remove(revision(active))
    } else {
      const currentExecution = active.execution!
      const nextExecution = kind === 'credential'
        ? { ...currentExecution, endpoint: { ...currentExecution.endpoint, privateKeyFile: join(h.root, 'rotated-key') } }
        : kind === 'trust'
          ? { ...currentExecution, endpoint: { ...currentExecution.endpoint, hostKeySHA256: 'd'.repeat(64) } }
          : currentExecution
      await targets.update({ ...editable(active), label: 'Edited', execution: nextExecution })
    }
    expect(() => targets.resolveExecution(original)).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(() => targets.resolveExecution(activeSnapshot)).toThrow(expect.objectContaining({ code: 'conflict' }))
    await ctx.fiber.dispose()
    const restored = await h.registry()
    expect(() => restored.targets.resolveExecution(original)).toThrow(expect.objectContaining({ code: 'conflict' }))
  })

  it('serializes activation races and leaves bytes and retained snapshots unchanged on failed CAS', async () => {
    const { h, targets, target, execution } = await configured()
    const original = targets.snapshotExecution(revision(target))
    const first = { ...execution, helper: '/first/helper.mjs' }
    const second = { ...execution, helper: '/second/helper.mjs' }
    const outcomes = await Promise.allSettled([
      targets.activateExecution(revision(target), first), targets.activateExecution(revision(target), second),
    ])
    expect(outcomes[0].status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } })
    const active = targets.list().targets[0]!
    expect(active.revision).toBe(2)
    expect(active.execution).toEqual(first)
    expect(targets.resolveExecution(original)).toEqual(execution)
    const path = join(h.root, 'storage', 'execution_host_targets.json')
    const before = await readFile(path, 'utf8')
    await expect(targets.activateExecution(revision(target), second)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(path, 'utf8')).toBe(before)
    expect(targets.list().targets[0]).toEqual(active)
    expect(targets.resolveExecution(original)).toEqual(execution)
  })

  it.each(['0', '1', '2', 'invalid'])('rejects a durable retained revision %s that is not a predecessor', async (key) => {
    const { h, ctx, target, execution } = await configured()
    const { state: _, ...record } = target
    await ctx.fiber.dispose()
    await writeFile(join(h.root, 'storage', 'execution_host_targets.json'), JSON.stringify({
      unit: { name: 'execution_host_targets', version: 2 }, global: null,
      tables: { targets: { [target.id]: { ...record, retainedExecutions: { [key]: execution } } } },
    }))
    await expect(h.registry()).rejects.toThrow(/record/i)
  })

  it('requires complete activation settings before changing selection', async () => {
    const { targets, target, execution } = await configured()
    expect(() => targets.activateExecution(revision(target), { ...execution, bootstrapPath: undefined, bootstrapHash: undefined }))
      .toThrow(expect.objectContaining({ code: 'incompatible' }))
    expect(() => targets.activateExecution(revision(target), { ...execution, helperHash: 'invalid' }))
      .toThrow(expect.objectContaining({ code: 'invalid-request' }))
    expect(targets.list().targets).toEqual([target])
  })

  it('captures frozen deployment identity and resolves cloned official SSH configuration after reload', async () => {
    const { h, ctx, targets, target, execution } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    expect(snapshot).toEqual({
      kind: 'ssh', targetId: target.id, revision: 1,
      endpoint: { host: 'remote.example', port: 2222, username: 'worker', hostKeySHA256: 'a'.repeat(64) },
      node: execution.node, helper: execution.helper, helperHash: execution.helperHash, workspace: execution.workspace,
      bootstrapPath: execution.bootstrapPath, bootstrapHash: execution.bootstrapHash,
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.endpoint)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain('privateKeyFile')
    expect(JSON.stringify(snapshot)).not.toContain(execution.endpoint.privateKeyFile)
    expect(snapshot).not.toHaveProperty('hostId')
    expect(() => Object.assign(snapshot.endpoint, { host: 'other' })).toThrow(TypeError)
    const resolved = targets.resolveExecution(snapshot)
    expect(resolved).toEqual(execution)
    expect(resolved).not.toBe(target.execution)
    expect(resolved.endpoint).not.toBe(target.execution!.endpoint)
    Object.assign(resolved.endpoint!, { host: 'caller-edit' })
    Object.assign(target.execution!.endpoint, { privateKeyFile: 'caller-edit' })
    Object.assign(execution.endpoint, { username: 'caller-edit' })
    expect(targets.resolveExecution(snapshot).endpoint).toEqual({ ...snapshot.endpoint, privateKeyFile: join(h.root, 'private-key') })
    await ctx.fiber.dispose()
    const restored = await h.registry()
    expect(restored.targets.snapshotExecution(revision(target))).toEqual(snapshot)
    expect(restored.targets.resolveExecution(JSON.parse(JSON.stringify(snapshot)) as SshExecutionSnapshot))
      .toEqual(deployment(h.root))
  })

  it('preserves version-one alias records and stamps the next write with the current domain version', async () => {
    const h = await createHarness()
    const legacy: SavedTarget = { id: '11111111-1111-4111-8111-111111111111' as ExecutionTargetId,
      revision: 1, label: 'Legacy', sshAlias: 'inspection',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    const root = join(h.root, 'storage')
    await mkdir(root)
    const path = join(root, 'execution_host_targets.json')
    await writeFile(path, JSON.stringify({ unit: { name: 'execution_host_targets', version: 1 },
      global: null, tables: { targets: { [legacy.id]: legacy } } }))
    const { targets } = await h.registry()
    expect(targets.list().targets).toEqual([{ ...legacy, state: { phase: 'disconnected' } }])
    expect(() => targets.snapshotExecution(revision(legacy))).toThrow(expect.objectContaining({ code: 'incompatible' }))
    const { target } = await targets.update({ ...editable(legacy), execution: deployment(h.root) })
    expect(targets.resolveExecution(targets.snapshotExecution(revision(target)))).toEqual(deployment(h.root))
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ unit: { version: 2 } })
  })

  it('allows inspection-only targets but requires the complete bootstrap pair for execution', async () => {
    const h = await createHarness()
    const { targets } = await h.registry()
    const legacy = (await targets.create({ label: 'Inspection', sshAlias: 'inspection' })).target
    expect(() => targets.snapshotExecution(revision(legacy))).toThrow(expect.objectContaining({ code: 'incompatible' }))
    const execution = { ...deployment(h.root), bootstrapPath: undefined, bootstrapHash: undefined }
    const partial = (await targets.create({ label: 'Helper only', sshAlias: 'inspection', execution })).target
    expect(() => targets.snapshotExecution(revision(partial))).toThrow(expect.objectContaining({ code: 'incompatible' }))
    for (const fields of [{ bootstrapPath: '/bootstrap.mjs' }, { bootstrapHash: 'c'.repeat(64) }]) {
      expect(() => targets.create({ label: 'Unpaired', sshAlias: 'inspection', execution: { ...execution, ...fields } }))
        .toThrow(expect.objectContaining({ code: 'invalid-request' }))
    }
  })

  it('rejects every altered public deployment field, even with an unchanged target revision', async () => {
    const { targets, target } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    const changes = {
      node: '/another/node', helper: '/another/helper', helperHash: 'd'.repeat(64), workspace: '/another/workspace',
      bootstrapPath: '/another/bootstrap', bootstrapHash: 'e'.repeat(64),
    }
    for (const [field, value] of Object.entries(changes)) {
      expect(() => targets.resolveExecution({ ...snapshot, [field]: value }))
        .toThrow(expect.objectContaining({ code: 'conflict' }))
    }
    for (const [field, value] of Object.entries({ host: 'another.example', port: 22, username: 'another', hostKeySHA256: 'f'.repeat(64) })) {
      expect(() => targets.resolveExecution({ ...snapshot, endpoint: { ...snapshot.endpoint, [field]: value } }))
        .toThrow(expect.objectContaining({ code: 'conflict' }))
    }
    expect(() => targets.resolveExecution({ ...snapshot, targetId: '22222222-2222-4222-8222-222222222222' as ExecutionTargetId }))
      .toThrow(expect.objectContaining({ code: 'conflict' }))
  })

  it('rejects malformed durable snapshots including injected credential locations', async () => {
    const { targets, target } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    for (const value of [
      { ...snapshot, kind: 'local' }, { ...snapshot, revision: 0 }, { ...snapshot, bootstrapHash: undefined },
      { ...snapshot, endpoint: { ...snapshot.endpoint, privateKeyFile: '/injected/key' } },
      { ...snapshot, workerHostId: 'worker' },
    ]) {
      expect(() => targets.resolveExecution(value as SshExecutionSnapshot))
        .toThrow(expect.objectContaining({ code: 'invalid-request' }))
    }
  })

  it('refuses stale and deleted bindings while already resolved configurations retain their original destination', async () => {
    const { targets, target, execution } = await configured()
    const old = targets.snapshotExecution(revision(target))
    const acquired = targets.resolveExecution(old)
    const replacement = { ...execution, endpoint: { ...execution.endpoint, host: 'replacement.example' } }
    const next = (await targets.update({ ...editable(target), execution: replacement })).target
    expect(() => targets.snapshotExecution(revision(target))).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(() => targets.resolveExecution(old)).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(acquired).toEqual(execution)
    const current = targets.snapshotExecution(revision(next))
    expect(targets.resolveExecution(current)).toEqual(replacement)
    await targets.remove(revision(next))
    expect(() => targets.resolveExecution(current)).toThrow(expect.objectContaining({ code: 'conflict' }))
    expect(acquired).toEqual(execution)
  })

  it('invalidates the saved revision when only the credential location changes', async () => {
    const { targets, target, execution, h } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    const next = (await targets.update({ ...editable(target), execution: { ...execution,
      endpoint: { ...execution.endpoint, privateKeyFile: join(h.root, 'rotated-key') } } })).target
    expect(() => targets.resolveExecution(snapshot)).toThrow(expect.objectContaining({ code: 'conflict' }))
    const replacement = targets.snapshotExecution(revision(next))
    expect(replacement).toEqual({ ...snapshot, revision: 2 })
    expect(targets.resolveExecution(replacement).endpoint!.privateKeyFile).toBe(join(h.root, 'rotated-key'))
  })

  it('removes execution settings when an update omits them and rejects resolution against an inspection target', async () => {
    const { targets, target } = await configured()
    const snapshot = targets.snapshotExecution(revision(target))
    const next = (await targets.update({ id: target.id, revision: target.revision, label: target.label, sshAlias: target.sshAlias })).target
    expect(next.execution).toBeUndefined()
    expect(() => targets.resolveExecution({ ...snapshot, revision: next.revision }))
      .toThrow(expect.objectContaining({ code: 'incompatible' }))
  })

  it('rejects invalid explicit endpoint and deployment configuration before saving', async () => {
    const h = await createHarness()
    const { targets } = await h.registry()
    const execution = deployment(h.root)
    for (const endpoint of [
      { ...execution.endpoint, port: 0 }, { ...execution.endpoint, port: 65536 },
      { ...execution.endpoint, host: '' }, { ...execution.endpoint, username: '' },
      { ...execution.endpoint, privateKeyFile: 'relative-key' }, { ...execution.endpoint, hostKeySHA256: 'SHA256:invalid' },
    ]) {
      expect(() => targets.create({ label: 'Invalid', sshAlias: 'inspection', execution: { ...execution, endpoint } }))
        .toThrow(expect.objectContaining({ code: 'invalid-request' }))
    }
    for (const change of [{ node: 'node' }, { helper: 'helper.mjs' }, { workspace: 'relative' },
      { bootstrapPath: 'bootstrap.mjs' }, { helperHash: 'invalid' }, { bootstrapHash: 'invalid' }, { host: 'alias' }]) {
      expect(() => targets.create({ label: 'Invalid', sshAlias: 'inspection', execution: { ...execution, ...change } }))
        .toThrow(expect.objectContaining({ code: 'invalid-request' }))
    }
    expect(targets.list().targets).toEqual([])
  })
})
