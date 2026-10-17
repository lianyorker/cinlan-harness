/** Ephemeral VM catalog, quota admission, and lifecycle management. */
import { randomUUID } from 'node:crypto'
import { RuntimeError } from './errors.ts'
import type {
  DestroyVmRequest,
  EphemeralVm,
  EphemeralVmId,
  EphemeralVmOverview,
  LaunchVmRequest,
  VmQuotaLimits,
  VmRecipe,
} from './types.ts'

/** Approved standard VM recipes available for on-demand provisioning. */
export const DEFAULT_VM_RECIPES: readonly VmRecipe[] = [
  {
    id: 'recipe-debian-dev',
    name: 'Debian 12 Developer Runtime',
    description: 'General-purpose Debian 12 environment with Node.js 22, Git, and standard CLI build tools.',
    cpuCores: 2,
    memoryMb: 4096,
    timeoutMinutes: 60,
    image: 'registry.clh.local/debian-12-slim:latest',
    skills: ['bash-tool', 'git-cli', 'nodejs-runtime'],
    status: 'approved',
  },
  {
    id: 'recipe-security-audit',
    name: 'Security Audit & Reverse Sandbox',
    description: 'Isolated container with static analysis, symbol stripping, and binary disassembly tools.',
    cpuCores: 4,
    memoryMb: 8192,
    timeoutMinutes: 120,
    image: 'registry.clh.local/sec-audit-sandbox:v2',
    skills: ['binary-diff', 'code-security', 'decompilation'],
    status: 'approved',
  },
  {
    id: 'recipe-isolated-worker',
    name: 'Minimal Isolated Worker',
    description: 'Zero-network sandboxed container for reproducible batch command and script execution.',
    cpuCores: 1,
    memoryMb: 2048,
    timeoutMinutes: 30,
    image: 'registry.clh.local/isolated-worker:latest',
    skills: ['sandboxed-eval'],
    status: 'approved',
  },
]

/** Default system-wide quota limits for active ephemeral VMs. */
export const DEFAULT_VM_QUOTA: VmQuotaLimits = {
  maxActiveVms: 5,
  maxCpuCores: 8,
  maxMemoryMb: 16384,
}

export interface LaunchVmOptions {
  readonly signal?: AbortSignal
  readonly authorized?: boolean
  readonly isHostOnline?: (hostId: string) => boolean
}

export interface DestroyVmOptions {
  readonly simulateFailure?: boolean
}

export interface ReapVmOptions {
  readonly now?: number
  readonly isHostOnline?: (hostId: string) => boolean
}

/** In-memory manager for ephemeral VM lifecycles and recipe admission. */
export class EphemeralVmManager {
  private readonly recipes = new Map<string, VmRecipe>()
  private readonly vms = new Map<EphemeralVmId, EphemeralVm>()
  private quota: VmQuotaLimits

  constructor(
    initialRecipes: readonly VmRecipe[] = DEFAULT_VM_RECIPES,
    initialQuota: VmQuotaLimits = DEFAULT_VM_QUOTA,
  ) {
    for (const recipe of initialRecipes) {
      this.recipes.set(recipe.id, recipe)
    }
    this.quota = { ...initialQuota }
  }

  /**
   * List all registered VM recipes.
   * @returns array of registered recipes.
   */
  listRecipes(): readonly VmRecipe[] {
    return [...this.recipes.values()]
  }

  /**
   * Find a specific recipe by ID.
   * @param id - recipe ID.
   * @returns recipe or undefined if not found.
   */
  getRecipe(id: string): VmRecipe | undefined {
    return this.recipes.get(id)
  }

  /**
   * Register or override a VM recipe.
   * @param recipe - recipe specification.
   */
  registerRecipe(recipe: VmRecipe): void {
    this.recipes.set(recipe.id, recipe)
  }

  /**
   * List all tracked VM instances.
   * @returns array of VM instances.
   */
  listVms(): readonly EphemeralVm[] {
    return [...this.vms.values()]
  }

  /**
   * Find a VM instance by ID.
   * @param id - branded VM ID.
   * @returns VM or undefined if not found.
   */
  getVm(id: EphemeralVmId): EphemeralVm | undefined {
    return this.vms.get(id)
  }

  /**
   * Calculate current quota and resource utilization overview.
   * @returns complete overview snapshot.
   */
  getOverview(): EphemeralVmOverview {
    const active = [...this.vms.values()].filter(vm => vm.state === 'running' || vm.state === 'provisioning')
    const allocatedCpuCores = active.reduce((sum, vm) => sum + vm.resourceAllocation.cpuCores, 0)
    const allocatedMemoryMb = active.reduce((sum, vm) => sum + vm.resourceAllocation.memoryMb, 0)

    return {
      recipes: this.listRecipes(),
      vms: this.listVms(),
      quota: { ...this.quota },
      usage: {
        activeVms: active.length,
        allocatedCpuCores,
        allocatedMemoryMb,
      },
    }
  }

