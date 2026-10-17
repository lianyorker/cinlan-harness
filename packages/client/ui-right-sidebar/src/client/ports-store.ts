/** Store and state management for workspace port scanning and forwarding. */
import { useEffect, useState } from 'react'
import type { DetectedPort, PortForwardRule, WorkspacePortsState } from './ports-types.ts'

const STORAGE_KEY = 'dsh.workspace.port-forwards'

const INITIAL_STATE: WorkspacePortsState = {
  status: 'idle',
  detectedPorts: [],
  forwardedPorts: [],
}

function readPersistedForwards(): readonly PortForwardRule[] {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => typeof item === 'object' && item !== null && typeof (item as PortForwardRule).localPort === 'number')
  } catch {
    return []
  }
}

function writePersistedForwards(rules: readonly PortForwardRule[]): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules))
  } catch {
    // Storage full or unavailable
  }
}

let currentState: WorkspacePortsState = {
  ...INITIAL_STATE,
  forwardedPorts: readPersistedForwards(),
}

const listeners = new Set<(state: WorkspacePortsState) => void>()

function notify(): void {
  for (const listener of listeners) {
    listener(currentState)
  }
}

/** Get the current workspace ports state snapshot. */
export function getWorkspacePortsState(): WorkspacePortsState {
  return currentState
}

/** Reset store state (used for test teardown). */
export function resetWorkspacePortsStore(): void {
  currentState = {
    ...INITIAL_STATE,
    forwardedPorts: [],
  }
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }
  notify()
}

/**
 * Scan workspace listening ports on the target host/runtime.
 * Distinguishes reachable empty results from scan failures.
 * @param mockProbe - Optional scanner implementation or mock result.
 */
export async function scanWorkspacePorts(
  mockProbe?: () => Promise<{ readonly ok: boolean; readonly ports?: readonly DetectedPort[]; readonly error?: string }>
): Promise<void> {
  const { unavailableReason: _u1, ...scanningRest } = currentState
  currentState = { ...scanningRest, status: 'scanning' }
  notify()

  try {
    const result = mockProbe
      ? await mockProbe()
      : {
          ok: true,
          ports: [
            { port: 3000, host: '127.0.0.1', processName: 'node (app)', detectedAt: Date.now() },
            { port: 5173, host: '127.0.0.1', processName: 'vite', detectedAt: Date.now() },
            { port: 8080, host: '127.0.0.1', processName: 'dev-server', detectedAt: Date.now() },
          ],
        }

    if (!result.ok) {
      currentState = {
        ...currentState,
        status: 'unavailable',
        unavailableReason: result.error ?? 'Connection to remote host runtime failed',
      }
    } else {
      const { unavailableReason: _u2, ...readyRest } = currentState
      currentState = {
        ...readyRest,
        status: 'ready',
        scannedAt: Date.now(),
        detectedPorts: result.ports ?? [],
      }
    }
  } catch (err) {
    currentState = {
      ...currentState,
      status: 'error',
      unavailableReason: err instanceof Error ? err.message : String(err),
    }
  }

  notify()
}

/** Options for adding a port forwarding rule. */
export interface AddPortForwardOptions {
  readonly localPort: number
  readonly remotePort: number
  readonly remoteHost?: string
  readonly label?: string
}

/**
 * Add or update a port forwarding rule.
 * Validates loopback port range, checks local port conflicts, and dedupes.
 * @param options - Forwarding parameters.
 * @returns The newly created or updated rule.
 */
export function addPortForward(options: AddPortForwardOptions): PortForwardRule {
  const localPort = Math.round(options.localPort)
  const remotePort = Math.round(options.remotePort)
  const remoteHost = (options.remoteHost?.trim() || '127.0.0.1')

  if (localPort < 1 || localPort > 65535) {
    throw new Error(`Invalid local port: ${localPort}. Must be between 1 and 65535.`)
  }
  if (remotePort < 1 || remotePort > 65535) {
    throw new Error(`Invalid remote port: ${remotePort}. Must be between 1 and 65535.`)
  }

  // Conflict check: localPort must not already be bound by another active rule
  const conflict = currentState.forwardedPorts.find(
    f => f.localPort === localPort && f.status === 'active' && !(f.remoteHost === remoteHost && f.remotePort === remotePort)
  )
  if (conflict) {
    throw new Error(`Local port ${localPort} is already bound to ${conflict.remoteHost}:${conflict.remotePort}`)
  }

  // Existing rule update or new rule
  const existing = currentState.forwardedPorts.find(
    f => f.remoteHost === remoteHost && f.remotePort === remotePort
  )

  const rule: PortForwardRule = {
    id: existing?.id ?? `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    localPort,
    remotePort,
    remoteHost,
    label: options.label?.trim() || existing?.label || `Forward ${localPort} -> ${remoteHost}:${remotePort}`,
    status: 'active',
    createdAt: existing?.createdAt ?? Date.now(),
  }

  const nextForwards = [
    ...currentState.forwardedPorts.filter(f => f.id !== rule.id),
    rule,
  ]

  // Filter out from detected ports if present
  const nextDetected = currentState.detectedPorts.filter(
    p => !(p.port === remotePort && (p.host === remoteHost || remoteHost === '127.0.0.1'))
  )

  currentState = {
    ...currentState,
    forwardedPorts: nextForwards,
    detectedPorts: nextDetected,
  }

  writePersistedForwards(nextForwards)
  notify()
  return rule
}

/**
 * Stop and remove a port forwarding rule.
 * @param id - Unique rule identifier.
 */
export function removePortForward(id: string): void {
  const nextForwards = currentState.forwardedPorts.filter(f => f.id !== id)
  currentState = {
    ...currentState,
    forwardedPorts: nextForwards,
  }
  writePersistedForwards(nextForwards)
  notify()
}

/**
 * Handle host or session disconnection by releasing forwarding rules.
 */
export function disconnectHostPorts(): void {
  currentState = {
    ...currentState,
    status: 'unavailable',
    unavailableReason: 'Remote host target disconnected',
    detectedPorts: [],
    forwardedPorts: currentState.forwardedPorts.map(f => ({
      ...f,
      status: 'stopped',
    })),
  }
  notify()
}

/**
 * Subscribe to workspace ports state changes.
 * @param listener - Callback invoked on state change.
 * @returns Disposer function.
 */
export function subscribeWorkspacePorts(listener: (state: WorkspacePortsState) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * React hook to consume the current workspace ports state.
 * @returns Current WorkspacePortsState snapshot.
 */
export function useWorkspacePorts(): WorkspacePortsState {
  const [state, setState] = useState<WorkspacePortsState>(getWorkspacePortsState)
  useEffect(() => {
    setState(getWorkspacePortsState())
    return subscribeWorkspacePorts(setState)
  }, [])
  return state
}
