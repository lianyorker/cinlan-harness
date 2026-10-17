/** Type definitions for workspace port scanning and port forwarding. */

/** Port detected as listening on the remote workspace or host. */
export interface DetectedPort {
  /** Listening TCP port number. */
  readonly port: number
  /** Listening host address (e.g. 127.0.0.1 or 0.0.0.0). */
  readonly host: string
  /** Process name or command associated with the port. */
  readonly processName?: string
  /** Milliseconds epoch timestamp when detected. */
  readonly detectedAt: number
}

/** Active or configured port forwarding rule. */
export interface PortForwardRule {
  /** Unique rule identity. */
  readonly id: string
  /** Local port bound on loopback. */
  readonly localPort: number
  /** Remote port on the workspace/host target. */
  readonly remotePort: number
  /** Remote host (defaults to 127.0.0.1). */
  readonly remoteHost: string
  /** User-friendly label or process tag. */
  readonly label?: string
  /** Current forwarding state. */
  readonly status: 'active' | 'error' | 'stopped'
  /** Error message if forwarding failed. */
  readonly error?: string
  /** Milliseconds epoch timestamp when rule was created. */
  readonly createdAt: number
}

/** Aggregated scanning and forwarding state. */
export interface WorkspacePortsState {
  /** Scan status lifecycle. */
  readonly status: 'idle' | 'scanning' | 'ready' | 'error' | 'unavailable'
  /** Timestamp of the last successful scan. */
  readonly scannedAt?: number
  /** Detailed reason if scan failed or service is unavailable. */
  readonly unavailableReason?: string
  /** List of detected ports not yet forwarded. */
  readonly detectedPorts: readonly DetectedPort[]
  /** Configured port forwarding rules. */
  readonly forwardedPorts: readonly PortForwardRule[]
}