  /**
   * Launch a new ephemeral VM from an approved recipe.
   * @param request - launch parameters.
   * @param options - validation options including authorization and host status.
   * @returns newly created VM instance.
   */
  launchVm(request: LaunchVmRequest, options?: LaunchVmOptions): EphemeralVm {
    if (options?.authorized === false) {
      throw new RuntimeError('unauthorized')
    }

    if (options?.signal?.aborted) {
      throw new RuntimeError('cancelled')
    }

    const recipe = this.recipes.get(request.recipeId)
    if (!recipe || recipe.status !== 'approved') {
      throw new RuntimeError('unknown-recipe')
    }

    const trimmedLabel = request.label.trim()
    if (!trimmedLabel) {
      throw new RuntimeError('invalid-config')
    }

    // Check duplicate label among active VMs
    const activeVms = [...this.vms.values()].filter(
      vm => vm.state === 'provisioning' || vm.state === 'running',
    )
    if (activeVms.some(vm => vm.label.toLowerCase() === trimmedLabel.toLowerCase())) {
      throw new RuntimeError('duplicate-request')
    }

    // Check host online status if a target host was pinned
    if (request.targetHostId && options?.isHostOnline?.(request.targetHostId) === false) {
      throw new RuntimeError('host-offline')
    }

    // Check quota admission
    const currentCpu = activeVms.reduce((sum, vm) => sum + vm.resourceAllocation.cpuCores, 0)
    const currentMemory = activeVms.reduce((sum, vm) => sum + vm.resourceAllocation.memoryMb, 0)

    if (activeVms.length + 1 > this.quota.maxActiveVms) {
      throw new RuntimeError('quota-exceeded')
    }
    if (currentCpu + recipe.cpuCores > this.quota.maxCpuCores) {
      throw new RuntimeError('quota-exceeded')
    }
    if (currentMemory + recipe.memoryMb > this.quota.maxMemoryMb) {
      throw new RuntimeError('quota-exceeded')
    }

    const now = Date.now()
    const timeout = request.timeoutMinutes ?? recipe.timeoutMinutes
    const expiresAt = new Date(now + timeout * 60_000).toISOString()
    const id = `ephemeral-vm-${randomUUID().slice(0, 8)}` as EphemeralVmId

    const octet3 = Math.floor(Math.random() * 254) + 1
    const octet4 = Math.floor(Math.random() * 254) + 1
    const ipAddress = `10.244.${octet3}.${octet4}`

    const vm: EphemeralVm = {
      id,
      recipeId: recipe.id,
      label: trimmedLabel,
      state: 'running',
      createdAt: new Date(now).toISOString(),
      expiresAt,
      resourceAllocation: {
        cpuCores: recipe.cpuCores,
        memoryMb: recipe.memoryMb,
      },
      skills: [...recipe.skills],
      targetHostId: request.targetHostId,
      ipAddress,
    }

    this.vms.set(id, vm)
    return structuredClone(vm)
  }

  /**
   * Terminate and destroy an ephemeral VM instance.
   * @param request - target VM identifier.
   * @param options - execution controls.
   * @returns settled terminated VM instance.
   */
  destroyVm(request: DestroyVmRequest, options?: DestroyVmOptions): EphemeralVm {
    const existing = this.vms.get(request.id)
    if (!existing) {
      throw new RuntimeError('not-found')
    }

    if (options?.simulateFailure) {
      throw new RuntimeError('destroy-failed')
    }

    const terminated: EphemeralVm = {
      ...existing,
      state: 'terminated',
    }
    this.vms.set(request.id, terminated)
    return structuredClone(terminated)
  }

  /**
   * Clean up expired or orphaned VM instances whose host went offline.
   * @param options - time anchor and host liveness probe.
   * @returns list of reaped VM IDs.
   */
  reapOrphanedVms(options?: ReapVmOptions): readonly EphemeralVmId[] {
    const now = options?.now ?? Date.now()
    const reapedIds: EphemeralVmId[] = []

    for (const [id, vm] of this.vms.entries()) {
      if (vm.state !== 'running' && vm.state !== 'provisioning') {
        continue
      }

      const isExpired = Date.parse(vm.expiresAt) <= now
      const isHostDead = vm.targetHostId ? options?.isHostOnline?.(vm.targetHostId) === false : false

      if (isExpired || isHostDead) {
        const error = isExpired ? 'Lifetime expired' : 'Host unreachable'
        this.vms.set(id, {
          ...vm,
          state: 'terminated',
          error,
        })
        reapedIds.push(id)
      }
    }

    return reapedIds
  }
}
