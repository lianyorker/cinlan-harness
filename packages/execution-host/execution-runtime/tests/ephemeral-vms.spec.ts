/** Ephemeral VM manager unit tests covering recipe admission, quota limits and lifecycle. */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VM_RECIPES,
  EphemeralVmManager,
} from '../src/ephemeral-vms.ts'
import { RuntimeError } from '../src/errors.ts'
import type { EphemeralVmId, VmRecipe } from '../src/types.ts'

describe('EphemeralVmManager', () => {
  it('lists default approved recipes with their resource specs and skills', () => {
    const manager = new EphemeralVmManager()
    const recipes = manager.listRecipes()

    expect(recipes.length).toBeGreaterThanOrEqual(3)
    const debian = recipes.find(r => r.id === 'recipe-debian-dev')
    expect(debian).toBeDefined()
    expect(debian?.status).toBe('approved')
    expect(debian?.cpuCores).toBe(2)
    expect(debian?.memoryMb).toBe(4096)
    expect(debian?.skills).toContain('nodejs-runtime')

    const secAudit = recipes.find(r => r.id === 'recipe-security-audit')
    expect(secAudit?.skills).toContain('code-security')
  })

  it('allows registering custom recipes and retrieving by ID', () => {
    const manager = new EphemeralVmManager()
    const customRecipe: VmRecipe = {
      id: 'recipe-custom-alpine',
      name: 'Custom Alpine 3.19',
      description: 'Ultra light alpine box',
      cpuCores: 1,
      memoryMb: 1024,
      timeoutMinutes: 15,
      image: 'registry.clh.local/alpine:3.19',
      skills: ['sh'],
      status: 'approved',
    }

    manager.registerRecipe(customRecipe)
    expect(manager.getRecipe('recipe-custom-alpine')).toEqual(customRecipe)
  })

  it('successfully launches an ephemeral VM from an approved recipe', () => {
    const manager = new EphemeralVmManager()
    const vm = manager.launchVm({
      recipeId: 'recipe-debian-dev',
      label: 'test-dev-vm',
      timeoutMinutes: 45,
    })

    expect(vm.id).toMatch(/^ephemeral-vm-[a-f0-9]+$/)
    expect(vm.label).toBe('test-dev-vm')
    expect(vm.state).toBe('running')
    expect(vm.resourceAllocation.cpuCores).toBe(2)
    expect(vm.resourceAllocation.memoryMb).toBe(4096)
    expect(vm.ipAddress).toMatch(/^10\.244\.\d+\.\d+$/)
    expect(vm.skills).toEqual(['bash-tool', 'git-cli', 'nodejs-runtime'])

    const expiryTime = Date.parse(vm.expiresAt)
    const createdTime = Date.parse(vm.createdAt)
    expect(expiryTime - createdTime).toBe(45 * 60_000)

    const list = manager.listVms()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(vm.id)
  })

  it('rejects launch with unknown or deprecated recipe (unknown-recipe)', () => {
    const manager = new EphemeralVmManager()

    expect(() => manager.launchVm({ recipeId: 'non-existent-recipe', label: 'box' }))
      .toThrowError(new RuntimeError('unknown-recipe'))

    manager.registerRecipe({
      id: 'recipe-deprecated',
      name: 'Old Fedora',
      description: 'End of life',
      cpuCores: 2,
      memoryMb: 4096,
      timeoutMinutes: 30,
      image: 'registry.clh.local/fedora:28',
      skills: [],
      status: 'deprecated',
    })

    expect(() => manager.launchVm({ recipeId: 'recipe-deprecated', label: 'box' }))
      .toThrowError(new RuntimeError('unknown-recipe'))
  })

  it('rejects launch from unauthorized caller (unauthorized)', () => {
    const manager = new EphemeralVmManager()

    expect(() => manager.launchVm(
      { recipeId: 'recipe-debian-dev', label: 'restricted' },
      { authorized: false },
    )).toThrowError(new RuntimeError('unauthorized'))
  })

  it('rejects launch when quota exceeded: active count, CPU cores, or RAM (quota-exceeded)', () => {
    const manager = new EphemeralVmManager(DEFAULT_VM_RECIPES, {
      maxActiveVms: 2,
      maxCpuCores: 4,
      maxMemoryMb: 8192,
    })

    // First VM: 2 cores, 4096 MB
    manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'vm-1' })

    // Second VM: 2 cores, 4096 MB (Total: 2 VMs, 4 cores, 8192 MB -> quota full)
    manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'vm-2' })

    // Third VM exceeds count quota
    expect(() => manager.launchVm({ recipeId: 'recipe-isolated-worker', label: 'vm-3' }))
      .toThrowError(new RuntimeError('quota-exceeded'))
  })

  it('rejects launch when CPU cores quota exceeded', () => {
    const manager = new EphemeralVmManager(DEFAULT_VM_RECIPES, {
      maxActiveVms: 5,
      maxCpuCores: 4,
      maxMemoryMb: 16384,
    })

    // Security audit consumes 4 CPU cores
    manager.launchVm({ recipeId: 'recipe-security-audit', label: 'sec-1' })

    // Trying to launch another 2-core VM exceeds 4 cores quota
    expect(() => manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'dev-1' }))
      .toThrowError(new RuntimeError('quota-exceeded'))
  })

  it('rejects launch with duplicate label for active VMs (duplicate-request)', () => {
    const manager = new EphemeralVmManager()
    manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'staging-box' })

    expect(() => manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'staging-box' }))
      .toThrowError(new RuntimeError('duplicate-request'))

    expect(() => manager.launchVm({ recipeId: 'recipe-debian-dev', label: '  staging-box  ' }))
      .toThrowError(new RuntimeError('duplicate-request'))
  })

  it('rejects launch when target host is offline (host-offline)', () => {
    const manager = new EphemeralVmManager()

    expect(() => manager.launchVm(
      { recipeId: 'recipe-debian-dev', label: 'remote-vm', targetHostId: 'host-edge-9' },
      { isHostOnline: hostId => hostId !== 'host-edge-9' },
    )).toThrowError(new RuntimeError('host-offline'))
  })

  it('rejects launch when AbortSignal is cancelled (cancelled)', () => {
    const manager = new EphemeralVmManager()
    const controller = new AbortController()
    controller.abort()

    expect(() => manager.launchVm(
      { recipeId: 'recipe-debian-dev', label: 'cancelled-vm' },
      { signal: controller.signal },
    )).toThrowError(new RuntimeError('cancelled'))
  })

  it('destroys an active VM cleanly (destroyVm)', () => {
    const manager = new EphemeralVmManager()
    const vm = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'destroy-target' })

    const destroyed = manager.destroyVm({ id: vm.id })
    expect(destroyed.state).toBe('terminated')
    expect(manager.getVm(vm.id)?.state).toBe('terminated')

    // After termination, resource quota is freed and same label can be re-launched
    const next = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'destroy-target' })
    expect(next.id).not.toBe(vm.id)
    expect(next.state).toBe('running')
  })

  it('handles destroy failure properly (destroy-failed)', () => {
    const manager = new EphemeralVmManager()
    const vm = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'failing-destroy' })

    expect(() => manager.destroyVm({ id: vm.id }, { simulateFailure: true }))
      .toThrowError(new RuntimeError('destroy-failed'))

    // State remains untouched
    expect(manager.getVm(vm.id)?.state).toBe('running')
  })

  it('throws not-found when destroying non-existent VM (not-found)', () => {
    const manager = new EphemeralVmManager()
    expect(() => manager.destroyVm({ id: 'ephemeral-vm-unknown' as EphemeralVmId }))
      .toThrowError(new RuntimeError('not-found'))
  })

  it('reaps expired VMs and VMs with offline hosts (reapOrphanedVms)', () => {
    const manager = new EphemeralVmManager()
    const now = Date.now()

    const vm1 = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'short-lived', timeoutMinutes: 10 })
    const vm2 = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'host-bound', targetHostId: 'host-dying' })
    const vm3 = manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'healthy-vm', timeoutMinutes: 60 })

    // Advance time past vm1's expiry and simulate host-dying going offline
    const futureTime = now + 15 * 60_000
    const reaped = manager.reapOrphanedVms({
      now: futureTime,
      isHostOnline: hostId => hostId !== 'host-dying',
    })

    expect(reaped).toContain(vm1.id)
    expect(reaped).toContain(vm2.id)
    expect(reaped).not.toContain(vm3.id)

    expect(manager.getVm(vm1.id)?.state).toBe('terminated')
    expect(manager.getVm(vm1.id)?.error).toBe('Lifetime expired')

    expect(manager.getVm(vm2.id)?.state).toBe('terminated')
    expect(manager.getVm(vm2.id)?.error).toBe('Host unreachable')

    expect(manager.getVm(vm3.id)?.state).toBe('running')
  })

  it('calculates accurate overview with resource allocation usage (getOverview)', () => {
    const manager = new EphemeralVmManager()
    const initialOverview = manager.getOverview()
    expect(initialOverview.usage.activeVms).toBe(0)
    expect(initialOverview.usage.allocatedCpuCores).toBe(0)
    expect(initialOverview.usage.allocatedMemoryMb).toBe(0)

    manager.launchVm({ recipeId: 'recipe-debian-dev', label: 'vm-a' }) // 2 cores, 4096 MB
    manager.launchVm({ recipeId: 'recipe-isolated-worker', label: 'vm-b' }) // 1 core, 2048 MB

    const runningOverview = manager.getOverview()
    expect(runningOverview.usage.activeVms).toBe(2)
    expect(runningOverview.usage.allocatedCpuCores).toBe(3)
    expect(runningOverview.usage.allocatedMemoryMb).toBe(6144)
    expect(runningOverview.vms).toHaveLength(2)
  })
})
