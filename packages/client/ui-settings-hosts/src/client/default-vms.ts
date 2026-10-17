/** Fallback initial state for ephemeral VM catalog and quotas. */
import type { EphemeralVmOverview, VmRecipe } from './types.ts'

export const DEFAULT_VM_RECIPES: readonly VmRecipe[] = [
  {
    id: 'developer-runtime',
    name: 'Debian 12 Developer Runtime',
    cpuCores: 2,
    memoryMb: 4096,
    timeoutMinutes: 120,
    image: 'debian-12',
    skills: ['dev-tools'],
    status: 'approved',
    description: 'Lightweight testing and development container',
  },
  {
    id: 'security-sandbox',
    name: 'Security Audit & Reverse Sandbox',
    cpuCores: 4,
    memoryMb: 8192,
    timeoutMinutes: 240,
    image: 'debian-12-security',
    skills: ['radare2', 'gdb'],
    status: 'approved',
    description: 'General purpose workloads and builds',
  },
  {
    id: 'minimal-worker',
    name: 'Minimal Isolated Worker',
    cpuCores: 1,
    memoryMb: 2048,
    timeoutMinutes: 60,
    image: 'debian-12-minimal',
    skills: [],
    status: 'approved',
    description: 'High-intensity testing and compilation',
  },
]

export const DEFAULT_VM_OVERVIEW: EphemeralVmOverview = {
  recipes: DEFAULT_VM_RECIPES,
  vms: [],
  quota: {
    maxActiveVms: 5,
    maxCpuCores: 8,
    maxMemoryMb: 16384,
  },
  usage: {
    activeVms: 0,
    allocatedCpuCores: 0,
    allocatedMemoryMb: 0,
  },
}
